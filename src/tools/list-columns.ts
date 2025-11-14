import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';

const listColumnsSchema = z.object({
  schema: z.string().optional().default('public').describe('Schema name where the table is located'),
  table: z.string().describe('Table name to list columns from'),
});

export type ListColumnsParams = z.infer<typeof listColumnsSchema>;

// Export the registration function for the server
// The client parameter is required to match the registration function signature used by other tools
export function registerListColumnsTool(server: McpServer, client: PostgreSQLClient) {
  server.registerTool(
    'list-columns',
    {
      title: 'List Columns',
      description: 'List all columns in a specific table',
      inputSchema: listColumnsSchema.shape,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (params: ListColumnsParams) => {
      const { schema = 'public', table } = params;

      if (!client.isConnectedToPostgreSQL()) {
        return toolError(new Error('Not connected to PostgreSQL. Please connect first.'));
      }

      try {
        // Query to list all columns in the specified table
        const columns = await client.executeQuery<{
          column_name: string;
          data_type: string;
          is_nullable: string;
          column_default: string | null;
          character_maximum_length: number | null;
        }>(
          `SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
           FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = $2
           ORDER BY ordinal_position`,
          [schema, table]
        );

        return toolSuccess({
          schema,
          table,
          columns: columns.map(col => ({
            name: col.column_name,
            type: col.data_type,
            nullable: col.is_nullable === 'YES',
            default: col.column_default,
            maxLength: col.character_maximum_length,
          })),
          count: columns.length,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}