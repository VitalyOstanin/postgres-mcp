import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { generateTempFilePath } from '../utils/streaming.js';

const selectSchema = z.object({
  query: z.string().describe('SQL SELECT query to execute'),
  params: z.array(z.unknown()).optional().describe('Parameters for the SQL query'),
  saveToFile: z.boolean().optional().describe('Save results to a file instead of returning them directly. Useful for large datasets that can be analyzed by scripts.'),
  filePath: z.string().optional().describe('Explicit path to save the file (optional, auto-generated if not provided). Directory will be created if it doesn\'t exist.'),
});

export type SelectParams = z.infer<typeof selectSchema>;

// Export the registration function for the server
// The client parameter is required to match the registration function signature used by other tools
export function registerSelectTool(server: McpServer, client: PostgreSQLClient) {
  server.registerTool(
    'select',
    {
      title: 'Execute SELECT Query',
      description: 'Execute a custom SELECT SQL query against PostgreSQL',
      inputSchema: selectSchema.shape,
    },
    async (params: SelectParams) => {
      const { query, params: queryParams = [], saveToFile } = params;

      if (!client.isConnectedToPostgreSQL()) {
        return toolError(new Error('Not connected to PostgreSQL. Please connect first.'));
      }

      try {
        if (saveToFile) {
          // For saving to file, execute the query and save results
          const { filePath = generateTempFilePath() } = params;
          // Ensure directory exists
          const dir = dirname(filePath);
          await mkdir(dir, { recursive: true });

          // Execute query and store results
          const results = await client.executeQuery<any>(query, queryParams);

          // Write results to file
          await import('fs/promises').then(fs => 
            fs.writeFile(filePath, JSON.stringify(results, null, 2))
          );

          return toolSuccess({
            savedToFile: true,
            filePath,
            query,
            count: results.length,
            message: `${results.length} records were written to the file.`,
          });
        } else {
          // Execute the query
          const results = await client.executeQuery<any>(query, queryParams);

          return toolSuccess({
            query,
            records: results,
            count: results.length,
          });
        }
      } catch (error) {
        return toolError(error);
      }
    },
  );
}