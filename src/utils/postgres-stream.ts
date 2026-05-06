import { Transform, type TransformCallback } from 'stream';
import { once } from 'events';
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { generateTempFilePath } from './streaming.js';

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
  const dir = dirname(filePath);

  await mkdir(dir, { recursive: true });

  const transform = format === 'jsonl' ? new JsonLinesTransform() : new JsonArrayTransform();
  // Open with 'wx' so concurrent tool calls targeting the same path get an
  // EEXIST error instead of silently clobbering each other's exports. Callers
  // are expected to pick a unique filePath (timestamp, uuid) per invocation.
  const writeStream = createWriteStream(filePath, { flags: 'wx' });
  const streamCompletePromise = new Promise<void>((resolve, reject) => {
    writeStream.on('finish', () => { resolve(); });
    writeStream.on('error', (error) => { reject(error); });
    transform.on('error', (error) => { reject(error); });
  });

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
    await streamCompletePromise;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));

    transform.destroy(err);
    writeStream.destroy(err);
    // Surface the rejection from streamCompletePromise but prefer the
    // original error if both fire.
    await streamCompletePromise.catch(() => { /* already handled */ });
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
  const dir = dirname(filePath);

  await mkdir(dir, { recursive: true });

  // 'wx' — see streamPostgresQueryToFile for rationale.
  const writeStream = createWriteStream(filePath, { flags: 'wx' });
  const finished = new Promise<void>((resolve, reject) => {
    writeStream.on('finish', () => { resolve(); });
    writeStream.on('error', (error) => { reject(error); });
  });
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
export function generatePostgresTempFilePath(format: 'jsonl' | 'json' = 'jsonl'): string {
  return generateTempFilePath(format);
}
