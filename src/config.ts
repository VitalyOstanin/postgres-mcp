import { z } from "zod";

export interface PostgreSQLConfig {
  connectionString?: string | undefined;
  timezone: string;
}

// POSTGRES_MCP_CONNECTION_STRING is validated lazily, at the moment of the
// `connect` call (so the server can run without it and accept connection
// parameters interactively). Pool size, idle/connection timeouts come from
// CLI flags only — they are not duplicated here to avoid two sources of truth.
const configSchema = z.object({
  POSTGRES_MCP_CONNECTION_STRING: z.string().optional(),
  POSTGRES_MCP_TIMEZONE: z.string().optional(),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PostgreSQLConfig {
  const envToParse = {
    'POSTGRES_MCP_CONNECTION_STRING': env['POSTGRES_MCP_CONNECTION_STRING'],
    'POSTGRES_MCP_TIMEZONE': env['POSTGRES_MCP_TIMEZONE'],
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
