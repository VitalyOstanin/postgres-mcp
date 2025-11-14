import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';

const dropTableSchema = z.object({
  schema: z.string().optional().default('public').describe('Schema name where the table is located'),
  table: z.string().describe('Table name to drop'),
  ifExists: z.boolean().optional().default(false).describe('Add IF EXISTS clause to prevent errors if table does not exist'),
});

export type DropTableParams = z.infer<typeof dropTableSchema>;

// Export the registration function for the server
// The client parameter is required to match the registration function signature used by other tools
export function registerDropTableTool(server: McpServer, client: PostgreSQLClient) {
  server.registerTool(
    'drop-table',
    {
      title: 'Drop Table',
      description: 'Drop a table from PostgreSQL. Use for: Removing tables from PostgreSQL schemas.',
      inputSchema: dropTableSchema.shape,
    },
    async (params: DropTableParams) => {
      const { schema = 'public', table, ifExists } = params;

      if (!client.isConnectedToPostgreSQL()) {
        return toolError(new Error('Not connected to PostgreSQL. Please connect first.'));
      }

      // Check if in read-only mode
      if (client.isReadonly()) {
        return toolError(new Error('Cannot perform drop table operation in read-only mode'));
      }

      try {
        const ifExistsClause = ifExists ? 'IF EXISTS' : '';
        const query = `DROP TABLE "${schema}"."${table}" ${ifExistsClause}`;

        await client.executeQuery<any>(query);

        return toolSuccess({
          schema,
          table,
          ifExists,
          operation: 'dropTable',
          message: `Table "${schema}"."${table}" dropped successfully`,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}