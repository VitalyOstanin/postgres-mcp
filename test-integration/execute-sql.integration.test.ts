import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { registerExecuteSQLTool } from '../src/tools/execute-sql.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  closeAdminPool,
  dropSchemaIfExists,
  exec,
  makeClient,
  makeRecordingServer,
} from './helpers.js';
import type { PostgreSQLClient } from '../src/postgres-client.js';

const SCHEMA = 'it_execute_sql';

interface ToolResult {
  structuredContent?: { payload: Record<string, unknown> };
  content?: Array<{ type: string; text: string }>;
  isError?: boolean;
}

function readPayload(result: unknown): Record<string, unknown> {
  const r = result as ToolResult;

  if (r.isError) {
    throw new Error(`tool returned error: ${JSON.stringify(r.content)}`);
  }
  if (r.structuredContent) {
    return r.structuredContent.payload;
  }

  const text = r.content?.[0]?.text ?? '';

  return (JSON.parse(text) as { payload: Record<string, unknown> }).payload;
}

function expectError(result: unknown): { code?: string; message: string; detail?: string } {
  const r = result as ToolResult;

  expect(r.isError).toBe(true);

  const text = r.content?.[0]?.text ?? '';

  return JSON.parse(text) as { code?: string; message: string; detail?: string };
}

describe('execute-sql (integration)', () => {
  let rwClient: PostgreSQLClient;
  let roClient: PostgreSQLClient;
  let invokeRW: (input: unknown) => Promise<unknown>;
  let invokeRO: (input: unknown) => Promise<unknown>;

  beforeAll(async () => {
    await dropSchemaIfExists(SCHEMA);
    await exec(`CREATE SCHEMA "${SCHEMA}"`);
    await exec(`CREATE TABLE "${SCHEMA}".people (id int primary key, name text, meta jsonb)`);
    await exec(`INSERT INTO "${SCHEMA}".people VALUES (1, 'Alice', '{"role":"admin"}'), (2, 'Bob', '{"role":"user"}')`);

    rwClient = await makeClient(false);
    roClient = await makeClient(true);

    const rwServer = makeRecordingServer();

    registerExecuteSQLTool(rwServer.server as unknown as McpServer, rwClient);
    invokeRW = rwServer.captured[0]!.handler;

    const roServer = makeRecordingServer();

    registerExecuteSQLTool(roServer.server as unknown as McpServer, roClient);
    invokeRO = roServer.captured[0]!.handler;
  });

  afterAll(async () => {
    await rwClient.disconnect('test cleanup');
    await roClient.disconnect('test cleanup');
    await dropSchemaIfExists(SCHEMA);
    await closeAdminPool();
  });

  it('returns rows for SELECT in read-only mode', async () => {
    const payload = readPayload(await invokeRO({
      query: `SELECT id, name FROM "${SCHEMA}".people ORDER BY id`,
    }));

    expect(payload['records']).toEqual([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ]);
    expect(payload['count']).toBe(2);
  });

  it('passes parameters via $1 placeholders', async () => {
    const payload = readPayload(await invokeRO({
      query: `SELECT name FROM "${SCHEMA}".people WHERE id = $1`,
      params: [2],
    }));

    expect(payload['records']).toEqual([{ name: 'Bob' }]);
  });

  it('passes plain objects as JSONB (L10 fix)', async () => {
    const payload = readPayload(await invokeRO({
      query: 'SELECT $1::jsonb -> $2 AS role',
      params: [{ role: 'admin', other: 1 }, 'role'],
    }));

    expect(payload['records']).toEqual([{ role: 'admin' }]);
  });

  it('rejects INSERT in read-only mode with PostgreSQL error 25006', async () => {
    const err = expectError(await invokeRO({
      query: `INSERT INTO "${SCHEMA}".people VALUES (3, 'Eve', '{}')`,
    }));

    expect(err.code).toBe('25006');
    expect(err.message).toMatch(/read-only/i);
  });

  it('rejects UPDATE in read-only mode with PostgreSQL error 25006', async () => {
    const err = expectError(await invokeRO({
      query: `UPDATE "${SCHEMA}".people SET name = 'X' WHERE id = 1`,
    }));

    expect(err.code).toBe('25006');
  });

  it('rejects DDL in read-only mode with PostgreSQL error 25006', async () => {
    const err = expectError(await invokeRO({
      query: `CREATE TABLE "${SCHEMA}".should_not_exist (id int)`,
    }));

    expect(err.code).toBe('25006');
  });

  it('allows INSERT and UPDATE in read-write mode', async () => {
    const inserted = readPayload(await invokeRW({
      query: `INSERT INTO "${SCHEMA}".people VALUES (10, 'Carol', '{"role":"viewer"}') RETURNING id`,
    }));

    expect((inserted['records'] as Array<{ id: number }>)[0]?.id).toBe(10);

    const updated = readPayload(await invokeRW({
      query: `UPDATE "${SCHEMA}".people SET name = 'Carol Renamed' WHERE id = $1 RETURNING name`,
      params: [10],
    }));

    expect((updated['records'] as Array<{ name: string }>)[0]?.name).toBe('Carol Renamed');
  });
});
