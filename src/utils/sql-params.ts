// Maximum nesting depth that `isSerializableParam` will recurse into when
// validating an array/object parameter. JSON-serialisable values are
// inherently acyclic, so anything beyond this depth signals either a cyclic
// reference or a pathologically deep payload — both unsafe for an unbounded
// recursion that runs on every execute-sql call.
const MAX_PARAM_DEPTH = 64;

/**
 * Whether a value is safe to pass as a `pg` query parameter.
 *
 * Accepts: scalars (string/number/boolean/bigint), null/undefined, Date,
 * Buffer, Uint8Array, arrays of allowed values, and plain objects (sent to
 * PostgreSQL as JSON/JSONB). Rejects functions, symbols, exotic objects, and
 * cyclic structures (the latter would otherwise blow the stack on
 * `JSON.stringify`).
 */
export function isSerializableParam(value: unknown): boolean {
  return checkSerializable(value, 0, new WeakSet());
}

function checkSerializable(value: unknown, depth: number, seen: WeakSet<object>): boolean {
  if (value === null || value === undefined) {
    return true;
  }

  const type = typeof value;

  if (type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint') {
    return true;
  }

  if (value instanceof Date) {
    return true;
  }

  // pg accepts both Node Buffer and plain Uint8Array for `bytea` parameters.
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return true;
  }

  if (depth >= MAX_PARAM_DEPTH) {
    return false;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);

    return value.every(item => checkSerializable(item, depth + 1, seen));
  }

  if (type === 'object') {
    const obj = value;

    if (seen.has(obj)) {
      return false;
    }
    seen.add(obj);

    const proto = Object.getPrototypeOf(obj);

    if (proto === Object.prototype || proto === null) {
      return Object.values(obj as Record<string, unknown>)
        .every(item => checkSerializable(item, depth + 1, seen));
    }
  }

  return false;
}
