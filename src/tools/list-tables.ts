import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';

const listTablesSchema = z.object({
  schema: z.string().optional().default('public').describe('Schema name to list tables from'),
});

export type ListTablesParams = z.infer<typeof listTablesSchema>;

// Export the registration function for the server
// The client parameter is required to match the registration function signature used by other tools
export function registerListTablesTool(server: McpServer, client: PostgreSQLClient) {
  server.registerTool(
    'list-tables',
    {
      title: 'List Tables',
      description: 'List all tables in a specific schema',
      inputSchema: listTablesSchema.shape,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (params: ListTablesParams) => {
      const { schema = 'public' } = params;

      if (!client.isConnectedToPostgreSQL()) {
        return toolError(new Error('Not connected to PostgreSQL. Please connect first.'));
      }

      try {
        // Query to list all tables in the specified schema
        const tables = await client.executeQuery<{ table_name: string }>(
          `SELECT table_name 
           FROM information_schema.tables 
           WHERE table_schema = $1
           AND table_type = 'BASE TABLE'
           ORDER BY table_name`,
          [schema]
        );

        return toolSuccess({
          schema,
          tables: tables.map(table => table.table_name),
          count: tables.length,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}