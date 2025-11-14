import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';

const countSchema = z.object({
  schema: z.string().optional().default('public').describe('Schema name where the table is located'),
  table: z.string().describe('Table name to count records in'),
  filter: z.record(z.unknown()).optional().default({}).describe('Filter conditions for counting'),
  where: z.string().optional().describe('SQL WHERE clause conditions for counting'),
});

export type CountParams = z.infer<typeof countSchema>;

// Export the registration function for the server
// The client parameter is required to match the registration function signature used by other tools
export function registerCountTool(server: McpServer, client: PostgreSQLClient) {
  server.registerTool(
    'count',
    {
      title: 'Count Records',
      description: 'Count the number of records in a PostgreSQL table',
      inputSchema: countSchema.shape,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (params: CountParams) => {
      const { schema = 'public', table, filter = {}, where } = params;

      if (!client.isConnectedToPostgreSQL()) {
        return toolError(new Error('Not connected to PostgreSQL. Please connect first.'));
      }

      try {
        let query = `SELECT COUNT(*) as count FROM "${schema}"."${table}"`;
        const queryParams: unknown[] = [];
        let paramIndex = 1;

        // Apply filter conditions if provided
        if (Object.keys(filter).length > 0) {
          const conditions = [];
          for (const [key, value] of Object.entries(filter)) {
            conditions.push(`"${key}" = $${paramIndex}`);
            queryParams.push(value);
            paramIndex++;
          }
          query += ` WHERE ${conditions.join(' AND ')}`;
        }

        // Apply additional WHERE clause if provided
        if (where) {
          const whereClause = where.trim();
          if (query.includes('WHERE')) {
            query += ` AND ${whereClause}`;
          } else {
            query += ` WHERE ${whereClause}`;
          }
        }

        // Execute the count query
        const result = await client.executeQuery<{ count: string }>(query, queryParams);

        if (result.length === 0) {
          return toolError(new Error(`Failed to count records in table "${schema}"."${table}"`));
        }

        const count = parseInt(result[0]!.count, 10);

        return toolSuccess({
          schema,
          table,
          count,
          filter: Object.keys(filter).length > 0 ? filter : undefined,
          where,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}