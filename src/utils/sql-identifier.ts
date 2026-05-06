// PostgreSQL identifier (NAMEDATALEN-1) byte limit.
const PG_IDENTIFIER_MAX_BYTES = 63;
// Maximum length of a user-supplied value to embed verbatim in an error
// message. Keeps a kilobyte of LLM-generated nonsense from flooding the
// tool-response payload.
const ERROR_VALUE_PREVIEW = 80;

function truncateForError(value: string): string {
  if (value.length <= ERROR_VALUE_PREVIEW) {
    return value;
  }

  return `${value.slice(0, ERROR_VALUE_PREVIEW)}…`;
}

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
    throw new Error(`Identifier exceeds ${PG_IDENTIFIER_MAX_BYTES} bytes: ${truncateForError(name)}`);
  }

  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Quote a qualified PostgreSQL object name as "schema"."object".
 */
export function quoteQualified(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`;
}
