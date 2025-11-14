import { mkdirSync, existsSync } from 'fs';

/**
 * Generates a temporary file path for PostgreSQL operations
 */
export function generateTempFilePath(): string {
  const dir = '/tmp';

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  return `${dir}/postgres-${Date.now()}-${Math.random().toString(36).substring(2, 10)}.json`;
}
