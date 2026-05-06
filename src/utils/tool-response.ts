import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ZodError } from 'zod';
import { redactConnectionString } from './redact.js';

// Both `content` (text JSON) and `structuredContent` (object) are populated
// on every response: clients with an outputSchema use structuredContent,
// older clients fall back to parsing the text. This satisfies both
// "content-only" and "structuredContent-only" tool-response modes documented
// in AGENTS.md without breaking any existing consumer.

/**
 * Build a successful CallToolResult envelope. The caller's payload is
 * wrapped in `{ success: true, payload }` and surfaced both as JSON text in
 * `content[0].text` (for clients without `outputSchema` support) and as
 * `structuredContent` (for clients that consume the structured form). The
 * two representations are byte-equivalent — never diverge them by
 * post-mutating one of the fields.
 */
export function toolSuccess<T = unknown>(payload: T): CallToolResult {
  const body = { success: true, payload };

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(body),
      },
    ],
    structuredContent: body,
  };
}

function buildErrorBody(error: unknown): Record<string, unknown> {
  if (error instanceof ZodError) {
    return {
      name: 'ValidationError',
      message: 'Invalid input',
      details: error.flatten(),
    };
  }

  if (error instanceof Error) {
    const body: Record<string, unknown> = {
      name: error.name,
      message: redactConnectionString(error.message),
    };
    // node-postgres errors expose SQLSTATE `code` plus diagnostic fields.
    // Surface the ones safe for clients (skip stack, internalQuery, where).
    const pgErr = error as Error & {
      code?: string;
      detail?: string;
      hint?: string;
      severity?: string;
    };

    if (typeof pgErr.code === 'string') {
      body.code = pgErr.code;
    }

    if (typeof pgErr.detail === 'string') {
      body.detail = redactConnectionString(pgErr.detail);
    }

    if (typeof pgErr.hint === 'string') {
      body.hint = pgErr.hint;
    }

    if (typeof pgErr.severity === 'string') {
      body.severity = pgErr.severity;
    }

    return body;
  }

  return {
    name: 'UnknownError',
    message: 'An unknown error occurred',
    details: typeof error === 'string' ? redactConnectionString(error) : error,
  };
}

/**
 * Build an error CallToolResult envelope, mirroring the success layout but
 * with `isError: true` and a structured error body. The body shape depends
 * on the input:
 *
 *   - `ZodError`: `{ name: 'ValidationError', message: 'Invalid input',
 *     details }` where `details` comes from `error.flatten()`.
 *   - `Error` (including pg `DatabaseError`): `{ name, message }` plus the
 *     pg-specific fields `code`, `detail`, `hint`, `severity` when present.
 *     Both `message` and `detail` are passed through `redactConnectionString`
 *     so embedded DSN passwords don't leak. `error.stack` is intentionally
 *     dropped — the stack trace stays in the server logs only.
 *   - Anything else: `{ name: 'UnknownError', message, details }`. Strings
 *     are also redacted before they reach `details`.
 *
 * Like `toolSuccess`, the JSON-encoded body is mirrored in `content[0].text`
 * for clients that consume the text channel.
 */
export function toolError(error: unknown): CallToolResult {
  const body = buildErrorBody(error);

  return {
    isError: true,
    content: [
      { type: 'text', text: JSON.stringify(body) },
    ],
    structuredContent: body,
  };
}
