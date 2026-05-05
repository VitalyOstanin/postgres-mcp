import { Pool } from 'pg';
import { PostgreSQLClient } from '../src/postgres-client.js';

const CONNECTION_STRING = 'postgresql://test:test@127.0.0.1:55432/test';
// Always-RW admin pool for setup/teardown SQL.
let adminPool: Pool | null = null;

export function getAdminPool(): Pool {
  adminPool ??= new Pool({ connectionString: CONNECTION_STRING, max: 2 });

  return adminPool;
}

export async function closeAdminPool(): Promise<void> {
  if (adminPool) {
    await adminPool.end();
    adminPool = null;
  }
}

// Build a fresh client connected to the same DB, in either readonly or RW mode.
export async function makeClient(readonlyMode: boolean): Promise<PostgreSQLClient> {
  const client = new PostgreSQLClient();

  await client.connect(readonlyMode, 1, 30000, 10000);

  return client;
}

// Run setup SQL on the admin pool, ignoring "already exists" errors.
export async function exec(sql: string, params?: unknown[]): Promise<void> {
  await getAdminPool().query(sql, params);
}

// Drop the schema if present so each test file starts clean.
export async function dropSchemaIfExists(schema: string): Promise<void> {
  await exec(`DROP SCHEMA IF EXISTS "${schema.replace(/"/g, '""')}" CASCADE`);
}

// Helper for grabbing the registered tool handler from a registerXxxTool call.
// register*Tool calls server.registerTool(name, config, handler); we capture
// the handler so tests can invoke it directly with input params.
export interface CapturedTool {
  name: string;
  handler: (input: unknown, extra?: unknown) => Promise<unknown>;
}

export function makeRecordingServer(): {
  server: { registerTool: (name: string, config: unknown, handler: CapturedTool['handler']) => void };
  captured: CapturedTool[];
} {
  const captured: CapturedTool[] = [];
  const server = {
    registerTool(name: string, _config: unknown, handler: CapturedTool['handler']) {
      captured.push({ name, handler });
    },
  };

  return { server, captured };
}
