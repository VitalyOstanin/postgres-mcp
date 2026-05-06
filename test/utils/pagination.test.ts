import { describe, it, expect } from 'vitest';
import { paginationLimitSchema, paginationOffsetSchema } from '../../src/utils/pagination';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, MIN_PAGE_LIMIT } from '../../src/defaults';

describe('paginationLimitSchema', () => {
  const schema = paginationLimitSchema('rows');

  it('uses DEFAULT_PAGE_LIMIT when value is undefined', () => {
    expect(schema.parse(undefined)).toBe(DEFAULT_PAGE_LIMIT);
  });

  it('accepts the minimum allowed value', () => {
    expect(schema.parse(MIN_PAGE_LIMIT)).toBe(MIN_PAGE_LIMIT);
  });

  it('accepts the maximum allowed value', () => {
    expect(schema.parse(MAX_PAGE_LIMIT)).toBe(MAX_PAGE_LIMIT);
  });

  it('rejects values below MIN_PAGE_LIMIT', () => {
    expect(() => schema.parse(MIN_PAGE_LIMIT - 1)).toThrow();
  });

  it('rejects values above MAX_PAGE_LIMIT', () => {
    expect(() => schema.parse(MAX_PAGE_LIMIT + 1)).toThrow();
  });

  it('rejects non-integer values', () => {
    expect(() => schema.parse(10.5)).toThrow();
  });

  it('rejects non-numeric values', () => {
    expect(() => schema.parse('100')).toThrow();
  });

  it('embeds the item label and bounds into the description', () => {
    const labelled = paginationLimitSchema('schemas');

    expect(labelled.description).toContain('schemas');
    expect(labelled.description).toContain(String(DEFAULT_PAGE_LIMIT));
    expect(labelled.description).toContain(String(MAX_PAGE_LIMIT));
  });
});

describe('paginationOffsetSchema', () => {
  const schema = paginationOffsetSchema('rows');

  it('defaults to 0', () => {
    expect(schema.parse(undefined)).toBe(0);
  });

  it('accepts 0', () => {
    expect(schema.parse(0)).toBe(0);
  });

  it('accepts positive integers', () => {
    expect(schema.parse(10_000)).toBe(10_000);
  });

  it('rejects negative integers', () => {
    expect(() => schema.parse(-1)).toThrow();
  });

  it('rejects non-integer values', () => {
    expect(() => schema.parse(1.5)).toThrow();
  });

  it('embeds the item label into the description', () => {
    const labelled = paginationOffsetSchema('indexes');

    expect(labelled.description).toContain('indexes');
  });
});
