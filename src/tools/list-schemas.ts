import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';

const listSchemasSchema = z.object({
});

export type ListSchemasParams = z.infer<typeof listSchemasSchema>;

// Export the registration function for the server
// The client parameter is required to match the registration function signature used by other tools
export function registerListSchemasTool(server: McpServer, client: PostgreSQLClient): void {
  server.registerTool(
    'list-schemas',
    {
      title: 'List Schemas',
      description: 'List all schemas in the PostgreSQL database',
      inputSchema: listSchemasSchema.shape,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (_params, _extra) => {
      if (!client.isConnectedToPostgreSQL()) {
        return toolError(new Error('Not connected to PostgreSQL. Please connect first.'));
      }

      try {
        // Query to list all schemas (excluding system schemas)
        const schemas = await client.executeQuery<{ schema_name: string }>(
          `SELECT schema_name 
           FROM information_schema.schemata 
           WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
           AND schema_name NOT LIKE 'pg_%'
           ORDER BY schema_name`,
        );

        return toolSuccess({
          schemas: schemas.map(schema => schema.schema_name),
          count: schemas.length,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
