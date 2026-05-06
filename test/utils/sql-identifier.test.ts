import { describe, it, expect } from 'vitest';
import { quoteIdent, quoteQualified } from '../../src/utils/sql-identifier';

describe('quoteIdent', () => {
  it('wraps a plain identifier in double quotes', () => {
    expect(quoteIdent('users')).toBe('"users"');
  });

  it('escapes embedded double quotes by doubling', () => {
    expect(quoteIdent('weird"name')).toBe('"weird""name"');
  });

  it('escapes injection attempts in identifiers', () => {
    const evil = 'x"; DROP TABLE users; --';

    expect(quoteIdent(evil)).toBe('"x""; DROP TABLE users; --"');
  });

  it('rejects empty strings', () => {
    expect(() => quoteIdent('')).toThrow(/non-empty/i);
  });

  it('rejects NUL bytes', () => {
    expect(() => quoteIdent('a\0b')).toThrow(/NUL/i);
  });

  it('rejects identifiers exceeding 63 bytes', () => {
    const longName = 'a'.repeat(64);

    expect(() => quoteIdent(longName)).toThrow(/63 bytes/);
  });

  it('counts UTF-8 bytes, not characters, for the length limit', () => {
    // 21 cyrillic chars * 2 bytes = 42 bytes -> fits
    expect(() => quoteIdent('ы'.repeat(21))).not.toThrow();
    // 32 cyrillic chars * 2 bytes = 64 bytes -> exceeds
    expect(() => quoteIdent('ы'.repeat(32))).toThrow(/63 bytes/);
  });

  it('truncates the offending name in the error message at 80 chars', () => {
    const veryLong = 'a'.repeat(2000);
    let captured: Error | undefined;

    try {
      quoteIdent(veryLong);
    } catch (e) {
      captured = e as Error;
    }

    expect(captured).toBeDefined();
    expect(captured?.message).toMatch(/63 bytes:/);
    // 80 chars + ellipsis, not the full 2000-byte payload.
    expect(captured?.message.endsWith('…')).toBe(true);
    expect(captured?.message.length).toBeLessThan(150);
  });
});

describe('quoteQualified', () => {
  it('joins schema and name with dot', () => {
    expect(quoteQualified('public', 'users')).toBe('"public"."users"');
  });

  it('escapes both parts independently', () => {
    expect(quoteQualified('s"chema', 'us"ers')).toBe('"s""chema"."us""ers"');
  });
});
