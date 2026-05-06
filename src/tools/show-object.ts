import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';

const showObjectSchema = z.object({
  schema: z.string().optional().default('public').describe('Schema name where the object is located'),
  name: z.string().describe('Object name (table, view, or function name)'),
  type: z.enum(['table', 'view', 'function']).describe('Type of the object to show'),
});

export type ShowObjectParams = z.infer<typeof showObjectSchema>;

interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: string; // 'YES' or 'NO'
  column_default: string | null;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
}

interface TableOrViewInfo {
  name: string;
  type: string;
}

interface FunctionInfo {
  name: string;
  schema: string;
  definition: string;
  arguments: string;
  identity_arguments: string;
  return_type: string;
}

interface TableWithColumns {
  name: string;
  type: string;
  columns: Array<{
    name: string;
    type: string;
    nullable: boolean;
    default: string | null;
    maxLength: number | null;
    precision: number | null;
    scale: number | null;
  }>;
}

interface FunctionOverload {
  arguments: string;
  identityArguments: string;
  returnType: string;
  definition: string;
}

interface FunctionWithOverloads {
  name: string;
  schema: string;
  type: 'function';
  overloads: FunctionOverload[];
}

export function registerShowObjectTool(server: McpServer, client: PostgreSQLClient): void {
  server.registerTool(
    'show-object',
    {
      title: 'Show Object',
      description: [
        'Show detailed information about a PostgreSQL object (table, view, or function).',
        'Use for: inspecting columns, data types, defaults, nullability of a table or view; reading the full source definition of a function.',
        'Returns (table/view): `{ name, type, columns: [{ name, type, nullable, default, maxLength, precision, scale }] }`. Returns (function): `{ name, schema, type, overloads: [{ arguments, identityArguments, returnType, definition }] }` — every overload sharing the name is included; `identityArguments` uniquely identifies an overload (use it with `DROP FUNCTION schema.name(identityArguments)`).',
        'Limitations: function definitions can include credentials embedded in SECURITY DEFINER bodies — consider that before sharing the output.',
      ].join(' '),
      inputSchema: showObjectSchema.shape,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (params: ShowObjectParams) => {
      const { schema = 'public', name, type } = params;

      if (!client.isConnectedToPostgreSQL()) {
        return toolError(new Error('Not connected to PostgreSQL. Please connect first.'));
      }

      try {
        let result: TableWithColumns | FunctionWithOverloads | null = null;

        switch (type) {
          case 'table':
          case 'view': {
            // Get column information
            const columnsQuery = `
              SELECT
                column_name,
                data_type,
                is_nullable,
                column_default,
                character_maximum_length,
                numeric_precision,
                numeric_scale
              FROM information_schema.columns
              WHERE table_schema = $1 AND table_name = $2
              ORDER BY ordinal_position
            `;
            const columns = await client.executeQuery<ColumnInfo>(columnsQuery, [schema, name]);
            // Happy path: columns came back, so the object exists. Skip
            // the second round-trip and synthesise {name, type} from the
            // request. With the default `pool max=1` this halves
            // tool-call latency for the common case.
            let info: TableOrViewInfo | undefined;

            if (columns.length > 0) {
              info = { name, type };
            } else {
              // No columns: distinguish "object missing" from the rare
              // "object exists but has no columns" by falling back to
              // the catalog. Still cheap because it only fires on the
              // empty-column edge case.
              const existsQuery = type === 'table'
                ? `SELECT table_name as name, 'table' as type FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`
                : `SELECT table_name as name, 'view' as type FROM information_schema.views WHERE table_schema = $1 AND table_name = $2`;
              const resultArray = await client.executeQuery<TableOrViewInfo>(existsQuery, [schema, name]);

              info = resultArray[0];
            }
            if (info) {
              result = {
                name: info.name,
                type: info.type,
                columns: columns.map(col => ({
                  name: col.column_name,
                  type: col.data_type,
                  nullable: col.is_nullable === 'YES',
                  default: col.column_default,
                  maxLength: col.character_maximum_length,
                  precision: col.numeric_precision,
                  scale: col.numeric_scale,
                })),
              };
            }
            break;
          }

          case 'function': {
            // Return every overload sharing this name. `identity_arguments`
            // gives the unambiguous form (without parameter names, modes, or
            // defaults) that DROP FUNCTION expects. Restrict to functions
            // and procedures (`prokind IN ('f', 'p')`); aggregates and
            // window functions can be added later if needed.
            const functionQuery = `
              SELECT
                p.proname as name,
                n.nspname as schema,
                pg_get_functiondef(p.oid) as definition,
                pg_get_function_arguments(p.oid) as arguments,
                pg_get_function_identity_arguments(p.oid) as identity_arguments,
                t.typname as return_type
              FROM pg_proc p
              JOIN pg_namespace n ON p.pronamespace = n.oid
              JOIN pg_type t ON p.prorettype = t.oid
              WHERE n.nspname = $1 AND p.proname = $2
                AND p.prokind IN ('f', 'p')
              ORDER BY pg_get_function_identity_arguments(p.oid)
            `;
            const resultArray = await client.executeQuery<FunctionInfo>(functionQuery, [schema, name]);

            if (resultArray.length > 0) {
              const first = resultArray[0];

              if (!first) break;
              result = {
                name: first.name,
                schema: first.schema,
                type: 'function',
                overloads: resultArray.map(row => ({
                  arguments: row.arguments,
                  identityArguments: row.identity_arguments,
                  returnType: row.return_type,
                  definition: row.definition,
                })),
              };
            }
            break;
          }
        }

        if (!result) {
          return toolError(new Error(`Object "${name}" of type "${type}" does not exist in schema "${schema}"`));
        }

        return toolSuccess(result);
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
