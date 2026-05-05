import { Pool } from 'pg';
import { PostgreSQLClient } from '../src/postgres-client.js';

// Single source of truth for the test DSN. `setup.ts` populates the env
// var with a default that points at the compose.yaml container; reading
// the same var here keeps the admin pool and the client-under-test on
// the same database when a developer overrides the port (e.g. when the
// container is published on a non-default port to avoid colliding with
// a local PostgreSQL install).
function getConnectionString(): string {
  const dsn = process.env['POSTGRES_MCP_CONNECTION_STRING'];

  if (!dsn) {
    throw new Error(
      'POSTGRES_MCP_CONNECTION_STRING is not set. test-integration/setup.ts should populate it; if you imported this module outside of vitest, set it manually.',
    );
  }

  return dsn;
}

// Always-RW admin pool for setup/teardown SQL.
let adminPool: Pool | null = null;

export function getAdminPool(): Pool {
  // `max: 2` is intentionally tight. `vitest.integration.config.ts` sets
  // `fileParallelism: false` and `maxWorkers: 1`, so under normal runs
  // only one query is in flight at a time — but if a future change ever
  // accidentally fans out admin SQL with `Promise.all`, this cap stops
  // the test container from being saturated. Bumping it requires
  // matching changes to the worker config; do not raise it without
  // checking integration parallelism end-to-end.
  adminPool ??= new Pool({ connectionString: getConnectionString(), max: 2 });

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
