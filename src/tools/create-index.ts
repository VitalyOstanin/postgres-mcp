import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';

const createIndexSchema = z.object({
  schema: z.string().optional().default('public').describe('Schema name where the table is located'),
  table: z.string().describe('Table name to create index on'),
  name: z.string().describe('Index name'),
  columns: z.array(z.string()).describe('Array of column names to include in the index'),
  unique: z.boolean().optional().default(false).describe('Whether to create a unique index'),
  ifNotExists: z.boolean().optional().default(false).describe('Add IF NOT EXISTS clause to prevent errors if index already exists'),
});

export type CreateIndexParams = z.infer<typeof createIndexSchema>;

// Export the registration function for the server
// The client parameter is required to match the registration function signature used by other tools
export function registerCreateIndexTool(server: McpServer, client: PostgreSQLClient) {
  server.registerTool(
    'create-index',
    {
      title: 'Create Index',
      description: 'Create an index on a PostgreSQL table. Use for: Improving query performance by creating indexes on table fields.',
      inputSchema: createIndexSchema.shape,
    },
    async (params: CreateIndexParams) => {
      const { schema = 'public', table, name, columns, unique, ifNotExists } = params;

      if (!client.isConnectedToPostgreSQL()) {
        return toolError(new Error('Not connected to PostgreSQL. Please connect first.'));
      }

      // Check if in read-only mode
      if (client.isReadonly()) {
        return toolError(new Error('Cannot perform create index operation in read-only mode'));
      }

      try {
        const uniqueClause = unique ? 'UNIQUE' : '';
        const ifNotExistsClause = ifNotExists ? 'IF NOT EXISTS' : '';
        const columnsStr = columns.map(col => `"${col}"`).join(', ');
        const query = `CREATE ${uniqueClause} INDEX ${ifNotExistsClause} "${name}" ON "${schema}"."${table}" (${columnsStr})`;

        await client.executeQuery<any>(query);

        return toolSuccess({
          schema,
          table,
          name,
          columns,
          unique,
          ifNotExists,
          operation: 'createIndex',
          message: `Index "${name}" created successfully on table "${schema}"."${table}"`,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}