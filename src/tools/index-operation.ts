import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';

const indexOperationSchema = z.object({
  operation: z.enum(['create', 'drop', 'list']).describe('Operation to perform: create, drop or list indexes'),
  schema: z.string().optional().default('public').describe('Schema name where the table is located'),

  // Parameters for CREATE operation
  table: z.string().optional().describe('Table name to create/drop index on (required for create/drop)'),
  name: z.string().optional().describe('Index name (required for create/drop)'),
  columns: z.array(z.string()).optional().describe('Array of column names to include in the index (required for create)'),
  unique: z.boolean().optional().default(false).describe('Whether to create a unique index'),
  ifNotExists: z.boolean().optional().default(false).describe('Add IF NOT EXISTS clause to prevent errors if index already exists (for create)'),

  // Parameters for DROP operation
  ifExists: z.boolean().optional().default(false).describe('Add IF EXISTS clause to prevent errors if index does not exist (for drop)'),

  // Parameters for LIST operation
  tableName: z.string().optional().describe('Table name to list indexes for (optional for list)'),
});

export type IndexOperationParams = z.infer<typeof indexOperationSchema>;

export function registerIndexOperationTool(server: McpServer, client: PostgreSQLClient): void {
  server.registerTool(
    'index-operation',
    {
      title: 'Index Operations',
      description: 'Create, drop, or list indexes on PostgreSQL tables',
      inputSchema: indexOperationSchema.shape,
    },
    async (params: IndexOperationParams) => {
      const { operation, schema = 'public' } = params;

      if (!client.isConnectedToPostgreSQL()) {
        return toolError(new Error('Not connected to PostgreSQL. Please connect first.'));
      }

      // Check if in read-only mode for write operations
      if (client.isReadonly() && operation !== 'list') {
        return toolError(new Error('Cannot perform index operation in read-only mode'));
      }

      try {
        switch (operation) {
          case 'create': {
            const { table, name, columns, unique, ifNotExists } = params;

            if (!table || !name || !columns || columns.length === 0) {
              return toolError(new Error('For create operation: table, name, and columns are required'));
            }

            const uniqueClause = unique ? 'UNIQUE' : '';
            const ifNotExistsClause = ifNotExists ? 'IF NOT EXISTS' : '';
            const columnsStr = columns.map(col => `"${col}"`).join(', ');
            const query = `CREATE ${uniqueClause} INDEX ${ifNotExistsClause} "${name}" ON "${schema}"."${table}" (${columnsStr})`;

            await client.executeQuery<Record<string, unknown>>(query);

            return toolSuccess({
              operation: 'create',
              schema,
              table,
              name,
              columns,
              unique,
              message: `Index "${name}" created successfully on table "${schema}"."${table}"`,
            });
          }

          case 'drop': {
            const { table, name, ifExists } = params;

            if (!table || !name) {
              return toolError(new Error('For drop operation: table and name are required'));
            }

            const ifExistsClause = ifExists ? 'IF EXISTS' : '';
            const query = `DROP INDEX "${schema}"."${name}" ${ifExistsClause}`;

            await client.executeQuery<Record<string, unknown>>(query);

            return toolSuccess({
              operation: 'drop',
              schema,
              table,
              name,
              message: `Index "${name}" dropped successfully from table "${schema}"."${table}"`,
            });
          }

          case 'list': {
            const { tableName } = params;
            let query = '';
            let queryParams: Array<string | number> = [];

            if (tableName) {
              // List indexes for a specific table
              query = `
                SELECT 
                  t.relname as table_name,
                  i.relname as index_name,
                  a.attname as column_name,
                  ix.indisunique as is_unique
                FROM pg_class t,
                     pg_class i,
                     pg_index ix,
                     pg_attribute a
                WHERE t.oid = ix.indrelid
                  AND i.oid = ix.indexrelid
                  AND a.attrelid = t.oid
                  AND a.attnum = ANY(ix.indkey)
                  AND t.relkind = 'r'
                  AND t.relname = $1
                  AND n.nspname = $2
                ORDER BY t.relname, i.relname, a.attnum
              `;
              queryParams = [tableName, schema];
            } else {
              // List all indexes in the schema
              query = `
                SELECT 
                  t.relname as table_name,
                  i.relname as index_name,
                  string_agg(a.attname, ', ' ORDER BY a.attnum) as columns,
                  ix.indisunique as is_unique
                FROM pg_class t,
                     pg_class i,
                     pg_index ix,
                     pg_attribute a,
                     pg_namespace n
                WHERE t.oid = ix.indrelid
                  AND i.oid = ix.indexrelid
                  AND a.attrelid = t.oid
                  AND a.attnum = ANY(ix.indkey)
                  AND t.relkind = 'r'
                  AND n.oid = t.relnamespace
                  AND n.nspname = $1
                GROUP BY t.relname, i.relname, ix.indisunique
                ORDER BY t.relname, i.relname
              `;
              queryParams = [schema];
            }

            const indexes = await client.executeQuery<Record<string, unknown>>(query, queryParams);

            return toolSuccess({
              operation: 'list',
              schema,
              tableName,
              indexes,
              count: indexes.length,
            });
          }

          default:
            return toolError(new Error(`Unsupported operation: ${operation}`));
        }
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
