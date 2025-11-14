import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { generateTempFilePath } from '../utils/streaming.js';

const executeSQLSchema = z.object({
  query: z.string().describe('SQL query to execute (SELECT, INSERT, UPDATE, DELETE, DDL)'),
  params: z.array(z.unknown()).optional().describe('Parameters for the SQL query'),
  saveToFile: z.boolean().optional().describe('Save results to a file instead of returning them directly. Useful for large datasets that can be analyzed by scripts.'),
  filePath: z.string().optional().describe('Explicit path to save the file (optional, auto-generated if not provided). Directory will be created if it doesn\'t exist.'),
});

export type ExecuteSQLParams = z.infer<typeof executeSQLSchema>;

export function registerExecuteSQLTool(server: McpServer, client: PostgreSQLClient): void {
  server.registerTool(
    'execute-sql',
    {
      title: 'Execute SQL Query',
      description: 'Execute a custom SQL query against PostgreSQL (supports SELECT, INSERT, UPDATE, DELETE, DDL operations)',
      inputSchema: executeSQLSchema.shape,
    },
    async (params: ExecuteSQLParams) => {
      const { query, params: queryParams = [], saveToFile } = params;
      // Type-check and convert params to the expected type
      const validatedParams: Array<string | number | boolean | Date | null> = queryParams.map(param => {
        if (param === null ||
            typeof param === 'string' ||
            typeof param === 'number' ||
            typeof param === 'boolean' ||
            param instanceof Date) {
          return param;
        }

        // Convert other types to string as a fallback
        return String(param);
      });

      if (!client.isConnectedToPostgreSQL()) {
        return toolError(new Error('Not connected to PostgreSQL. Please connect first.'));
      }

      // Check if query is a modifying operation and if in read-only mode
      const isReadOnlyQuery = query.trim().toUpperCase().startsWith('SELECT');

      if (client.isReadonly() && !isReadOnlyQuery) {
        return toolError(new Error('Cannot perform write operation in read-only mode'));
      }

      try {
        if (saveToFile) {
          // For saving to file, execute the query and save results
          const { filePath = generateTempFilePath() } = params;
          // Ensure directory exists
          const dir = dirname(filePath);

          await mkdir(dir, { recursive: true });

          // Execute query and store results
          const results = await client.executeQuery<Record<string, unknown>>(query, validatedParams);

          // Write results to file
          await import('fs/promises').then(fs =>
            fs.writeFile(filePath, JSON.stringify(results, null, 2)),
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
          const results = await client.executeQuery<Record<string, unknown>>(query, validatedParams);

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
