import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { registerIndexOperationTool } from '../src/tools/index-operation.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  closeAdminPool,
  dropSchemaIfExists,
  exec,
  makeClient,
  makeRecordingServer,
} from './helpers.js';
import type { PostgreSQLClient } from '../src/postgres-client.js';

const SCHEMA = 'it_index_op';

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

function expectError(result: unknown): { code?: string; message: string } {
  const r = result as ToolResult;

  expect(r.isError).toBe(true);

  const text = r.content?.[0]?.text ?? '';

  return JSON.parse(text) as { code?: string; message: string };
}

describe('index-operation (integration)', () => {
  let rwClient: PostgreSQLClient;
  let roClient: PostgreSQLClient;
  let invokeRW: (input: unknown) => Promise<unknown>;
  let invokeRO: (input: unknown) => Promise<unknown>;

  beforeAll(async () => {
    await dropSchemaIfExists(SCHEMA);
    await exec(`CREATE SCHEMA "${SCHEMA}"`);
    await exec(`CREATE TABLE "${SCHEMA}".items (id int, sku text, price numeric)`);
    // Pathological table whose name contains a double quote — verifies that
    // quoteIdent escapes correctly (S1+L2 fix).
    await exec(`CREATE TABLE "${SCHEMA}"."weird""tbl" (id int, val text)`);

    rwClient = await makeClient(false);
    roClient = await makeClient(true);

    const rwServer = makeRecordingServer();

    registerIndexOperationTool(rwServer.server as unknown as McpServer, rwClient);
    invokeRW = rwServer.captured[0]!.handler;

    const roServer = makeRecordingServer();

    registerIndexOperationTool(roServer.server as unknown as McpServer, roClient);
    invokeRO = roServer.captured[0]!.handler;
  });

  afterAll(async () => {
    await rwClient.disconnect('test cleanup');
    await roClient.disconnect('test cleanup');
    await dropSchemaIfExists(SCHEMA);
    await closeAdminPool();
  });

  it('creates a unique index, lists it, then drops it', async () => {
    const created = readPayload(await invokeRW({
      operation: 'create',
      schema: SCHEMA,
      table: 'items',
      name: 'items_sku_uq',
      columns: ['sku'],
      unique: true,
    }));

    expect(created).toMatchObject({ operation: 'create', name: 'items_sku_uq', unique: true });

    const listed = readPayload(await invokeRW({
      operation: 'list',
      schema: SCHEMA,
      table: 'items',
      limit: 100,
      offset: 0,
    }));
    const indexes = listed['indexes'] as Array<{ index_name: string; is_unique: boolean }>;

    expect(indexes.some(i => i.index_name === 'items_sku_uq' && i.is_unique === true)).toBe(true);

    const dropped = readPayload(await invokeRW({
      operation: 'drop',
      schema: SCHEMA,
      table: 'items',
      name: 'items_sku_uq',
    }));

    expect(dropped).toMatchObject({ operation: 'drop', name: 'items_sku_uq' });
  });

  it('drops with IF EXISTS in the correct position even when index is missing', async () => {
    // Verifies the L2 fix: `IF EXISTS` must come BEFORE the index name.
    const result = readPayload(await invokeRW({
      operation: 'drop',
      schema: SCHEMA,
      table: 'items',
      name: 'definitely_not_there',
      ifExists: true,
    }));

    expect(result).toMatchObject({ operation: 'drop', name: 'definitely_not_there' });
  });

  it('safely handles identifiers containing double quotes (S1+L2 fix)', async () => {
    // The table name is `weird"tbl`; without proper escaping the SQL would
    // either fail to parse or open an injection. quoteIdent must double the
    // embedded quote.
    const created = readPayload(await invokeRW({
      operation: 'create',
      schema: SCHEMA,
      table: 'weird"tbl',
      name: 'weird"idx',
      columns: ['val'],
      unique: false,
    }));

    expect(created).toMatchObject({ operation: 'create' });

    const dropped = readPayload(await invokeRW({
      operation: 'drop',
      schema: SCHEMA,
      table: 'weird"tbl',
      name: 'weird"idx',
    }));

    expect(dropped).toMatchObject({ operation: 'drop' });
  });

  it('list with `table` parameter narrows results (L1 fix: pg_namespace n in FROM)', async () => {
    // Create an index on a different table to verify the filter works.
    await exec(`CREATE INDEX items_id_idx ON "${SCHEMA}".items(id)`);
    await exec(`CREATE INDEX weird_val_idx ON "${SCHEMA}"."weird""tbl"(val)`);

    const listedItems = readPayload(await invokeRW({
      operation: 'list',
      schema: SCHEMA,
      table: 'items',
      limit: 100,
      offset: 0,
    }));
    const itemIndexes = listedItems['indexes'] as Array<{ table_name: string }>;

    expect(itemIndexes.length).toBeGreaterThan(0);
    expect(itemIndexes.every(i => i.table_name === 'items')).toBe(true);
  });

  it('rejects create in read-only mode', async () => {
    const err = expectError(await invokeRO({
      operation: 'create',
      schema: SCHEMA,
      table: 'items',
      name: 'should_not_be_created',
      columns: ['id'],
    }));

    expect(err.message).toMatch(/read-only/);
  });

  it('rejects drop in read-only mode', async () => {
    const err = expectError(await invokeRO({
      operation: 'drop',
      schema: SCHEMA,
      table: 'items',
      name: 'whatever',
    }));

    expect(err.message).toMatch(/read-only/);
  });

  it('allows list in read-only mode', async () => {
    const listed = readPayload(await invokeRO({
      operation: 'list',
      schema: SCHEMA,
      limit: 100,
      offset: 0,
    }));

    expect(listed).toHaveProperty('indexes');
  });
});
