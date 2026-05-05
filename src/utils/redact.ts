/**
 * Replace the password segment in any embedded PostgreSQL connection
 * description with ***. Two formats are covered:
 *
 *   - URL form: `postgres://user:secret@host/db` (with or without path/query;
 *     `postgresql://` and `postgres://` are both accepted; an empty user
 *     segment such as `postgres://:secret@host` is also redacted).
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
    // libpq form: password=<value>. Value can be unquoted (no whitespace) or
    // single-quoted (libpq accepts `password='multi word'`). Match either.
    .replace(/(\bpassword\s*=\s*)('([^'\\]|\\.)*'|[^\s'"]+)/gi, '$1***');
}
