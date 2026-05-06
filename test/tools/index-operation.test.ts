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
  concurrently?: boolean;
  tableName?: string;
  confirmation?: string;
}

interface ToolResult {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
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
      // First call: lookup returns the matching table; second call: actual DROP.
      (mockClient.executeQuery as Mock)
        .mockResolvedValueOnce([{ table_name: 'users' }])
        .mockResolvedValueOnce([]);

      await toolFunction({
        operation: 'drop',
        schema: 'public',
        table: 'users',
        name: 'idx_users_email',
        ifExists: true,
        confirmation: 'I_KNOW_THIS_IS_DESTRUCTIVE',
      });

      const {calls} = (mockClient.executeQuery as Mock).mock;
      const dropCall = calls[calls.length - 1] as [string];

      expect(dropCall[0]).toMatch(/DROP INDEX\s+IF EXISTS\s+"public"\."idx_users_email"/);
    });

    it('refuses to drop when the index belongs to a different table', async () => {
      // Lookup returns "orders" but the user claimed "users".
      (mockClient.executeQuery as Mock).mockResolvedValueOnce([{ table_name: 'orders' }]);

      const result = await toolFunction({
        operation: 'drop',
        schema: 'public',
        table: 'users',
        name: 'idx_orders_user_id',
        confirmation: 'I_KNOW_THIS_IS_DESTRUCTIVE',
      }) as ToolResult;

      expect(result.isError).toBe(true);
      // Tool errors come back as JSON-encoded payloads, so the embedded quotes are escaped.
      expect(result.content[0]?.text).toMatch(/belongs to table \\"orders\\", not \\"users\\"/);
      // Only the lookup must have run — the DROP must not have been issued.
      expect((mockClient.executeQuery as Mock).mock.calls).toHaveLength(1);
    });

    it('returns success without dropping when index is missing and ifExists=true', async () => {
      (mockClient.executeQuery as Mock).mockResolvedValueOnce([]);

      const result = await toolFunction({
        operation: 'drop',
        schema: 'public',
        name: 'missing_idx',
        ifExists: true,
        confirmation: 'I_KNOW_THIS_IS_DESTRUCTIVE',
      }) as ToolResult;

      expect(result.isError).toBeFalsy();
      expect(result.content[0]?.text).toMatch(/does not exist; skipped/);
      expect((mockClient.executeQuery as Mock).mock.calls).toHaveLength(1);
    });

    it('errors when the index is missing and ifExists is not set', async () => {
      (mockClient.executeQuery as Mock).mockResolvedValueOnce([]);

      const result = await toolFunction({
        operation: 'drop',
        schema: 'public',
        name: 'missing_idx',
        confirmation: 'I_KNOW_THIS_IS_DESTRUCTIVE',
      }) as ToolResult;

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/does not exist/);
    });

    it('emits CONCURRENTLY in the DROP when concurrently=true', async () => {
      // Concurrent path: lookup → DROP CONCURRENTLY → post-drop OID
      // verification (extra SELECT EXISTS to confirm we removed the OID we
      // looked up, not a replacement created mid-flight).
      (mockClient.executeQuery as Mock)
        .mockResolvedValueOnce([{ oid: 12345, table_name: 'users' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ exists: false }]);

      await toolFunction({
        operation: 'drop',
        schema: 'public',
        name: 'idx_users_email',
        concurrently: true,
        confirmation: 'I_KNOW_THIS_IS_DESTRUCTIVE',
      });

      const calls = (mockClient.executeQuery as Mock).mock.calls as Array<[string, unknown[]?]>;
      const dropCall = calls.find(([sql]) => sql.includes('DROP INDEX'));

      expect(dropCall).toBeDefined();
      expect(dropCall?.[0]).toMatch(/DROP INDEX\s+CONCURRENTLY/);
    });

    it('drops without table-check when table is omitted', async () => {
      (mockClient.executeQuery as Mock)
        .mockResolvedValueOnce([{ table_name: 'orders' }])
        .mockResolvedValueOnce([]);

      const result = await toolFunction({
        operation: 'drop',
        schema: 'public',
        name: 'idx_orders_user_id',
        confirmation: 'I_KNOW_THIS_IS_DESTRUCTIVE',
      }) as ToolResult;

      expect(result.isError).toBeFalsy();
    });
  });

  describe('create operation: concurrently', () => {
    it('emits CREATE INDEX CONCURRENTLY when concurrently=true', async () => {
      mockClient.setExecuteQueryResult([]);

      await toolFunction({
        operation: 'create',
        schema: 'public',
        table: 'users',
        name: 'idx_users_email',
        columns: ['email'],
        concurrently: true,
      });

      const [actualQuery] = (mockClient.executeQuery as Mock).mock.calls[0] as [string];

      expect(actualQuery).toMatch(/CREATE\s+INDEX\s+CONCURRENTLY/);
    });

    it('refuses concurrently=true together with unique=true', async () => {
      mockClient.setExecuteQueryResult([]);

      const result = await toolFunction({
        operation: 'create',
        schema: 'public',
        table: 'users',
        name: 'idx_users_email',
        columns: ['email'],
        unique: true,
        concurrently: true,
      }) as ToolResult;

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/cannot be combined with unique/);
      expect((mockClient.executeQuery as Mock).mock.calls).toHaveLength(0);
    });
  });
});
