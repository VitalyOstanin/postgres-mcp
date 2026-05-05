import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join, sep } from 'path';
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
});
