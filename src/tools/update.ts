import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';

const updateSchema = z.object({
  schema: z.string().optional().default('public').describe('Schema name where the table is located'),
  table: z.string().describe('Table name to update'),
  filter: z.record(z.unknown()).describe('Filter conditions to identify records to update'),
  update: z.record(z.unknown()).describe('Fields to update with their new values'),
});

export type UpdateParams = z.infer<typeof updateSchema>;

// Export the registration function for the server
// The client parameter is required to match the registration function signature used by other tools
export function registerUpdateTool(server: McpServer, client: PostgreSQLClient) {
  server.registerTool(
    'update',
    {
      title: 'Update Records',
      description: 'Update records in a PostgreSQL table. Use for: Modifying existing records in PostgreSQL tables.',
      inputSchema: updateSchema.shape,
    },
    async (params: UpdateParams) => {
      const { schema = 'public', table, filter, update } = params;

      if (!client.isConnectedToPostgreSQL()) {
        return toolError(new Error('Not connected to PostgreSQL. Please connect first.'));
      }

      // Check if in read-only mode
      if (client.isReadonly()) {
        return toolError(new Error('Cannot perform update operation in read-only mode'));
      }

      try {
        // Build the SET clause
        const updateFields = Object.keys(update);
        const setClause = updateFields.map((field, index) => `"${field}" = $${index + 1}`).join(', ');
        const updateValues = updateFields.map(field => update[field as keyof typeof update]);

        // Build the WHERE clause
        const filterFields = Object.keys(filter);
        const whereClause = filterFields
          .map((field, index) => `"${field}" = $${index + updateFields.length + 1}`)
          .join(' AND ');
        const filterValues = filterFields.map(field => filter[field as keyof typeof filter]);

        const query = `UPDATE "${schema}"."${table}" SET ${setClause} WHERE ${whereClause} RETURNING *`;
        const allValues = [...updateValues, ...filterValues];

        const result = await client.executeQuery<any>(query, allValues);

        return toolSuccess({
          schema,
          table,
          updatedCount: result.length,
          operation: 'update',
          updatedRecords: result,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}