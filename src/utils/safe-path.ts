import { resolve, sep, join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';

let cachedAllowedDirs: string[] | null = null;

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
async function realpathExistingPrefix(absolutePath: string): Promise<string> {
  const parts = absolutePath.split(sep);

  for (let i = parts.length; i > 0; i--) {
    const candidate = parts.slice(0, i).join(sep) || sep;

    try {
      const real = await realpath(candidate);
      const tail = parts.slice(i).join(sep);

      return tail ? join(real, tail) : real;
    } catch {
      // try a shorter prefix
    }
  }

  return absolutePath;
}

/**
 * Resolve and cache the allowed-output directory whitelist. The set is
 * derived from `tmpdir()` and `POSTGRES_MCP_OUTPUT_DIRS`, which never change
 * during a process lifetime, so we resolve them lazily on first use and
 * reuse the result for every subsequent `validateSafeOutputPath` call.
 */
async function getResolvedAllowedDirs(): Promise<string[]> {
  if (cachedAllowedDirs) {
    return cachedAllowedDirs;
  }

  const resolved = await Promise.all(getAllowedOutputDirs().map(realpathExistingPrefix));

  cachedAllowedDirs = resolved;

  return resolved;
}

/**
 * Reset the cached allowed-output directory list. Exposed for tests that
 * mutate `POSTGRES_MCP_OUTPUT_DIRS` between runs and need the cache to
 * pick up the new value.
 */
export function resetAllowedOutputDirsCache(): void {
  cachedAllowedDirs = null;
}

/**
 * Validate that a user-supplied output file path is inside one of the allowed
 * directories. Returns the absolute, symlink-resolved path on success; throws
 * on any attempt to write outside the whitelist.
 */
export async function validateSafeOutputPath(filePath: string): Promise<string> {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('filePath must be a non-empty string');
  }

  const resolved = await realpathExistingPrefix(resolve(filePath));
  const allowed = await getResolvedAllowedDirs();

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
