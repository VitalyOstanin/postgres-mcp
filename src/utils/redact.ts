/**
 * Replace the password segment in any embedded PostgreSQL connection
 * description with ***. Three formats are covered:
 *
 *   - URL form: `postgres://user:secret@host/db` (with or without path/query;
 *     `postgresql://` and `postgres://` are both accepted; an empty user
 *     segment such as `postgres://:secret@host` is also redacted).
 *   - URL query form: `postgresql://user@host/db?password=secret&sslmode=…`
 *     (PostgreSQL accepts libpq parameters via URI query — value is bounded
 *     by `&` rather than whitespace).
 *   - libpq key=value form: `host=… user=… password=secret dbname=…`
 *     (whitespace-delimited; `pg`/PostgreSQL itself emits this form in some
 *     error contexts, so error messages and stack traces can leak it).
 *
 * The replacement preserves the user component so the redacted text still
 * indicates which connection failed.
 */
export function redactConnectionString(text: string): string {
  return text
    // URL form: postgres[ql]://[user]:password@... — `[^:/\s]*` allows empty user.
    .replace(/(postgres(?:ql)?:\/\/[^:/\s]*):([^@\s]+)@/g, '$1:***@')
    // libpq form: password=<value>. Value can be unquoted (no whitespace,
    // no quotes, no `&` so a query-string `?password=secret&sslmode=…`
    // doesn't drag the next param into the match), or single-quoted (libpq
    // accepts `password='multi word'`). Match either.
    .replace(/(\bpassword\s*=\s*)('([^'\\]|\\.)*'|[^\s'"&]+)/gi, '$1***');
}
