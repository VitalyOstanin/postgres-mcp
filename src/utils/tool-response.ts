import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ZodError } from "zod";
import { redactConnectionString } from "./redact.js";

// Both `content` (text JSON) and `structuredContent` (object) are populated
// on every response: clients with an outputSchema use structuredContent,
// older clients fall back to parsing the text. This satisfies both
// "content-only" and "structuredContent-only" tool-response modes documented
// in AGENTS.md without breaking any existing consumer.

export function toolSuccess<T = unknown>(payload: T): CallToolResult {
  const body = { success: true, payload };

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(body),
      },
    ],
    structuredContent: body as Record<string, unknown>,
  };
}

function buildErrorBody(error: unknown): Record<string, unknown> {
  if (error instanceof ZodError) {
    return {
      name: "ValidationError",
      message: "Invalid input",
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
    name: "UnknownError",
    message: "An unknown error occurred",
    details: typeof error === "string" ? redactConnectionString(error) : error,
  };
}

export function toolError(error: unknown): CallToolResult {
  const body = buildErrorBody(error);

  return {
    isError: true,
    content: [
      { type: "text", text: JSON.stringify(body) },
    ],
    structuredContent: body,
  };
}
