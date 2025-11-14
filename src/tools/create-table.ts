import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';

const createTableSchema = z.object({
  schema: z.string().optional().default('public').describe('Schema name where to create the table'),
  table: z.string().describe('Table name to create'),
  columns: z.record(z.string()).describe('Object with column names as keys and column definitions (data types) as values'),
  ifNotExists: z.boolean().optional().default(false).describe('Add IF NOT EXISTS clause to prevent errors if table already exists'),
});

export type CreateTableParams = z.infer<typeof createTableSchema>;

// Export the registration function for the server
// The client parameter is required to match the registration function signature used by other tools
export function registerCreateTableTool(server: McpServer, client: PostgreSQLClient) {
  server.registerTool(
    'create-table',
    {
      title: 'Create Table',
      description: 'Create a new table in PostgreSQL. Use for: Creating new tables in PostgreSQL schemas.',
      inputSchema: createTableSchema.shape,
    },
    async (params: CreateTableParams) => {
      const { schema = 'public', table, columns, ifNotExists } = params;

      if (!client.isConnectedToPostgreSQL()) {
        return toolError(new Error('Not connected to PostgreSQL. Please connect first.'));
      }

      // Check if in read-only mode
      if (client.isReadonly()) {
        return toolError(new Error('Cannot perform create table operation in read-only mode'));
      }

      try {
        // Build the column definitions
        const columnDefs = Object.entries(columns)
          .map(([colName, colType]) => `"${colName}" ${colType}`)
          .join(', ');

        const ifNotExistsClause = ifNotExists ? 'IF NOT EXISTS' : '';
        const query = `CREATE TABLE "${schema}"."${table}" ${ifNotExistsClause} (${columnDefs})`;

        await client.executeQuery<any>(query);

        return toolSuccess({
          schema,
          table,
          columns,
          ifNotExists,
          operation: 'createTable',
          message: `Table "${schema}"."${table}" created successfully`,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}