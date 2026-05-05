import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MockPostgreSQLClient } from '../__mocks__/postgres-client.mock';
import { resetMockClient, getMockClient } from '../utils/test-helpers';
import { registerListObjectsTool } from '../../src/tools/list-objects';

vi.mock('../../src/postgres-client', () => ({
  PostgreSQLClient: MockPostgreSQLClient,
}));

interface MockServer {
  registerTool: Mock;
}

interface ListObjectsParams {
  schema?: string;
  type?: 'table' | 'view' | 'function' | 'procedure' | 'all';
  nameLike?: string;
  limit?: number;
  offset?: number;
}

describe('List Objects Tool', () => {
  let mockServer: MockServer;
  let mockClient: ReturnType<typeof getMockClient>;
  let toolFunction: (params: ListObjectsParams) => Promise<unknown>;

  beforeEach(() => {
    resetMockClient();

    mockServer = {
      registerTool: vi.fn().mockImplementation((_name: unknown, _config: unknown, fn: unknown) => {
        toolFunction = fn as typeof toolFunction;
      }) as Mock,
    };

    mockClient = getMockClient();
    mockClient.setConnected(true);
    registerListObjectsTool(mockServer as unknown as McpServer, mockClient);
  });

  it('does not reference the removed proisagg column for type=function (L5 fix)', async () => {
    mockClient.setExecuteQueryResult([]);

    await toolFunction({ schema: 'public', type: 'function' });

    const [actualQuery] = (mockClient.executeQuery as Mock).mock.calls[0] as [string];

    expect(actualQuery).not.toMatch(/proisagg/);
    expect(actualQuery).toMatch(/p\.prokind\s*=\s*'f'/);
  });

  it('does not reference proisagg in the type=all union either', async () => {
    mockClient.setExecuteQueryResult([]);

    await toolFunction({ schema: 'public', type: 'all' });

    const [actualQuery] = (mockClient.executeQuery as Mock).mock.calls[0] as [string];

    expect(actualQuery).not.toMatch(/proisagg/);
    // For type=all, the function/procedure branch now allows both 'f' and 'p'.
    expect(actualQuery).toMatch(/p\.prokind\s+IN\s*\(\s*'f'\s*,\s*'p'\s*\)/);
  });

  it('returns the queried objects', async () => {
    mockClient.setExecuteQueryResult([
      { name: 'users', type: 'table' },
      { name: 'orders', type: 'table' },
    ]);

    const result = (await toolFunction({ schema: 'public', type: 'table' })) as {
      structuredContent: { payload: { count: number } };
    };

    expect(result.structuredContent.payload.count).toBe(2);
  });

  it('lists procedures with prokind=p', async () => {
    mockClient.setExecuteQueryResult([]);

    await toolFunction({ schema: 'public', type: 'procedure' });

    const [actualQuery] = (mockClient.executeQuery as Mock).mock.calls[0] as [string];

    expect(actualQuery).toMatch(/p\.prokind\s*=\s*'p'/);
    expect(actualQuery).toMatch(/'procedure'\s+as\s+type/);
  });

  it('passes nameLike pattern through to ILIKE filter', async () => {
    mockClient.setExecuteQueryResult([]);

    await toolFunction({ schema: 'public', type: 'table', nameLike: 'user_%' });

    const [actualQuery, actualParams] = (mockClient.executeQuery as Mock).mock.calls[0] as [string, unknown[]];

    expect(actualQuery).toMatch(/table_name\s+ILIKE\s+\$2/);
    expect(actualParams[0]).toBe('public');
    expect(actualParams[1]).toBe('user_%');
  });

  it('passes nameLike=null when not provided so ILIKE branch is bypassed', async () => {
    mockClient.setExecuteQueryResult([]);

    await toolFunction({ schema: 'public', type: 'table' });

    const [, actualParams] = (mockClient.executeQuery as Mock).mock.calls[0] as [string, unknown[]];

    // Second parameter is the name pattern; null means "no filter".
    expect(actualParams[1]).toBeNull();
  });
});
