import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';

const tableInfoSchema = z.object({
  schema: z.string().optional().default('public').describe('Schema name where the table is located'),
  table: z.string().describe('Table name to get info for'),
});

export type TableInfoParams = z.infer<typeof tableInfoSchema>;

// Export the registration function for the server
// The client parameter is required to match the registration function signature used by other tools
export function registerTableInfoTool(server: McpServer, client: PostgreSQLClient) {
  server.registerTool(
    'table-info',
    {
      title: 'Table Information',
      description: 'Get information about a table (size, row count, etc.)',
      inputSchema: tableInfoSchema.shape,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (params: TableInfoParams) => {
      const { schema = 'public', table } = params;

      if (!client.isConnectedToPostgreSQL()) {
        return toolError(new Error('Not connected to PostgreSQL. Please connect first.'));
      }

      try {
        // Get table information including size and row count
        const tableInfo = await client.executeQuery<{
          row_count: string;
          size_pretty: string;
          size_bytes: string;
        }>(
          `SELECT 
             (SELECT COUNT(*) FROM "${schema}"."${table}")::text AS row_count,
             pg_size_pretty(pg_total_relation_size('"' || $1 || '"."' || $2 || '"')) AS size_pretty,
             pg_total_relation_size('"' || $1 || '"."' || $2 || '"')::text AS size_bytes`,
          [schema, table]
        );

        if (tableInfo.length === 0) {
          return toolError(new Error(`Table "${schema}"."${table}" does not exist`));
        }

        const info = tableInfo[0];
        if (!info) {
          return toolError(new Error(`Table "${schema}"."${table}" does not exist`));
        }

        return toolSuccess({
          schema,
          table,
          rowCount: parseInt(info.row_count, 10),
          size: {
            bytes: parseInt(info.size_bytes, 10),
            pretty: info.size_pretty,
          },
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}