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

interface FunctionWithDefinition {
  name: string;
  schema: string;
  type: string;
  arguments: string;
  returnType: string;
  definition: string;
}

export function registerShowObjectTool(server: McpServer, client: PostgreSQLClient): void {
  server.registerTool(
    'show-object',
    {
      title: 'Show Object',
      description: [
        'Show detailed information about a PostgreSQL object (table, view, or function).',
        'Use for: inspecting columns, data types, defaults, nullability of a table or view; reading the full source definition of a function.',
        'Returns (table/view): `{ name, type, columns: [{ name, type, nullable, default, maxLength, precision, scale }] }`. Returns (function): `{ name, schema, type, arguments, returnType, definition }`.',
        'Limitations: when multiple functions share the same name (overloading), only the first match is returned. Function definitions can include credentials embedded in SECURITY DEFINER bodies — consider that before sharing the output.',
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
        let result: TableWithColumns | FunctionWithDefinition | null = null;

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
            // Get table/view information
            const infoQuery = type === 'table'
              ? `SELECT table_name as name, 'table' as type FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`
              : `SELECT table_name as name, 'view' as type FROM information_schema.views WHERE table_schema = $1 AND table_name = $2`;
            // Run both queries in parallel: with `pool max >= 2` they fan out
            // across two physical connections; with `pool max = 1` they
            // serialize at the pool level but at least we don't pay two
            // sequential client.connect()/release() round-trips here.
            const [columns, resultArray] = await Promise.all([
              client.executeQuery<ColumnInfo>(columnsQuery, [schema, name]),
              client.executeQuery<TableOrViewInfo>(infoQuery, [schema, name]),
            ]);
            const info = resultArray[0];

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
            const functionQuery = `
              SELECT
                p.proname as name,
                n.nspname as schema,
                pg_get_functiondef(p.oid) as definition,
                pg_get_function_arguments(p.oid) as arguments,
                t.typname as return_type
              FROM pg_proc p
              JOIN pg_namespace n ON p.pronamespace = n.oid
              JOIN pg_type t ON p.prorettype = t.oid
              WHERE n.nspname = $1 AND p.proname = $2
            `;
            const resultArray = await client.executeQuery<FunctionInfo>(functionQuery, [schema, name]);
            const func = resultArray[0];

            if (func) {
              result = {
                name: func.name,
                schema: func.schema,
                type: 'function',
                arguments: func.arguments,
                returnType: func.return_type,
                definition: func.definition,
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
