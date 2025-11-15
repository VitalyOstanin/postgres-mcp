import { Transform, type TransformCallback } from 'stream';
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
      // Convert the chunk to a JSON line
      const jsonLine = `${JSON.stringify(chunk)  }\n`;

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
      if (this.isFirst) {
        // For the first chunk, we add the opening bracket
        this.push('[\n');
        this.isFirst = false;
      } else {
        // For subsequent chunks, we add a comma separator
        this.push(',\n');
      }

      // Convert the chunk to a JSON line
      const jsonLine = JSON.stringify(chunk);

      callback(null, jsonLine);
    } catch (error) {
      callback(error as Error);
    }
  }

  override _flush(callback: TransformCallback): void {
    // Add closing bracket for the JSON array
    if (this.isFirst) {
      // If no data was processed, still add an empty array
      this.push('[]');
    } else {
      // If data was processed, close the array
      this.push('\n]');
    }
    callback(null);
  }
}

/**
 * Stream PostgreSQL query results directly to a file using true streaming without accumulating in memory
 */
export async function streamPostgresQueryToFile(
  streamQueryFunction: (onRow: (row: Record<string, unknown>) => void | Promise<void>) => Promise<void>,
  filePath: string,
  format: 'jsonl' | 'json' = 'jsonl',
): Promise<{ filePath: string; count: number }> {
  // Ensure the directory exists
  const dir = dirname(filePath);

  await mkdir(dir, { recursive: true });

  // Create the appropriate transform based on the format
  const transform = format === 'jsonl' ? new JsonLinesTransform() : new JsonArrayTransform();
  // Create the write stream
  const writeStream = createWriteStream(filePath);
  // Create a promise to handle the stream completion
  const streamCompletePromise = new Promise<void>((resolve, reject) => {
    writeStream.on('finish', () => { resolve(); });
    writeStream.on('error', (error) => { reject(error); });
  });
  // Create a counter for the rows
  let count = 0;
  // Define the row processing function
  const processRow = async (row: Record<string, unknown>) => {
    transform.write(row);
    count++;
  };

  // Pipe the transform to the write stream
  transform.pipe(writeStream);

  // Execute the streaming query
  await streamQueryFunction(processRow);

  // End the transform after all rows have been processed
  transform.end();

  // Wait for the write stream to complete
  await streamCompletePromise;

  return {
    filePath,
    count,
  };
}

/**
 * Generate a temporary file path with specific format
 */
export function generatePostgresTempFilePath(format: 'jsonl' | 'json' = 'jsonl'): string {
  const base = generateTempFilePath();

  // Replace the .json extension with the appropriate one
  return format === 'jsonl' ? base.replace('.json', '.jsonl') : base;
}
