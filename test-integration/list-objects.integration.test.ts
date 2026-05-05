import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { registerListObjectsTool } from '../src/tools/list-objects.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  closeAdminPool,
  dropSchemaIfExists,
  exec,
  makeClient,
  makeRecordingServer,
} from './helpers.js';
import type { PostgreSQLClient } from '../src/postgres-client.js';

const SCHEMA = 'it_list_objects';

interface ToolPayload {
  payload: {
    objects: Array<{ name: string; type: string }>;
    count: number;
    hasMore: boolean;
  };
}

interface ToolResult {
  structuredContent?: ToolPayload;
  content?: Array<{ type: string; text: string }>;
  isError?: boolean;
}

function readPayload(result: unknown): ToolPayload['payload'] {
  const r = result as ToolResult;

  if (r.isError) {
    throw new Error(`tool returned error: ${JSON.stringify(r.content)}`);
  }
  if (r.structuredContent) {
    return r.structuredContent.payload;
  }

  const text = r.content?.[0]?.text ?? '';

  return (JSON.parse(text) as ToolPayload).payload;
}

describe('list-objects (integration)', () => {
  let client: PostgreSQLClient;
  let invoke: (input: unknown) => Promise<unknown>;

  beforeAll(async () => {
    await dropSchemaIfExists(SCHEMA);
    await exec(`CREATE SCHEMA "${SCHEMA}"`);
    await exec(`CREATE TABLE "${SCHEMA}".users (id int primary key, name text)`);
    await exec(`CREATE VIEW "${SCHEMA}".users_v AS SELECT id, name FROM "${SCHEMA}".users`);
    await exec(`
      CREATE FUNCTION "${SCHEMA}".greet(p text) RETURNS text
      LANGUAGE sql IMMUTABLE AS $$ SELECT 'hi ' || p $$
    `);

    client = await makeClient(true);

    const { server, captured } = makeRecordingServer();

    registerListObjectsTool(server as unknown as McpServer, client);
    invoke = captured[0]!.handler;
  });

  afterAll(async () => {
    await client.disconnect('test cleanup');
    await dropSchemaIfExists(SCHEMA);
    await closeAdminPool();
  });

  it('returns all three object kinds when type=all', async () => {
    const payload = readPayload(await invoke({ schema: SCHEMA, type: 'all', limit: 100, offset: 0 }));

    expect(payload.objects).toEqual(
      expect.arrayContaining([
        { name: 'users', type: 'table' },
        { name: 'users_v', type: 'view' },
        { name: 'greet', type: 'function' },
      ]),
    );
    expect(payload.count).toBe(3);
  });

  it('lists functions via prokind=f (L5 fix: not the removed proisagg column)', async () => {
    const payload = readPayload(await invoke({ schema: SCHEMA, type: 'function', limit: 100, offset: 0 }));

    expect(payload.objects).toEqual([{ name: 'greet', type: 'function' }]);
  });

  it('lists tables only', async () => {
    const payload = readPayload(await invoke({ schema: SCHEMA, type: 'table', limit: 100, offset: 0 }));

    expect(payload.objects).toEqual([{ name: 'users', type: 'table' }]);
  });

  it('lists views only', async () => {
    const payload = readPayload(await invoke({ schema: SCHEMA, type: 'view', limit: 100, offset: 0 }));

    expect(payload.objects).toEqual([{ name: 'users_v', type: 'view' }]);
  });

  it('paginates with limit and exposes hasMore', async () => {
    const payload = readPayload(await invoke({ schema: SCHEMA, type: 'all', limit: 2, offset: 0 }));

    expect(payload.count).toBe(2);
    expect(payload.hasMore).toBe(true);
  });
});
