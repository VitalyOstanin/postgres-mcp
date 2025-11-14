import { z } from "zod";

export interface PostgreSQLConfig {
  connectionString?: string;
  timezone: string;
  poolSize: number;
}

const configSchema = z.object({
  POSTGRES_MCP_CONNECTION_STRING: z.string().min(1),
  POSTGRES_MCP_TIMEZONE: z.string().optional(),
  POSTGRES_MCP_POOL_SIZE: z.string().optional(),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PostgreSQLConfig {
  // Make a copy of the environment and set missing optional values to undefined
  // to satisfy the schema
  const envToParse = {
    'POSTGRES_MCP_CONNECTION_STRING': env['POSTGRES_MCP_CONNECTION_STRING'],
    'POSTGRES_MCP_TIMEZONE': env['POSTGRES_MCP_TIMEZONE'],
    'POSTGRES_MCP_POOL_SIZE': env['POSTGRES_MCP_POOL_SIZE'],
  };
  const parsed = configSchema.safeParse(envToParse);

  if (!parsed.success) {
    const { fieldErrors } = parsed.error.flatten();
    const missingFields = Object.entries(fieldErrors)
      .filter(([, issues]) => Array.isArray(issues) && issues.length > 0)
      .map(([field]) => field);
    const errorMessage = missingFields.length
      ? `missing environment variables: ${missingFields.join(", ")}`
      : "invalid configuration";

    throw new Error(`PostgreSQL configuration error: ${errorMessage}`);
  }

  return {
    connectionString: parsed.data['POSTGRES_MCP_CONNECTION_STRING'],
    timezone: parsed.data['POSTGRES_MCP_TIMEZONE'] ?? "Europe/Moscow",
    poolSize: parseInt(parsed.data['POSTGRES_MCP_POOL_SIZE'] ?? "1", 10),
  };
}

export function enrichConfigWithRedaction(config: PostgreSQLConfig) {
  return {
    timezone: config.timezone,
    poolSize: config.poolSize,
  };
}