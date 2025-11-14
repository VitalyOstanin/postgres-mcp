import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';

const listObjectsSchema = z.object({
  schema: z.string().optional().default('public').describe('Schema name to list objects from'),
  type: z.enum(['table', 'view', 'function', 'all']).optional().default('all').describe('Type of objects to list'),
});

export type ListObjectsParams = z.infer<typeof listObjectsSchema>;

export function registerListObjectsTool(server: McpServer, client: PostgreSQLClient): void {
  server.registerTool(
    'list-objects',
    {
      title: 'List Objects',
      description: 'List objects (tables, views, functions) in a PostgreSQL schema',
      inputSchema: listObjectsSchema.shape,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (params: ListObjectsParams) => {
      const { schema = 'public', type = 'all' } = params;

      if (!client.isConnectedToPostgreSQL()) {
        return toolError(new Error('Not connected to PostgreSQL. Please connect first.'));
      }

      try {
        let query = '';
        let objects: Array<{ name: string; type: string }> = [];

        switch (type) {
          case 'table':
            query = `
              SELECT table_name as name, 'table' as type
              FROM information_schema.tables
              WHERE table_schema = $1
              AND table_type = 'BASE TABLE'
              ORDER BY table_name
            `;
            break;
          case 'view':
            query = `
              SELECT table_name as name, 'view' as type
              FROM information_schema.views
              WHERE table_schema = $1
              ORDER BY table_name
            `;
            break;
          case 'function':
            query = `
              SELECT p.proname as name, 'function' as type
              FROM pg_proc p
              JOIN pg_namespace n ON p.pronamespace = n.oid
              WHERE n.nspname = $1
              AND NOT p.proisagg
              AND p.prokind = 'f'
              ORDER BY p.proname
            `;
            break;
          case 'all':
          default:
            query = `
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
              AND NOT p.proisagg
              AND p.prokind = 'f'
              ORDER BY name
            `;
            break;
        }

        objects = await client.executeQuery<{ name: string; type: string }>(query, [schema]);

        return toolSuccess({
          schema,
          type,
          objects,
          count: objects.length,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
