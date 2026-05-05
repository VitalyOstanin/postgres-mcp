import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join, sep } from 'path';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'fs';
import { validateSafeOutputPath } from '../../src/utils/safe-path';

describe('validateSafeOutputPath', () => {
  const originalEnv = process.env['POSTGRES_MCP_OUTPUT_DIRS'];

  beforeEach(() => {
    delete process.env['POSTGRES_MCP_OUTPUT_DIRS'];
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env['POSTGRES_MCP_OUTPUT_DIRS'] = originalEnv;
    } else {
      delete process.env['POSTGRES_MCP_OUTPUT_DIRS'];
    }
  });

  it('accepts paths inside the OS temp directory', () => {
    const inside = join(tmpdir(), 'foo', 'bar.json');

    expect(validateSafeOutputPath(inside)).toBe(inside);
  });

  it('rejects absolute paths outside any whitelisted directory', () => {
    expect(() => validateSafeOutputPath('/etc/passwd')).toThrow(/allowed directories/);
  });

  it('blocks parent-directory traversal escaping the whitelist', () => {
    const escape = `${tmpdir()}${sep}..${sep}etc${sep}passwd`;

    expect(() => validateSafeOutputPath(escape)).toThrow(/allowed directories/);
  });

  it('rejects empty filePath', () => {
    expect(() => validateSafeOutputPath('')).toThrow(/non-empty/);
  });

  it('extends the whitelist via POSTGRES_MCP_OUTPUT_DIRS', () => {
    process.env['POSTGRES_MCP_OUTPUT_DIRS'] = '/var/postgres-export';

    expect(validateSafeOutputPath('/var/postgres-export/dump.jsonl')).toBe('/var/postgres-export/dump.jsonl');
  });

  it('ignores whitespace-only entries in POSTGRES_MCP_OUTPUT_DIRS', () => {
    process.env['POSTGRES_MCP_OUTPUT_DIRS'] = '   :/var/postgres-export';

    // The empty/whitespace entry must not whitelist cwd.
    expect(() => validateSafeOutputPath(`${process.cwd()}${sep}leak.json`)).toThrow(/allowed directories/);
  });

  it('blocks symlinks pointing outside the whitelist', () => {
    // Create a temp sandbox, with a symlink that escapes to /etc.
    const sandbox = mkdtempSync(join(tmpdir(), 'safe-path-test-'));

    try {
      const linkInside = join(sandbox, 'escape');

      symlinkSync('/etc', linkInside);
      // The whitelist is the sandbox itself; the symlink resolves outside it.
      process.env['POSTGRES_MCP_OUTPUT_DIRS'] = sandbox;
      expect(() => validateSafeOutputPath(join(linkInside, 'passwd'))).toThrow(/allowed directories/);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('accepts paths inside a whitelisted directory that is itself a symlink', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'safe-path-test-'));

    try {
      const realDir = join(sandbox, 'real');

      mkdirSync(realDir);

      const linkDir = join(sandbox, 'link');

      symlinkSync(realDir, linkDir);
      process.env['POSTGRES_MCP_OUTPUT_DIRS'] = linkDir;
      // Asking via the symlinked whitelist should produce the real path.
      expect(validateSafeOutputPath(join(linkDir, 'dump.jsonl'))).toBe(join(realDir, 'dump.jsonl'));
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
