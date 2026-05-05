import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { registerShowObjectTool } from '../src/tools/show-object.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  closeAdminPool,
  dropSchemaIfExists,
  exec,
  makeClient,
  makeRecordingServer,
} from './helpers.js';
import type { PostgreSQLClient } from '../src/postgres-client.js';

const SCHEMA = 'it_show_obj';

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

describe('show-object (integration)', () => {
  let client: PostgreSQLClient;
  let invoke: (input: unknown) => Promise<unknown>;

  beforeAll(async () => {
    await dropSchemaIfExists(SCHEMA);
    await exec(`CREATE SCHEMA "${SCHEMA}"`);
    await exec(`
      CREATE TABLE "${SCHEMA}".orders (
        id int PRIMARY KEY,
        customer text NOT NULL,
        total numeric(10,2) DEFAULT 0
      )
    `);
    await exec(`CREATE VIEW "${SCHEMA}".big_orders AS SELECT * FROM "${SCHEMA}".orders WHERE total > 100`);
    await exec(`
      CREATE FUNCTION "${SCHEMA}".discount(p numeric, pct int) RETURNS numeric
      LANGUAGE sql IMMUTABLE AS $$ SELECT p * (100 - pct) / 100 $$
    `);

    client = await makeClient(true);

    const { server, captured } = makeRecordingServer();

    registerShowObjectTool(server as unknown as McpServer, client);
    invoke = captured[0]!.handler;
  });

  afterAll(async () => {
    await client.disconnect('test cleanup');
    await dropSchemaIfExists(SCHEMA);
    await closeAdminPool();
  });

  it('returns column metadata for a table', async () => {
    const payload = readPayload(await invoke({ schema: SCHEMA, name: 'orders', type: 'table' }));

    expect(payload['name']).toBe('orders');
    expect(payload['type']).toBe('table');

    const columns = payload['columns'] as Array<{ name: string; type: string; nullable: boolean }>;

    expect(columns.map(c => c.name)).toEqual(['id', 'customer', 'total']);
    expect(columns.find(c => c.name === 'customer')?.nullable).toBe(false);
    expect(columns.find(c => c.name === 'id')?.type).toBe('integer');
  });

  it('returns columns for a view', async () => {
    const payload = readPayload(await invoke({ schema: SCHEMA, name: 'big_orders', type: 'view' }));

    expect(payload['type']).toBe('view');

    const columns = payload['columns'] as Array<{ name: string }>;

    expect(columns.map(c => c.name)).toEqual(['id', 'customer', 'total']);
  });

  it('returns definition for a function', async () => {
    const payload = readPayload(await invoke({ schema: SCHEMA, name: 'discount', type: 'function' }));

    expect(payload['type']).toBe('function');
    expect(payload['name']).toBe('discount');
    expect(payload['definition']).toMatch(/CREATE OR REPLACE FUNCTION/);
    expect(payload['arguments']).toMatch(/p numeric/);
  });

  it('returns isError when object is missing', async () => {
    const result = await invoke({ schema: SCHEMA, name: 'no_such_thing', type: 'table' });

    expect((result as ToolResult).isError).toBe(true);
  });
});
