import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PostgreSQLClient } from '../postgres-client.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';
import { requireConnection } from '../utils/connection-guard.js';
import { streamPostgresQueryToFile, writeArrayToFile, generatePostgresTempFilePath } from '../utils/postgres-stream.js';
import { supportsCursor } from '../utils/query-analyzer.js';
import { validateSafeOutputPath } from '../utils/safe-path.js';
import { classifyDestructive, DESTRUCTIVE_CONFIRMATION_VALUE } from '../utils/confirmation.js';
import { getSerializationIssue } from '../utils/sql-params.js';

const executeSQLSchema = z.object({
  query: z.string().describe('SQL query to execute (SELECT, INSERT, UPDATE, DELETE, DDL)'),
  params: z.array(z.unknown()).optional().describe('Parameters for the SQL query'),
  saveToFile: z.boolean().optional().default(false).describe('Save results to a file instead of returning them directly. Useful for large datasets that can be analyzed by scripts. When enabled, uses cursor-based streaming for SELECT queries to avoid memory issues. Default: false.'),
  filePath: z.string().optional().describe('Explicit path to save the file (optional, auto-generated if not provided). Directory will be created if it doesn\'t exist.'),
  format: z.enum(['jsonl', 'json']).optional().describe('Output format when saving to file: jsonl (JSON Lines) or json (JSON array format). Default is jsonl.'),
  forceSaveToFile: z.boolean().optional().default(false).describe('Force saving results to a file even if the query does not support cursor-based streaming (e.g., INSERT, UPDATE, DELETE). When this flag is true, non-SELECT queries will also be saved to file but may consume more memory. Default is false.'),
  confirmation: z.string().optional().describe(`Required for destructive statements (DROP/TRUNCATE/ALTER, UPDATE/DELETE without WHERE). Must be exactly the string "${DESTRUCTIVE_CONFIRMATION_VALUE}".`),
});

export type ExecuteSQLParams = z.infer<typeof executeSQLSchema>;

function describeIssue(idx: number, issue: NonNullable<ReturnType<typeof getSerializationIssue>>): string {
  const base = `Parameter at index ${idx} is not serializable`;

  switch (issue.reason) {
    case 'cyclic':
      return `${base}: contains a cyclic reference, which JSON.stringify cannot handle.`;
    case 'depth':
      return `${base}: nesting exceeds the maximum depth of ${issue.limit} levels — flatten the payload or send it as text.`;
    case 'type':
      return `${base} (got ${issue.valueType}). Allowed: scalars, null, Date, Buffer, arrays of allowed values, plain objects (for JSON/JSONB).`;
  }
}

function validateParams(rawParams: unknown[]): { params: unknown[] | undefined } | { error: Error } {
  for (let idx = 0; idx < rawParams.length; idx++) {
    const issue = getSerializationIssue(rawParams[idx]);

    if (issue) {
      return {
        error: new Error(describeIssue(idx, issue)),
      };
    }
  }

  // Pass `undefined` (not `[]`) when the user didn't bind any parameters
  // so node-postgres uses the simple-query protocol — extended-query
  // forces a separate plan cache entry per identical SQL string, and
  // adds a server round-trip to bind/execute that we don't need here.
  return { params: rawParams.length > 0 ? rawParams : undefined };
}

async function runSaveToFile(
  client: PostgreSQLClient,
  params: ExecuteSQLParams,
  validatedParams: unknown[] | undefined,
): Promise<CallToolResult> {
  const { query, forceSaveToFile } = params;
  const requestedFilePath = params.filePath !== undefined
    ? await validateSafeOutputPath(params.filePath)
    : undefined;
  const cursorSupported = await supportsCursor(query);

  if (cursorSupported) {
    const format = params.format ?? 'jsonl';
    const filePath = requestedFilePath ?? await generatePostgresTempFilePath(format);
    const streamQueryFunction = async (onRow: (row: Record<string, unknown>) => void | Promise<void>) => {
      await client.streamQuery(query, validatedParams, onRow);
    };
    const streamResult = await streamPostgresQueryToFile(streamQueryFunction, filePath, format);

    return toolSuccess({
      savedToFile: true,
      filePath: streamResult.filePath,
      query,
      count: streamResult.count,
      format,
      message: `${streamResult.count} records were written to the file in ${format} format.`,
    });
  }

  if (forceSaveToFile) {
    // Cursor isn't supported (DML/DDL or unparseable). The whole result
    // must be buffered in memory once; we then write it directly to disk
    // to avoid a second copy through an object-mode Transform pipeline.
    const format = params.format ?? 'jsonl';
    const filePath = requestedFilePath ?? await generatePostgresTempFilePath(format);
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
  }

  return toolError(
    new Error(
      'Query does not support cursor-based streaming. Use forceSaveToFile=true to save results to file without streaming, but be aware that this may consume more memory.',
    ),
  );
}

/**
 * Register the `execute-sql` MCP tool. Runs an arbitrary parameterised SQL
 * statement, with optional cursor-based streaming to disk for large
 * SELECT/WITH/VALUES results. Destructive statements require the
 * confirmation literal.
 */
export function registerExecuteSQLTool(server: McpServer, client: PostgreSQLClient): void {
  server.registerTool(
    'execute-sql',
    {
      title: 'Execute SQL Query',
      description: [
        'Execute a custom SQL query against PostgreSQL (supports SELECT, INSERT, UPDATE, DELETE, and DDL operations).',
        'Use for: running ad-hoc analytical queries; bulk inserts/updates with parameter binding; exporting large result sets to a file via cursor streaming.',
        'Parameters use $1/$2 placeholders. Allowed values: scalars, null, Date, Buffer, arrays of allowed values, plain objects (sent as JSON/JSONB). Cyclic references are rejected.',
        'When `saveToFile=true`, SELECT/WITH/VALUES queries stream rows to disk via a server-side cursor; non-cursor queries require `forceSaveToFile=true` and are buffered in memory first.',
        'The output `filePath` is restricted to the OS temp directory (override with the POSTGRES_MCP_OUTPUT_DIRS env var, `:`-separated whitelist).',
        'Limitations: in read-only mode the session is opened with `default_transaction_read_only=on` (a session startup parameter, not `SET TRANSACTION READ ONLY`); data-modifying statements fail with PostgreSQL error 25006. No automatic LIMIT is applied — without `saveToFile=true` the entire result is buffered in memory; for queries that may return more than ~10000 rows always either add an explicit `LIMIT` or set `saveToFile=true` to stream via cursor, otherwise the MCP-server process can exhaust heap.',
      ].join(' '),
      inputSchema: executeSQLSchema.shape,
      annotations: {
        // execute-sql can run any DML/DDL statement, so it has to be
        // declared write-capable and potentially destructive. The actual
        // safety gate lives in the readonly mode (PostgreSQL error 25006
        // blocks writes when default_transaction_read_only=on) and in
        // tooling around dangerous SQL operations.
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: ExecuteSQLParams) => {
      // Fail fast when the pool isn't open: spare the user the parser cost
      // and the parameter validation just to surface a "not connected"
      // error at the end. Connection state changes more often than the
      // other validations, so check it first.
      const guard = requireConnection(client);

      if (guard) return guard;

      const { query, params: queryParams = [], saveToFile, confirmation } = params;
      // Gate destructive statements behind the confirmation literal regardless
      // of read-only mode — readonly already blocks writes at the server side
      // (PG error 25006), but in read-write mode there is no other safety net
      // against an LLM auto-completing TRUNCATE or DELETE-without-WHERE.
      const destructive = await classifyDestructive(query);

      if (destructive.isDestructive && confirmation !== DESTRUCTIVE_CONFIRMATION_VALUE) {
        return toolError(new Error(
          `Refused: ${destructive.reason ?? 'destructive statement'}. Pass the confirmation literal "${DESTRUCTIVE_CONFIRMATION_VALUE}" in the "confirmation" parameter once the user has approved this operation.`,
        ));
      }

      const validation = validateParams(queryParams);

      if ('error' in validation) {
        return toolError(validation.error);
      }

      const { params: validatedParams } = validation;

      try {
        if (saveToFile) {
          return await runSaveToFile(client, params, validatedParams);
        }

        const results = await client.executeQuery<Record<string, unknown>>(query, validatedParams);

        return toolSuccess({
          query,
          records: results,
          count: results.length,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
