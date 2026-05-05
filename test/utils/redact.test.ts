import { describe, it, expect } from 'vitest';
import { redactConnectionString } from '../../src/utils/redact';

describe('redactConnectionString', () => {
  it('redacts the password in a postgresql:// URL', () => {
    expect(redactConnectionString('connecting to postgresql://alice:secret@host:5432/db'))
      .toBe('connecting to postgresql://alice:***@host:5432/db');
  });

  it('redacts the password in a postgres:// URL', () => {
    expect(redactConnectionString('postgres://alice:hunter2@host/db'))
      .toBe('postgres://alice:***@host/db');
  });

  it('leaves the username intact', () => {
    expect(redactConnectionString('postgres://special-user:p@host/db'))
      .toBe('postgres://special-user:***@host/db');
  });

  it('redacts every URL when several appear in one message', () => {
    const input = 'failed: postgres://a:1@h1/db1 (retry postgresql://b:2@h2/db2)';

    expect(redactConnectionString(input))
      .toBe('failed: postgres://a:***@h1/db1 (retry postgresql://b:***@h2/db2)');
  });

  it('does not modify text without a connection URL', () => {
    expect(redactConnectionString('Failed to connect: timeout')).toBe('Failed to connect: timeout');
  });
});
