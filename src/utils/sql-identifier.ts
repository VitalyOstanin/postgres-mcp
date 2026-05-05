// PostgreSQL identifier (NAMEDATALEN-1) byte limit.
const PG_IDENTIFIER_MAX_BYTES = 63;

/**
 * Quote a PostgreSQL identifier (table, column, schema, index name).
 * Uses standard PostgreSQL escaping: wrap in double quotes and double any
 * embedded double quotes.
 *
 * Rejects empty strings and NUL bytes. Throws if the UTF-8 byte length exceeds
 * 63 bytes (server would silently truncate otherwise).
 */
export function quoteIdent(name: string): string {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('Identifier must be a non-empty string');
  }

  if (name.includes('\0')) {
    throw new Error('Identifier must not contain NUL bytes');
  }

  if (Buffer.byteLength(name, 'utf8') > PG_IDENTIFIER_MAX_BYTES) {
    throw new Error(`Identifier exceeds ${PG_IDENTIFIER_MAX_BYTES} bytes: ${name}`);
  }

  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Quote a qualified PostgreSQL object name as "schema"."object".
 */
export function quoteQualified(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`;
}
