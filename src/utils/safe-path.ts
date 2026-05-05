import { resolve, sep } from 'path';
import { tmpdir } from 'os';

/**
 * Read the list of directories where the server is allowed to write export
 * files. Defaults to the OS temporary directory; can be extended via the
 * POSTGRES_MCP_OUTPUT_DIRS environment variable (':' separated list).
 */
function getAllowedOutputDirs(): string[] {
  const dirs: string[] = [resolve(tmpdir())];
  const fromEnv = process.env['POSTGRES_MCP_OUTPUT_DIRS'];

  if (fromEnv) {
    for (const dir of fromEnv.split(':')) {
      if (dir.length > 0) {
        dirs.push(resolve(dir));
      }
    }
  }

  return dirs;
}

/**
 * Validate that a user-supplied output file path is inside one of the allowed
 * directories. Returns the absolute, normalized path on success; throws on
 * any attempt to write outside the whitelist.
 */
export function validateSafeOutputPath(filePath: string): string {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('filePath must be a non-empty string');
  }

  const resolved = resolve(filePath);
  const allowed = getAllowedOutputDirs();

  for (const dir of allowed) {
    const prefix = dir.endsWith(sep) ? dir : dir + sep;

    if (resolved === dir || resolved.startsWith(prefix)) {
      return resolved;
    }
  }

  throw new Error(
    `filePath must be inside one of the allowed directories: ${allowed.join(', ')}. Got: ${resolved}. Set POSTGRES_MCP_OUTPUT_DIRS to allow more directories.`,
  );
}
