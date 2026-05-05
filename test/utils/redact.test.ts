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

  it('redacts URL-encoded passwords (e.g. %20 spaces)', () => {
    expect(redactConnectionString('postgres://user:pass%20word@host/db'))
      .toBe('postgres://user:***@host/db');
  });

  it('redacts URL with empty user component', () => {
    expect(redactConnectionString('postgresql://:secret@host:5432/db'))
      .toBe('postgresql://:***@host:5432/db');
  });

  it('redacts libpq DSN password=...', () => {
    expect(redactConnectionString('host=db.example user=alice password=hunter2 dbname=app'))
      .toBe('host=db.example user=alice password=*** dbname=app');
  });

  it('redacts quoted libpq passwords', () => {
    expect(redactConnectionString("user=alice password='multi word' dbname=app"))
      .toBe('user=alice password=*** dbname=app');
  });

  it('is case-insensitive on libpq Password=', () => {
    expect(redactConnectionString('Host=db Password=hunter2 User=alice'))
      .toBe('Host=db Password=*** User=alice');
  });

  it('does not change unrelated key=value pairs that contain "password" as substring', () => {
    expect(redactConnectionString('reset_password_token=xyz uses=3'))
      .toBe('reset_password_token=xyz uses=3');
  });

  it('redacts URL with %3A (URL-encoded colon) inside username', () => {
    // RFC 3986 reserves `:` so a literal colon in a userinfo segment must be
    // percent-encoded. The redactor should still pick the right `:` boundary
    // (the one before the password) — `%3A` is three ASCII chars, not a `:`.
    expect(redactConnectionString('postgres://user%3Aname:secret@host:5432/db'))
      .toBe('postgres://user%3Aname:***@host:5432/db');
  });
});
