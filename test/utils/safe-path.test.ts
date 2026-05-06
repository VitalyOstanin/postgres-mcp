import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { resetAllowedOutputDirsCache, validateSafeOutputPath } from '../../src/utils/safe-path';

describe('validateSafeOutputPath', () => {
  const originalEnv = process.env['POSTGRES_MCP_OUTPUT_DIRS'];

  beforeEach(() => {
    delete process.env['POSTGRES_MCP_OUTPUT_DIRS'];
    // Whitelist is cached on first use, so reset between cases that mutate
    // POSTGRES_MCP_OUTPUT_DIRS — otherwise the previous test's whitelist
    // would leak into this one.
    resetAllowedOutputDirsCache();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env['POSTGRES_MCP_OUTPUT_DIRS'] = originalEnv;
    } else {
      delete process.env['POSTGRES_MCP_OUTPUT_DIRS'];
    }
    resetAllowedOutputDirsCache();
  });

  it('accepts paths inside the OS temp directory', async () => {
    const inside = join(tmpdir(), 'foo', 'bar.json');

    expect(await validateSafeOutputPath(inside)).toBe(inside);
  });

  it('rejects absolute paths outside any whitelisted directory', async () => {
    await expect(validateSafeOutputPath('/etc/passwd')).rejects.toThrow(/allowed directories/);
  });

  it('blocks parent-directory traversal escaping the whitelist', async () => {
    const escape = `${tmpdir()}${sep}..${sep}etc${sep}passwd`;

    await expect(validateSafeOutputPath(escape)).rejects.toThrow(/allowed directories/);
  });

  it('rejects empty filePath', async () => {
    await expect(validateSafeOutputPath('')).rejects.toThrow(/non-empty/);
  });

  it('extends the whitelist via POSTGRES_MCP_OUTPUT_DIRS', async () => {
    process.env['POSTGRES_MCP_OUTPUT_DIRS'] = '/var/postgres-export';
    resetAllowedOutputDirsCache();

    expect(await validateSafeOutputPath('/var/postgres-export/dump.jsonl')).toBe('/var/postgres-export/dump.jsonl');
  });

  it('ignores whitespace-only entries in POSTGRES_MCP_OUTPUT_DIRS', async () => {
    process.env['POSTGRES_MCP_OUTPUT_DIRS'] = '   :/var/postgres-export';
    resetAllowedOutputDirsCache();

    // The empty/whitespace entry must not whitelist cwd.
    await expect(validateSafeOutputPath(`${process.cwd()}${sep}leak.json`)).rejects.toThrow(/allowed directories/);
  });

  it('blocks symlinks pointing outside the whitelist', async () => {
    // Create a temp sandbox, with a symlink that escapes to /etc.
    const sandbox = mkdtempSync(join(tmpdir(), 'safe-path-test-'));

    try {
      const linkInside = join(sandbox, 'escape');

      symlinkSync('/etc', linkInside);
      // The whitelist is the sandbox itself; the symlink resolves outside it.
      process.env['POSTGRES_MCP_OUTPUT_DIRS'] = sandbox;
      resetAllowedOutputDirsCache();
      await expect(validateSafeOutputPath(join(linkInside, 'passwd'))).rejects.toThrow(/allowed directories/);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('accepts paths inside a whitelisted directory that is itself a symlink', async () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'safe-path-test-'));

    try {
      const realDir = join(sandbox, 'real');

      mkdirSync(realDir);

      const linkDir = join(sandbox, 'link');

      symlinkSync(realDir, linkDir);
      process.env['POSTGRES_MCP_OUTPUT_DIRS'] = linkDir;
      resetAllowedOutputDirsCache();
      // Asking via the symlinked whitelist should produce the real path.
      expect(await validateSafeOutputPath(join(linkDir, 'dump.jsonl'))).toBe(join(realDir, 'dump.jsonl'));
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
