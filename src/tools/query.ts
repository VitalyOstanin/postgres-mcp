import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';

const querySchema = z.object({
  query: z.string().describe('SQL query to execute'),
  params: z.array(z.unknown()).optional().default([]).describe('Parameters for the SQL query'),
  readOnly: z.boolean().optional().describe('Force read-only execution (overrides server mode if true)'),
});

export type QueryParams = z.infer<typeof querySchema>;

// Export the registration function for the server
// The client parameter is required to match the registration function signature used by other tools
export function registerQueryTool(server: McpServer, client: PostgreSQLClient) {
  server.registerTool(
    'query',
    {
      title: 'Execute SQL Query',
      description: 'Execute an arbitrary SQL query against PostgreSQL. Use for: General SQL operations that don\'t fit other specific tools.',
      inputSchema: querySchema.shape,
    },
    async (params: QueryParams) => {
      const { query, params: queryParams = [], readOnly } = params;

      if (!client.isConnectedToPostgreSQL()) {
        return toolError(new Error('Not connected to PostgreSQL. Please connect first.'));
      }

      // Check if in read-only mode (except when readOnly is explicitly set to false)
      if (client.isReadonly() && readOnly !== false) {
        // For read-only queries, allow execution in read-only mode
        const upperQuery = query.trim().toUpperCase();
        if (!upperQuery.startsWith('SELECT') && !upperQuery.startsWith('WITH') && 
            !upperQuery.startsWith('SHOW') && !upperQuery.startsWith('EXPLAIN')) {
          return toolError(new Error('Cannot perform non-SELECT query in read-only mode'));
        }
      } else if (readOnly === true) {
        // If explicitly set to read-only but server is not, check query type
        const upperQuery = query.trim().toUpperCase();
        if (!upperQuery.startsWith('SELECT') && !upperQuery.startsWith('WITH') && 
            !upperQuery.startsWith('SHOW') && !upperQuery.startsWith('EXPLAIN')) {
          return toolError(new Error('Cannot perform non-SELECT query when read-only is forced'));
        }
      }

      try {
        const result = await client.executeQuery<any>(query, queryParams);

        return toolSuccess({
          query: query.substring(0, 100) + (query.length > 100 ? '...' : ''), // Truncate long queries in response
          result,
          rowCount: result.length,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}