import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';

const listObjectsSchema = z.object({
  schema: z.string().optional().default('public').describe('Schema name to list objects from'),
  type: z.enum(['table', 'view', 'function', 'all']).optional().default('all').describe('Type of objects to list'),
  limit: z.number().int().min(1).max(1000).optional().default(100).describe('Maximum number of objects to return (default: 100, max: 1000)'),
  offset: z.number().int().min(0).optional().default(0).describe('Number of objects to skip for pagination (default: 0)'),
});

export type ListObjectsParams = z.infer<typeof listObjectsSchema>;

export function registerListObjectsTool(server: McpServer, client: PostgreSQLClient): void {
  server.registerTool(
    'list-objects',
    {
      title: 'List Objects',
      description: [
        'List objects (tables, views, functions) in a PostgreSQL schema.',
        'Use for: browsing what is available in a schema; narrowing by `type` to only tables, only views, or only user-defined functions.',
        'Returns: `objects` ([{ name, type }]), `count`, pagination metadata (`limit`, `offset`, `hasMore`).',
        'Limitations: only user-callable, non-aggregate functions are reported (filtered by `pg_proc.prokind = \'f\'`). Pagination defaults to 100 rows (max 1000).',
      ].join(' '),
      inputSchema: listObjectsSchema.shape,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (params: ListObjectsParams) => {
      const { schema = 'public', type = 'all', limit, offset } = params;

      if (!client.isConnectedToPostgreSQL()) {
        return toolError(new Error('Not connected to PostgreSQL. Please connect first.'));
      }

      try {
        let baseQuery = '';

        switch (type) {
          case 'table':
            baseQuery = `
              SELECT table_name as name, 'table' as type
              FROM information_schema.tables
              WHERE table_schema = $1
              AND table_type = 'BASE TABLE'
              ORDER BY table_name
            `;
            break;
          case 'view':
            baseQuery = `
              SELECT table_name as name, 'view' as type
              FROM information_schema.views
              WHERE table_schema = $1
              ORDER BY table_name
            `;
            break;
          case 'function':
            baseQuery = `
              SELECT p.proname as name, 'function' as type
              FROM pg_proc p
              JOIN pg_namespace n ON p.pronamespace = n.oid
              WHERE n.nspname = $1
              AND p.prokind = 'f'
              ORDER BY p.proname
            `;
            break;
          case 'all':
          default:
            baseQuery = `
              SELECT name, type FROM (
                SELECT table_name as name, 'table' as type
                FROM information_schema.tables
                WHERE table_schema = $1
                AND table_type = 'BASE TABLE'
                UNION ALL
                SELECT table_name as name, 'view' as type
                FROM information_schema.views
                WHERE table_schema = $1
                UNION ALL
                SELECT p.proname as name, 'function' as type
                FROM pg_proc p
                JOIN pg_namespace n ON p.pronamespace = n.oid
                WHERE n.nspname = $1
                AND p.prokind = 'f'
              ) all_objects
              ORDER BY name
            `;
            break;
        }

        const query = `${baseQuery} LIMIT $2 OFFSET $3`;
        const objects = await client.executeQuery<{ name: string; type: string }>(query, [schema, limit + 1, offset]);
        const hasMore = objects.length > limit;
        const page = hasMore ? objects.slice(0, limit) : objects;

        return toolSuccess({
          schema,
          type,
          objects: page,
          count: page.length,
          limit,
          offset,
          hasMore,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
