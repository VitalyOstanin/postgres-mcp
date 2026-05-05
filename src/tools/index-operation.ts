import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';
import { quoteIdent, quoteQualified } from '../utils/sql-identifier.js';

const indexOperationSchema = z.object({
  operation: z.enum(['create', 'drop', 'list']).describe('Operation to perform: create, drop or list indexes'),
  schema: z.string().optional().default('public').describe('Schema name where the table is located'),

  // Required for create/drop; for list, optional — narrows results to a single
  // table. `tableName` is kept as a deprecated alias and still accepted.
  table: z.string().optional().describe('Table name. Required for create and drop; for list, narrows the result to a specific table.'),
  name: z.string().optional().describe('Index name (required for create/drop)'),
  columns: z.array(z.string()).optional().describe('Array of column names to include in the index (required for create)'),
  unique: z.boolean().optional().default(false).describe('Whether to create a unique index'),
  ifNotExists: z.boolean().optional().default(false).describe('Add IF NOT EXISTS clause to prevent errors if index already exists (for create)'),

  // Parameters for DROP operation
  ifExists: z.boolean().optional().default(false).describe('Add IF EXISTS clause to prevent errors if index does not exist (for drop)'),

  // Parameters for LIST operation
  tableName: z.string().optional().describe('Deprecated alias of `table` for list operation. Use `table` instead.'),
  limit: z.number().int().min(1).max(1000).optional().default(100).describe('Maximum number of rows to return for list operation (default: 100, max: 1000)'),
  offset: z.number().int().min(0).optional().default(0).describe('Number of rows to skip for pagination of list operation (default: 0)'),
});

export type IndexOperationParams = z.infer<typeof indexOperationSchema>;

export function registerIndexOperationTool(server: McpServer, client: PostgreSQLClient): void {
  server.registerTool(
    'index-operation',
    {
      title: 'Index Operations',
      description: [
        'Create, drop, or list indexes on PostgreSQL tables.',
        'Use for: adding a new (optionally unique) index on one or more columns; dropping an existing index; auditing the indexes that already exist on a table or in a schema.',
        'Operation `create`: requires `table`, `name`, `columns`. Optional: `unique`, `ifNotExists`. Identifiers are escaped server-side.',
        'Operation `drop`: requires `table` and `name`. Optional: `ifExists`.',
        'Operation `list`: optional `table` (or deprecated `tableName`) to narrow results; supports `limit`/`offset` pagination (default 100, max 1000).',
        'Limitations: in read-only mode `create` and `drop` are rejected — only `list` is permitted. Concurrent index creation (`CONCURRENTLY`) is not supported by this tool yet.',
      ].join(' '),
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
            const columnsStr = columns.map(col => quoteIdent(col)).join(', ');
            const query = `CREATE ${uniqueClause} INDEX ${ifNotExistsClause} ${quoteIdent(name)} ON ${quoteQualified(schema, table)} (${columnsStr})`;

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
            const query = `DROP INDEX ${ifExistsClause} ${quoteQualified(schema, name)}`;

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
            const { tableName, table, limit, offset } = params;
            // Accept either `table` (canonical) or `tableName` (deprecated)
            // to filter list results to a specific table.
            const searchTable = table ?? tableName;
            let baseQuery = '';
            let baseParams: Array<string | number>;

            if (searchTable) {
              // List indexes for a specific table
              baseQuery = `
                SELECT
                  t.relname as table_name,
                  i.relname as index_name,
                  a.attname as column_name,
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
                  AND t.relname = $1
                  AND n.nspname = $2
                ORDER BY t.relname, i.relname, a.attnum
              `;
              baseParams = [searchTable, schema];
            } else {
              // List all indexes in the schema
              baseQuery = `
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
              baseParams = [schema];
            }

            const limitParamIdx = baseParams.length + 1;
            const offsetParamIdx = baseParams.length + 2;
            const query = `${baseQuery} LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}`;
            const indexes = await client.executeQuery<Record<string, unknown>>(
              query,
              [...baseParams, limit + 1, offset],
            );
            const hasMore = indexes.length > limit;
            const page = hasMore ? indexes.slice(0, limit) : indexes;

            return toolSuccess({
              operation: 'list',
              schema,
              table: searchTable,
              indexes: page,
              count: page.length,
              limit,
              offset,
              hasMore,
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
