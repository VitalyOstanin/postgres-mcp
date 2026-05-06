import { Transform, type TransformCallback } from 'node:stream';
import { once } from 'node:events';
import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { generateTempFilePath } from './streaming.js';

/**
 * Open a write stream with the standard project policy: ensure the directory
 * exists, open the file with 'wx' so concurrent calls targeting the same path
 * fail with EEXIST instead of silently clobbering, and expose a single Promise
 * that resolves on 'finish' or rejects on 'error'. Callers attach additional
 * error sources by destroying the returned stream with an explicit error.
 */
async function openSafeWriteStream(filePath: string): Promise<{ writeStream: WriteStream; finished: Promise<void> }> {
  const dir = dirname(filePath);

  await mkdir(dir, { recursive: true });

  const writeStream = createWriteStream(filePath, { flags: 'wx' });
  const finished = new Promise<void>((resolve, reject) => {
    writeStream.on('finish', () => { resolve(); });
    writeStream.on('error', (error) => { reject(error); });
  });

  return { writeStream, finished };
}

/**
 * Transform stream to convert PostgreSQL query results to JSON Lines format
 */
export class JsonLinesTransform extends Transform {
  constructor() {
    super({
      objectMode: true,
    });
  }

  override _transform(chunk: Record<string, unknown>, _encoding: string, callback: TransformCallback): void {
    try {
      const jsonLine = `${JSON.stringify(chunk)}\n`;

      callback(null, jsonLine);
    } catch (error) {
      callback(error as Error);
    }
  }
}

/**
 * Transform stream to convert PostgreSQL query results to JSON Array format
 */
export class JsonArrayTransform extends Transform {
  private isFirst: boolean = true;

  constructor() {
    super({
      objectMode: true,
    });
  }

  override _transform(chunk: Record<string, unknown>, _encoding: string, callback: TransformCallback): void {
    try {
      // Serialize first so a JSON.stringify failure leaves no half-written
      // separator/bracket in the output stream.
      const jsonLine = JSON.stringify(chunk);
      const prefix = this.isFirst ? '[\n' : ',\n';

      this.isFirst = false;
      callback(null, prefix + jsonLine);
    } catch (error) {
      callback(error as Error);
    }
  }

  override _flush(callback: TransformCallback): void {
    if (this.isFirst) {
      this.push('[]');
    } else {
      this.push('\n]');
    }
    callback(null);
  }
}

/**
 * Stream PostgreSQL query results directly to a file using true streaming
 * without accumulating in memory. Honours write-side back-pressure so the
 * transform buffer doesn't grow unbounded on slow disks, and tears down the
 * write stream on any error so file descriptors are not leaked.
 */
export async function streamPostgresQueryToFile(
  streamQueryFunction: (onRow: (row: Record<string, unknown>) => void | Promise<void>) => Promise<void>,
  filePath: string,
  format: 'jsonl' | 'json' = 'jsonl',
): Promise<{ filePath: string; count: number }> {
  const { writeStream, finished } = await openSafeWriteStream(filePath);
  const transform = format === 'jsonl' ? new JsonLinesTransform() : new JsonArrayTransform();

  // Route transform errors through the writeStream so the unified 'error'
  // listener inside finished/openSafeWriteStream rejects the promise.
  transform.on('error', (error) => { writeStream.destroy(error); });
  transform.pipe(writeStream);

  let count = 0;
  const processRow = async (row: Record<string, unknown>): Promise<void> => {
    if (!transform.write(row)) {
      await once(transform, 'drain');
    }
    count++;
  };

  try {
    await streamQueryFunction(processRow);
    transform.end();
    await finished;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));

    transform.destroy(err);
    writeStream.destroy(err);
    // Surface the rejection from finished but prefer the original error if
    // both fire.
    await finished.catch(() => { /* already handled */ });
    throw err;
  }

  return {
    filePath,
    count,
  };
}

/**
 * Write an in-memory array of rows to a file directly, without going through
 * the object-mode Transform pipeline. Used for non-cursor queries where the
 * result already lives in memory — pushing it through a Transform would
 * double-buffer the same data and risk OOM on large RETURNING payloads.
 */
export async function writeArrayToFile(
  rows: ReadonlyArray<Record<string, unknown>>,
  filePath: string,
  format: 'jsonl' | 'json' = 'jsonl',
): Promise<{ filePath: string; count: number }> {
  const { writeStream, finished } = await openSafeWriteStream(filePath);
  const writeChunk = async (chunk: string): Promise<void> => {
    if (!writeStream.write(chunk)) {
      await once(writeStream, 'drain');
    }
  };

  try {
    if (format === 'jsonl') {
      for (const row of rows) {
        await writeChunk(`${JSON.stringify(row)}\n`);
      }
    } else if (rows.length === 0) {
      await writeChunk('[]');
    } else {
      let isFirst = true;

      for (const row of rows) {
        const prefix = isFirst ? '[\n' : ',\n';

        isFirst = false;
        await writeChunk(prefix + JSON.stringify(row));
      }
      await writeChunk('\n]');
    }
    writeStream.end();
    await finished;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));

    writeStream.destroy(err);
    await finished.catch(() => { /* already handled */ });
    throw err;
  }

  return {
    filePath,
    count: rows.length,
  };
}

/**
 * Generate a temporary file path with the requested format extension.
 */
export async function generatePostgresTempFilePath(format: 'jsonl' | 'json' = 'jsonl'): Promise<string> {
  return generateTempFilePath(format);
}
