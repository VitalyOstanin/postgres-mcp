import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MockPostgreSQLClient } from '../__mocks__/postgres-client.mock';
import { resetMockClient, getMockClient } from '../utils/test-helpers';
import { registerIndexOperationTool } from '../../src/tools/index-operation';

vi.mock('../../src/postgres-client', () => ({
  PostgreSQLClient: MockPostgreSQLClient,
}));

interface MockServer {
  registerTool: Mock;
}

interface IndexOperationParams {
  operation: 'create' | 'drop' | 'list';
  schema?: string;
  table?: string;
  name?: string;
  columns?: string[];
  unique?: boolean;
  ifNotExists?: boolean;
  ifExists?: boolean;
  tableName?: string;
}

describe('Index Operation Tool', () => {
  let mockServer: MockServer;
  let mockClient: ReturnType<typeof getMockClient>;
  let toolFunction: (params: IndexOperationParams) => Promise<unknown>;

  beforeEach(() => {
    resetMockClient();

    mockServer = {
      registerTool: vi.fn().mockImplementation((_name: unknown, _config: unknown, fn: unknown) => {
        toolFunction = fn as typeof toolFunction;
      }) as Mock,
    };

    mockClient = getMockClient();
    mockClient.setConnected(true);
    vi.spyOn(mockClient, 'isReadonly').mockReturnValue(false);
    registerIndexOperationTool(mockServer as unknown as McpServer, mockClient);
  });

  describe('list operation', () => {
    it('issues a SQL containing pg_namespace n in FROM when tableName is provided (L1 fix)', async () => {
      mockClient.setExecuteQueryResult([]);

      await toolFunction({
        operation: 'list',
        schema: 'public',
        tableName: 'users',
      });

      expect(mockClient.executeQuery).toHaveBeenCalled();

      const [actualQuery, actualParams] = (mockClient.executeQuery as Mock).mock.calls[0] as [string, unknown[]];

      expect(actualQuery).toMatch(/pg_namespace\s+n/);
      expect(actualQuery).toMatch(/n\.oid\s*=\s*t\.relnamespace/);
      expect(actualQuery).toMatch(/t\.relname\s*=\s*\$1/);
      expect(actualQuery).toMatch(/n\.nspname\s*=\s*\$2/);
      // First two params are the search keys; pagination params follow.
      expect(actualParams.slice(0, 2)).toEqual(['users', 'public']);
      expect(actualQuery).toMatch(/LIMIT\s+\$3\s+OFFSET\s+\$4/);
    });

    it('issues schema-only query when tableName is omitted', async () => {
      mockClient.setExecuteQueryResult([]);

      await toolFunction({ operation: 'list', schema: 'public' });

      const [actualQuery, actualParams] = (mockClient.executeQuery as Mock).mock.calls[0] as [string, unknown[]];

      expect(actualQuery).toMatch(/pg_namespace\s+n/);
      expect(actualQuery).toMatch(/n\.nspname\s*=\s*\$1/);
      expect(actualParams[0]).toBe('public');
      expect(actualQuery).toMatch(/LIMIT\s+\$2\s+OFFSET\s+\$3/);
    });
  });

  describe('create operation (S1/L2 fix: identifier escaping)', () => {
    it('quotes plain identifiers as "schema"."table" and "name"', async () => {
      mockClient.setExecuteQueryResult([]);

      await toolFunction({
        operation: 'create',
        schema: 'public',
        table: 'users',
        name: 'idx_users_email',
        columns: ['email'],
      });

      const [actualQuery] = (mockClient.executeQuery as Mock).mock.calls[0] as [string];

      expect(actualQuery).toContain('CREATE');
      expect(actualQuery).toContain('"idx_users_email"');
      expect(actualQuery).toContain('"public"."users"');
      expect(actualQuery).toContain('("email")');
    });

    it('escapes embedded double quotes (SQL injection attempt)', async () => {
      mockClient.setExecuteQueryResult([]);

      await toolFunction({
        operation: 'create',
        schema: 'public',
        table: 'users',
        name: 'evil"; DROP TABLE users; --',
        columns: ['email'],
      });

      const [actualQuery] = (mockClient.executeQuery as Mock).mock.calls[0] as [string];

      // Escaped form must keep all content inside the identifier and double up the quote.
      expect(actualQuery).toContain('"evil""; DROP TABLE users; --"');
      // The injection attempt must NOT appear as bare SQL.
      expect(actualQuery).not.toMatch(/INDEX\s+evil"\s*;/);
    });

    it('emits IF NOT EXISTS in the correct position', async () => {
      mockClient.setExecuteQueryResult([]);

      await toolFunction({
        operation: 'create',
        schema: 'public',
        table: 'users',
        name: 'idx_users_email',
        columns: ['email'],
        ifNotExists: true,
      });

      const [actualQuery] = (mockClient.executeQuery as Mock).mock.calls[0] as [string];

      expect(actualQuery).toMatch(/IF NOT EXISTS\s+"idx_users_email"/);
    });
  });

  describe('drop operation', () => {
    it('emits IF EXISTS BEFORE the index name (PostgreSQL syntax)', async () => {
      mockClient.setExecuteQueryResult([]);

      await toolFunction({
        operation: 'drop',
        schema: 'public',
        table: 'users',
        name: 'idx_users_email',
        ifExists: true,
      });

      const [actualQuery] = (mockClient.executeQuery as Mock).mock.calls[0] as [string];

      expect(actualQuery).toMatch(/DROP INDEX\s+IF EXISTS\s+"public"\."idx_users_email"/);
    });
  });
});
