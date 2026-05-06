import { describe, it, expect } from 'vitest';
import { isSerializableParam, getSerializationIssue } from '../../src/utils/sql-params';

describe('isSerializableParam', () => {
  describe('accepts allowed scalars', () => {
    it.each([
      ['string', 'hello'],
      ['number', 42],
      ['boolean', true],
      ['bigint', 10n],
      ['null', null],
      ['undefined', undefined],
    ])('accepts %s', (_label, value) => {
      expect(isSerializableParam(value)).toBe(true);
    });
  });

  describe('accepts container values', () => {
    it('accepts Date instances', () => {
      expect(isSerializableParam(new Date())).toBe(true);
    });

    it('accepts Node Buffer', () => {
      expect(isSerializableParam(Buffer.from('abc'))).toBe(true);
    });

    it('accepts plain Uint8Array', () => {
      expect(isSerializableParam(new Uint8Array([1, 2, 3]))).toBe(true);
    });

    it('accepts arrays of allowed values', () => {
      expect(isSerializableParam([1, 'two', null, true, new Date()])).toBe(true);
    });

    it('accepts plain objects', () => {
      expect(isSerializableParam({ a: 1, b: 'two', c: null })).toBe(true);
    });

    it('accepts deeply nested arrays/objects within MAX_PARAM_DEPTH', () => {
      // 60 levels of nesting — well under the 64-deep cap.
      let nested: unknown = 'leaf';

      for (let i = 0; i < 60; i++) {
        nested = { x: nested };
      }
      expect(isSerializableParam(nested)).toBe(true);
    });

    it('accepts an object created with Object.create(null)', () => {
      const proto = Object.create(null) as Record<string, unknown>;

      proto['key'] = 'value';
      expect(isSerializableParam(proto)).toBe(true);
    });
  });

  describe('rejects disallowed values', () => {
    it('rejects functions', () => {
      expect(isSerializableParam(() => 1)).toBe(false);
    });

    it('rejects symbols', () => {
      expect(isSerializableParam(Symbol('s'))).toBe(false);
    });

    it('rejects exotic class instances', () => {
      class Custom {
        x = 1;
      }
      expect(isSerializableParam(new Custom())).toBe(false);
    });

    it('rejects Map and Set', () => {
      expect(isSerializableParam(new Map())).toBe(false);
      expect(isSerializableParam(new Set())).toBe(false);
    });

    it('rejects an array containing a disallowed item', () => {
      expect(isSerializableParam([1, () => 2, 3])).toBe(false);
    });

    it('rejects an object with a disallowed property value', () => {
      expect(isSerializableParam({ ok: 1, bad: () => 2 })).toBe(false);
    });

    it('rejects cyclic arrays', () => {
      const arr: unknown[] = [];

      arr.push(arr);
      expect(isSerializableParam(arr)).toBe(false);
    });

    it('rejects cyclic objects', () => {
      const obj: Record<string, unknown> = {};

      obj['self'] = obj;
      expect(isSerializableParam(obj)).toBe(false);
    });

    it('rejects payloads exceeding MAX_PARAM_DEPTH', () => {
      // 70 levels of nesting — beyond the 64-deep cap.
      let nested: unknown = 'leaf';

      for (let i = 0; i < 70; i++) {
        nested = { x: nested };
      }
      expect(isSerializableParam(nested)).toBe(false);
    });
  });
});

describe('getSerializationIssue', () => {
  it('returns null for an acceptable value', () => {
    expect(getSerializationIssue({ a: 1, b: [2, 3] })).toBeNull();
  });

  it('reports type mismatch with the offending typeof', () => {
    const issue = getSerializationIssue(() => 1);

    expect(issue).toEqual({ reason: 'type', valueType: 'function' });
  });

  it('reports cyclic references separately from type errors', () => {
    const obj: Record<string, unknown> = {};

    obj['self'] = obj;
    expect(getSerializationIssue(obj)).toEqual({ reason: 'cyclic' });
  });

  it('reports depth limit with the configured cap value', () => {
    let nested: unknown = 'leaf';

    for (let i = 0; i < 70; i++) {
      nested = { x: nested };
    }
    expect(getSerializationIssue(nested)).toEqual({ reason: 'depth', limit: 64 });
  });

  it('reports the first offending child of an array', () => {
    const issue = getSerializationIssue([1, 2, () => 3, 4]);

    expect(issue).toEqual({ reason: 'type', valueType: 'function' });
  });
});
