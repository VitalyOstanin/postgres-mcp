import { z } from "zod";

export interface PostgreSQLConfig {
  connectionString?: string | undefined;
  timezone: string;
}

// POSTGRES_MCP_CONNECTION_STRING is validated lazily, at the moment of the
// `connect` call (so the server can run without it and accept connection
// parameters interactively). Pool size, idle/connection timeouts come from
// CLI flags only — they are not duplicated here to avoid two sources of truth.
//
// `min(1)` keeps an empty `POSTGRES_MCP_FOO=` from passing through as a valid
// value: env vars set to the empty string would otherwise propagate downstream
// and cause confusing pg/connect errors. We pre-normalize empty/whitespace-only
// strings to `undefined` below so `optional()` can pick them up cleanly.
const configSchema = z.object({
  POSTGRES_MCP_CONNECTION_STRING: z.string().min(1).optional(),
  POSTGRES_MCP_TIMEZONE: z.string().min(1).optional(),
});

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length === 0 ? undefined : trimmed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PostgreSQLConfig {
  const envToParse = {
    'POSTGRES_MCP_CONNECTION_STRING': nonEmpty(env['POSTGRES_MCP_CONNECTION_STRING']),
    'POSTGRES_MCP_TIMEZONE': nonEmpty(env['POSTGRES_MCP_TIMEZONE']),
  };
  const parsed = configSchema.safeParse(envToParse);

  if (!parsed.success) {
    const { fieldErrors } = parsed.error.flatten();
    const issues = Object.entries(fieldErrors)
      .filter(([, value]) => Array.isArray(value) && value.length > 0)
      .map(([field]) => field);

    throw new Error(`PostgreSQL configuration error: invalid environment variables: ${issues.join(", ")}`);
  }

  return {
    connectionString: parsed.data['POSTGRES_MCP_CONNECTION_STRING'],
    timezone: parsed.data['POSTGRES_MCP_TIMEZONE'] ?? "Europe/Moscow",
  };
}
