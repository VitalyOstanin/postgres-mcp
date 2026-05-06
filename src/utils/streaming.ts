import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Generate an absolute path for a temporary export file.
 *
 * Implementation creates a fresh, mode-0700 directory inside `os.tmpdir()`
 * via `mkdtemp`. This avoids the symlink/TOCTOU race that the previous
 * `Date.now()+random()` approach was vulnerable to: only this process can
 * write into the resulting directory.
 *
 * `extension` controls the file suffix (default: `json`). The file itself is
 * not created here — callers open it for writing.
 */
export async function generateTempFilePath(extension: string = 'json'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'postgres-mcp-'));

  return join(dir, `postgres.${extension}`);
}
