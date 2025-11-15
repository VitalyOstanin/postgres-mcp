import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';
import { streamPostgresQueryToFile, generatePostgresTempFilePath } from '../utils/postgres-stream.js';
import { supportsCursor } from '../utils/query-analyzer.js';

const executeSQLSchema = z.object({
  query: z.string().describe('SQL query to execute (SELECT, INSERT, UPDATE, DELETE, DDL)'),
  params: z.array(z.unknown()).optional().describe('Parameters for the SQL query'),
  saveToFile: z.boolean().optional().describe('Save results to a file instead of returning them directly. Useful for large datasets that can be analyzed by scripts. When enabled, uses cursor-based streaming for SELECT queries to avoid memory issues.'),
  filePath: z.string().optional().describe('Explicit path to save the file (optional, auto-generated if not provided). Directory will be created if it doesn\'t exist.'),
  format: z.enum(['jsonl', 'json']).optional().describe('Output format when saving to file: jsonl (JSON Lines) or json (JSON array format). Default is jsonl.'),
  forceSaveToFile: z.boolean().optional().default(false).describe('Force saving results to a file even if the query does not support cursor-based streaming (e.g., INSERT, UPDATE, DELETE). When this flag is true, non-SELECT queries will also be saved to file but may consume more memory. Default is false.'),
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
      const { query, params: queryParams = [], saveToFile, forceSaveToFile } = params;
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
          // Check if the query supports cursor-based streaming
          const cursorSupported = await supportsCursor(query);

          if (cursorSupported) {
            // Use cursor-based streaming for SELECT queries
            const format = params.format ?? 'jsonl';
            const filePath = params.filePath ?? generatePostgresTempFilePath(format);
            // Create a streaming function that uses the client's streamQuery method
            const streamQueryFunction = async (onRow: (row: Record<string, unknown>) => void | Promise<void>) => {
              await client.streamQuery(query, validatedParams, onRow);
            };
            // Stream the results directly to the file without accumulating in memory
            const streamResult = await streamPostgresQueryToFile(streamQueryFunction, filePath, format);

            return toolSuccess({
              savedToFile: true,
              filePath: streamResult.filePath,
              query,
              count: streamResult.count,
              format,
              message: `${streamResult.count} records were written to the file in ${format} format.`,
            });
          } else if (forceSaveToFile) {
            // If cursor is not supported but forceSaveToFile is true, save results without streaming
            const results = await client.executeQuery<Record<string, unknown>>(query, validatedParams);
            const format = params.format ?? 'jsonl';
            const filePath = params.filePath ?? generatePostgresTempFilePath(format);
            // Import required modules for file operations
            const { createWriteStream } = await import('fs');
            const { mkdir } = await import('fs/promises');
            const { dirname } = await import('path');

            // Ensure the directory exists
            await mkdir(dirname(filePath), { recursive: true });

            // Create write stream
            const writeStream = createWriteStream(filePath);

            if (format === 'jsonl') {
              // Write each record as a JSON line
              for (const row of results) {
                writeStream.write(`${JSON.stringify(row)  }\n`);
              }
            } else {
              // Write as JSON array
              writeStream.write('[');
              for (let i = 0; i < results.length; i++) {
                if (i > 0) writeStream.write(',');
                writeStream.write(JSON.stringify(results[i]));
              }
              writeStream.write(']');
            }

            writeStream.end();

            // Wait for the stream to finish
            await new Promise<void>((resolve, reject) => {
              writeStream.on('finish', () => { resolve(); });
              writeStream.on('error', reject);
            });

            return toolSuccess({
              savedToFile: true,
              filePath,
              query,
              count: results.length,
              format,
              message: `${results.length} records were written to the file in ${format} format. Note: Query does not support cursor streaming, so all results were loaded into memory before writing to file.`,
            });
          } else {
            // If cursor is not supported and forceSaveToFile is false, return an error
            return toolError(
              new Error(
                'Query does not support cursor-based streaming. Use forceSaveToFile=true to save results to file without streaming, but be aware that this may consume more memory.',
              ),
            );
          }
        } else {
          // Execute the query and return results directly
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
