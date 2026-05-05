import { resolve, sep, join } from 'path';
import { realpathSync } from 'fs';
import { tmpdir } from 'os';

/**
 * Read the list of directories where the server is allowed to write export
 * files. Defaults to the OS temporary directory; can be extended via the
 * POSTGRES_MCP_OUTPUT_DIRS environment variable (':' separated list).
 * Whitespace-only entries are ignored so a stray space (e.g. ` :/data`)
 * doesn't whitelist the current working directory.
 */
function getAllowedOutputDirs(): string[] {
  const dirs: string[] = [resolve(tmpdir())];
  const fromEnv = process.env['POSTGRES_MCP_OUTPUT_DIRS'];

  if (fromEnv) {
    for (const raw of fromEnv.split(':')) {
      const trimmed = raw.trim();

      if (trimmed.length > 0) {
        dirs.push(resolve(trimmed));
      }
    }
  }

  return dirs;
}

/**
 * Walk the path upward until we find a component that exists on the
 * filesystem; resolve symlinks on that component, then re-attach the tail
 * we walked past. This protects against a symlink at any existing prefix —
 * `resolve()` alone does not dereference symlinks, so a `tmpdir()/link →
 * /etc` would otherwise pass the whitelist check.
 */
function realpathExistingPrefix(absolutePath: string): string {
  const parts = absolutePath.split(sep);

  for (let i = parts.length; i > 0; i--) {
    const candidate = parts.slice(0, i).join(sep) || sep;

    try {
      const real = realpathSync.native(candidate);
      const tail = parts.slice(i).join(sep);

      return tail ? join(real, tail) : real;
    } catch {
      // try a shorter prefix
    }
  }

  return absolutePath;
}

/**
 * Validate that a user-supplied output file path is inside one of the allowed
 * directories. Returns the absolute, symlink-resolved path on success; throws
 * on any attempt to write outside the whitelist.
 */
export function validateSafeOutputPath(filePath: string): string {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('filePath must be a non-empty string');
  }

  const resolved = realpathExistingPrefix(resolve(filePath));
  const allowed = getAllowedOutputDirs().map(realpathExistingPrefix);

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
