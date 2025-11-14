import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';

const explainSchema = z.object({
  query: z.string().describe('SQL query to analyze'),
  analyze: z.boolean().optional().default(false).describe('Also execute the query and show actual run times'),
  verbose: z.boolean().optional().default(false).describe('Provide verbose output'),
  costs: z.boolean().optional().default(true).describe('Include information on estimated and actual costs'),
  buffers: z.boolean().optional().default(false).describe('Include information on buffer usage'),
  format: z.enum(['text', 'xml', 'json', 'yaml']).optional().default('text').describe('Output format for the query plan'),
});

export type ExplainParams = z.infer<typeof explainSchema>;

// Export the registration function for the server
// The client parameter is required to match the registration function signature used by other tools
export function registerExplainTool(server: McpServer, client: PostgreSQLClient) {
  server.registerTool(
    'explain',
    {
      title: 'Explain Query Plan',
      description: 'Get the execution plan of a PostgreSQL query. Use for: Analyzing query performance and understanding how PostgreSQL executes queries.',
      inputSchema: explainSchema.shape,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (params: ExplainParams) => {
      const { query, analyze, verbose, costs, buffers, format } = params;

      if (!client.isConnectedToPostgreSQL()) {
        return toolError(new Error('Not connected to PostgreSQL. Please connect first.'));
      }

      try {
        // Build the EXPLAIN query
        let explainQuery = 'EXPLAIN ';
        
        const options = [];
        if (analyze) options.push('ANALYZE');
        if (verbose) options.push('VERBOSE');
        if (!costs) options.push('COSTS OFF'); // Default is ON, so we disable if explicitly set to false
        if (buffers) options.push('BUFFERS');
        if (format && format !== 'text') options.push(`FORMAT ${format.toUpperCase()}`);
        
        if (options.length > 0) {
          explainQuery += `(${options.join(', ')}) `;
        }
        
        explainQuery += query;
        
        const result = await client.executeQuery<{ query_plan: string | object }>(explainQuery);

        // For JSON format, PostgreSQL returns an object, otherwise a string
        const plan = result.length > 0 ? result[0]?.query_plan : null;

        return toolSuccess({
          query: query.substring(0, 100) + (query.length > 100 ? '...' : ''), // Truncate long queries in response
          plan,
          analyze,
          verbose,
          costs,
          buffers,
          format,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}