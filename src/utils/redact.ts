/**
 * Replace the password segment in any embedded PostgreSQL URL with ***.
 *
 * Matches `postgres://` and `postgresql://` URLs, with or without a path/query
 * suffix. The replacement preserves the user component so the redacted text
 * still indicates which connection failed.
 */
export function redactConnectionString(text: string): string {
  return text.replace(/(postgres(?:ql)?:\/\/[^:/\s]+):([^@\s]+)@/g, '$1:***@');
}
