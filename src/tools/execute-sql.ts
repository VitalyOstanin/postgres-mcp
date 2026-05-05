import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';
import { streamPostgresQueryToFile, writeArrayToFile, generatePostgresTempFilePath } from '../utils/postgres-stream.js';
import { supportsCursor } from '../utils/query-analyzer.js';
import { validateSafeOutputPath } from '../utils/safe-path.js';

const executeSQLSchema = z.object({
  query: z.string().describe('SQL query to execute (SELECT, INSERT, UPDATE, DELETE, DDL)'),
  params: z.array(z.unknown()).optional().describe('Parameters for the SQL query'),
  saveToFile: z.boolean().optional().default(false).describe('Save results to a file instead of returning them directly. Useful for large datasets that can be analyzed by scripts. When enabled, uses cursor-based streaming for SELECT queries to avoid memory issues. Default: false.'),
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
      description: [
        'Execute a custom SQL query against PostgreSQL (supports SELECT, INSERT, UPDATE, DELETE, and DDL operations).',
        'Use for: running ad-hoc analytical queries; bulk inserts/updates with parameter binding; exporting large result sets to a file via cursor streaming.',
        'Parameters use $1/$2 placeholders. Allowed values: scalars, null, Date, Buffer, arrays of allowed values, plain objects (sent as JSON/JSONB).',
        'When `saveToFile=true`, SELECT/WITH/VALUES queries stream rows to disk via a server-side cursor; non-cursor queries require `forceSaveToFile=true` and are buffered in memory first.',
        'The output `filePath` is restricted to the OS temp directory (override with the POSTGRES_MCP_OUTPUT_DIRS env var, `:`-separated whitelist).',
        'Limitations: in read-only mode the session is opened with `default_transaction_read_only=on`; data-modifying statements fail with PostgreSQL error 25006. No automatic LIMIT is applied — add one for large tables.',
      ].join(' '),
      inputSchema: executeSQLSchema.shape,
    },
    async (params: ExecuteSQLParams) => {
      const { query, params: queryParams = [], saveToFile, forceSaveToFile } = params;
      // Validate parameters: pass through scalars, Dates, Buffers, arrays, and
      // plain objects (for JSON/JSONB) unchanged. Reject non-serializable
      // values (functions, symbols, exotic objects) explicitly so the user
      // gets a clear error instead of a String(param) coercion that silently
      // sends "[object Object]" or "function () { ... }" to PostgreSQL.
      const isSerializableParam = (value: unknown): boolean => {
        if (value === null || value === undefined) {
          return true;
        }

        const type = typeof value;

        if (type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint') {
          return true;
        }

        if (value instanceof Date) {
          return true;
        }

        // pg accepts both Node Buffer and plain Uint8Array for `bytea`
        // parameters; allow both rather than rejecting Uint8Array that the
        // MCP SDK delivers when a client sends raw binary data.
        if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
          return true;
        }

        if (Array.isArray(value)) {
          return value.every(isSerializableParam);
        }

        if (type === 'object') {
          const proto = Object.getPrototypeOf(value);

          if (proto === Object.prototype || proto === null) {
            return Object.values(value as Record<string, unknown>).every(isSerializableParam);
          }
        }

        return false;
      };
      let validatedParams: unknown[] | undefined;

      try {
        const mapped = queryParams.map((param, idx) => {
          if (!isSerializableParam(param)) {
            throw new Error(
              `Parameter at index ${idx} is not serializable (got ${typeof param}). Allowed: scalars, null, Date, Buffer, arrays of allowed values, plain objects (for JSON/JSONB).`,
            );
          }

          return param;
        });

        // Pass `undefined` (not `[]`) when the user didn't bind any parameters
        // so node-postgres uses the simple-query protocol — extended-query
        // forces a separate plan cache entry per identical SQL string, and
        // adds a server round-trip to bind/execute that we don't need here.
        validatedParams = mapped.length > 0 ? mapped : undefined;
      } catch (error) {
        return toolError(error);
      }

      if (!client.isConnectedToPostgreSQL()) {
        return toolError(new Error('Not connected to PostgreSQL. Please connect first.'));
      }

      // In readonly mode, PostgreSQL will prevent data-modifying operations
      // by using SET TRANSACTION READ ONLY, so we don't need additional check here

      try {
        if (saveToFile) {
          // Validate user-supplied filePath against the safe-output whitelist
          const requestedFilePath = params.filePath !== undefined
            ? validateSafeOutputPath(params.filePath)
            : undefined;
          // Check if the query supports cursor-based streaming
          const cursorSupported = await supportsCursor(query);

          if (cursorSupported) {
            // Use cursor-based streaming for SELECT queries
            const format = params.format ?? 'jsonl';
            const filePath = requestedFilePath ?? generatePostgresTempFilePath(format);
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
            // Cursor isn't supported (DML/DDL or unparseable). The whole
            // result must be buffered in memory once; we then write it
            // directly to disk to avoid a second copy through an object-mode
            // Transform pipeline.
            const format = params.format ?? 'jsonl';
            const filePath = requestedFilePath ?? generatePostgresTempFilePath(format);
            const results = await client.executeQuery<Record<string, unknown>>(query, validatedParams);
            const { filePath: writtenPath, count } = await writeArrayToFile(results, filePath, format);

            return toolSuccess({
              savedToFile: true,
              filePath: writtenPath,
              query,
              count,
              format,
              message: `${count} records were written to the file in ${format} format. Note: Query does not support cursor streaming, so all results were loaded into memory before writing to file.`,
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
