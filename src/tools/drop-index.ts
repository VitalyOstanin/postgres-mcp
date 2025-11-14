import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';

const dropIndexSchema = z.object({
  schema: z.string().optional().default('public').describe('Schema name where the index is located'),
  name: z.string().describe('Index name to drop'),
  ifExists: z.boolean().optional().default(false).describe('Add IF EXISTS clause to prevent errors if index does not exist'),
});

export type DropIndexParams = z.infer<typeof dropIndexSchema>;

// Export the registration function for the server
// The client parameter is required to match the registration function signature used by other tools
export function registerDropIndexTool(server: McpServer, client: PostgreSQLClient) {
  server.registerTool(
    'drop-index',
    {
      title: 'Drop Index',
      description: 'Drop an index from a PostgreSQL table. Use for: Removing indexes that are no longer needed or causing performance issues.',
      inputSchema: dropIndexSchema.shape,
    },
    async (params: DropIndexParams) => {
      const { schema = 'public', name, ifExists } = params;

      if (!client.isConnectedToPostgreSQL()) {
        return toolError(new Error('Not connected to PostgreSQL. Please connect first.'));
      }

      // Check if in read-only mode
      if (client.isReadonly()) {
        return toolError(new Error('Cannot perform drop index operation in read-only mode'));
      }

      try {
        const ifExistsClause = ifExists ? 'IF EXISTS' : '';
        const query = `DROP INDEX ${ifExistsClause} "${schema}"."${name}"`;

        await client.executeQuery<any>(query);

        return toolSuccess({
          schema,
          name,
          ifExists,
          operation: 'dropIndex',
          message: `Index "${schema}"."${name}" dropped successfully`,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}