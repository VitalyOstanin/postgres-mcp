import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';

const deleteSchema = z.object({
  schema: z.string().optional().default('public').describe('Schema name where the table is located'),
  table: z.string().describe('Table name to delete from'),
  filter: z.record(z.unknown()).describe('Filter conditions to identify records to delete'),
});

export type DeleteParams = z.infer<typeof deleteSchema>;

// Export the registration function for the server
// The client parameter is required to match the registration function signature used by other tools
export function registerDeleteTool(server: McpServer, client: PostgreSQLClient) {
  server.registerTool(
    'delete',
    {
      title: 'Delete Records',
      description: 'Delete records from a PostgreSQL table. Use for: Removing records from PostgreSQL tables.',
      inputSchema: deleteSchema.shape,
    },
    async (params: DeleteParams) => {
      const { schema = 'public', table, filter } = params;

      if (!client.isConnectedToPostgreSQL()) {
        return toolError(new Error('Not connected to PostgreSQL. Please connect first.'));
      }

      // Check if in read-only mode
      if (client.isReadonly()) {
        return toolError(new Error('Cannot perform delete operation in read-only mode'));
      }

      try {
        // Build the WHERE clause
        const filterFields = Object.keys(filter);
        if (filterFields.length === 0) {
          return toolError(new Error('Filter is required for delete operation to prevent accidental deletion of all records'));
        }

        const whereClause = filterFields
          .map((field, index) => `"${field}" = $${index + 1}`)
          .join(' AND ');
        const filterValues = filterFields.map(field => filter[field as keyof typeof filter]);

        const query = `DELETE FROM "${schema}"."${table}" WHERE ${whereClause} RETURNING *`;

        const result = await client.executeQuery<any>(query, filterValues);

        return toolSuccess({
          schema,
          table,
          deletedCount: result.length,
          operation: 'delete',
          deletedRecords: result,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}