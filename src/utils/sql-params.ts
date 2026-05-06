// Maximum nesting depth that the parameter validator will recurse into when
// inspecting an array/object value. JSON-serialisable values are inherently
// acyclic, so anything beyond this depth signals either a cyclic reference
// or a pathologically deep payload — both unsafe for an unbounded recursion
// that runs on every execute-sql call.
const MAX_PARAM_DEPTH = 64;

export type SerializationIssue =
  | { reason: 'cyclic' }
  | { reason: 'depth'; limit: number }
  | { reason: 'type'; valueType: string };

/**
 * Inspect a value intended as a `pg` query parameter and report the first
 * disqualifying property, or `null` if the value is acceptable.
 *
 * Accepts: scalars (string/number/boolean/bigint), null/undefined, Date,
 * Buffer, Uint8Array, arrays of allowed values, and plain objects (sent to
 * PostgreSQL as JSON/JSONB). Rejects functions, symbols, exotic class
 * instances, structures beyond MAX_PARAM_DEPTH, and cyclic references (the
 * latter would otherwise blow the stack on `JSON.stringify`).
 */
export function getSerializationIssue(value: unknown): SerializationIssue | null {
  return findIssue(value, 0, new WeakSet());
}

/**
 * Backwards-compatible boolean wrapper around `getSerializationIssue`. Use
 * the structured variant when the caller needs to surface the specific
 * reason for rejection (cyclic vs. depth vs. type).
 */
export function isSerializableParam(value: unknown): boolean {
  return getSerializationIssue(value) === null;
}

function findIssue(value: unknown, depth: number, seen: WeakSet<object>): SerializationIssue | null {
  if (value === null || value === undefined) {
    return null;
  }

  const type = typeof value;

  if (type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint') {
    return null;
  }

  if (value instanceof Date) {
    return null;
  }

  // pg accepts both Node Buffer and plain Uint8Array for `bytea` parameters.
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return null;
  }

  if (depth >= MAX_PARAM_DEPTH) {
    return { reason: 'depth', limit: MAX_PARAM_DEPTH };
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return { reason: 'cyclic' };
    }
    seen.add(value);

    for (const item of value) {
      const childIssue = findIssue(item, depth + 1, seen);

      if (childIssue) return childIssue;
    }

    return null;
  }

  if (type === 'object') {
    const obj = value;

    if (seen.has(obj)) {
      return { reason: 'cyclic' };
    }
    seen.add(obj);

    const proto = Object.getPrototypeOf(obj);

    if (proto === Object.prototype || proto === null) {
      for (const item of Object.values(obj as Record<string, unknown>)) {
        const childIssue = findIssue(item, depth + 1, seen);

        if (childIssue) return childIssue;
      }

      return null;
    }
  }

  return { reason: 'type', valueType: type };
}
