import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';

const listDatabasesSchema = z.object({
});

export type ListDatabasesParams = z.infer<typeof listDatabasesSchema>;

// Export the registration function for the server
// The client parameter is required to match the registration function signature used by other tools
export function registerListDatabasesTool(server: McpServer, client: PostgreSQLClient) {
  server.registerTool(
    'list-databases',
    {
      title: 'List Databases',
      description: 'List all databases in the PostgreSQL instance',
      inputSchema: listDatabasesSchema.shape,
      annotations: {
        readOnlyHint: true,
      },
    },
    async () => {
      if (!client.isConnectedToPostgreSQL()) {
        return toolError(new Error('Not connected to PostgreSQL. Please connect first.'));
      }

      try {
        // Query to list all databases
        const databases = await client.executeQuery<{ datname: string }>(
          `SELECT datname 
           FROM pg_database 
           WHERE datistemplate = false 
           ORDER BY datname`
        );

        return toolSuccess({
          databases: databases.map(db => db.datname),
          count: databases.length,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}