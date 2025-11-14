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
      description: 'Show detailed information about a PostgreSQL object (table, view, or function)',
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
            const columns = await client.executeQuery<ColumnInfo>(columnsQuery, [schema, name]);
            // Get table/view information
            const infoQuery = type === 'table'
              ? `SELECT table_name as name, 'table' as type FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`
              : `SELECT table_name as name, 'view' as type FROM information_schema.views WHERE table_schema = $1 AND table_name = $2`;
            const resultArray = await client.executeQuery<TableOrViewInfo>(infoQuery, [schema, name]);

            if (resultArray.length > 0) {
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
              const info = resultArray[0]!;

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

            if (resultArray.length > 0) {
              const [func] = resultArray;

              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
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
