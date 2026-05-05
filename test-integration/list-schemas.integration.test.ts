import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { registerListSchemasTool } from '../src/tools/list-schemas.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  closeAdminPool,
  dropSchemaIfExists,
  exec,
  makeClient,
  makeRecordingServer,
} from './helpers.js';
import type { PostgreSQLClient } from '../src/postgres-client.js';

const SCHEMAS = ['it_ls_a', 'it_ls_b', 'it_ls_c'];

interface ToolResult {
  structuredContent?: { payload: { schemas: string[]; count: number; hasMore: boolean } };
  content?: Array<{ type: string; text: string }>;
  isError?: boolean;
}

function readPayload(result: unknown): { schemas: string[]; count: number; hasMore: boolean } {
  const r = result as ToolResult;

  if (r.isError) {
    throw new Error(`tool returned error: ${JSON.stringify(r.content)}`);
  }
  if (r.structuredContent) {
    return r.structuredContent.payload;
  }

  const text = r.content?.[0]?.text ?? '';

  return (JSON.parse(text) as { payload: { schemas: string[]; count: number; hasMore: boolean } }).payload;
}

describe('list-schemas (integration)', () => {
  let client: PostgreSQLClient;
  let invoke: (input: unknown) => Promise<unknown>;

  beforeAll(async () => {
    for (const s of SCHEMAS) {
      await dropSchemaIfExists(s);
      await exec(`CREATE SCHEMA "${s}"`);
    }

    client = await makeClient(true);

    const { server, captured } = makeRecordingServer();

    registerListSchemasTool(server as unknown as McpServer, client);
    invoke = captured[0]!.handler;
  });

  afterAll(async () => {
    await client.disconnect('test cleanup');
    for (const s of SCHEMAS) {
      await dropSchemaIfExists(s);
    }
    await closeAdminPool();
  });

  it('returns user schemas including the ones we just created', async () => {
    const payload = readPayload(await invoke({ limit: 1000, offset: 0 }));

    for (const s of SCHEMAS) {
      expect(payload.schemas).toContain(s);
    }
  });

  it('excludes system schemas (information_schema, pg_catalog, pg_toast)', async () => {
    const payload = readPayload(await invoke({ limit: 1000, offset: 0 }));

    expect(payload.schemas).not.toContain('information_schema');
    expect(payload.schemas).not.toContain('pg_catalog');
    expect(payload.schemas).not.toContain('pg_toast');
  });

  it('paginates with limit and reports hasMore', async () => {
    const first = readPayload(await invoke({ limit: 1, offset: 0 }));

    expect(first.count).toBe(1);
    expect(first.hasMore).toBe(true);
  });
});
