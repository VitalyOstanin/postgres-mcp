import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';
import { requireConnection } from '../utils/connection-guard.js';
import { paginationLimitSchema, paginationOffsetSchema } from '../utils/pagination.js';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../defaults.js';

const listSchemasSchema = z.object({
  limit: paginationLimitSchema('schemas'),
  offset: paginationOffsetSchema('schemas'),
});

export type ListSchemasParams = z.infer<typeof listSchemasSchema>;

/**
 * Register the `list-schemas` MCP tool. Lists user-visible PostgreSQL
 * schemas (excludes the built-in catalog schemas) with offset/limit
 * pagination.
 */
export function registerListSchemasTool(server: McpServer, client: PostgreSQLClient): void {
  server.registerTool(
    'list-schemas',
    {
      title: 'List Schemas',
      description: [
        'List all schemas in the PostgreSQL database (excludes the system schemas information_schema, pg_catalog, pg_toast).',
        'Use for: discovering available schemas before drilling down into objects with `list-objects`.',
        'Returns: `schemas` (array of names), `count`, pagination metadata (`limit`, `offset`, `hasMore`).',
        `Limitations: results are paginated (default limit ${DEFAULT_PAGE_LIMIT}, max ${MAX_PAGE_LIMIT}); use \`offset\` to walk further pages.`,
      ].join(' '),
      inputSchema: listSchemasSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: ListSchemasParams, _extra) => {
      const guard = requireConnection(client);

      if (guard) return guard;

      const { limit, offset } = params;

      try {
        // Fetch one extra row so we can report hasMore without a second query.
        const schemas = await client.executeQuery<{ schema_name: string }>(
          `SELECT schema_name
           FROM information_schema.schemata
           WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
           ORDER BY schema_name
           LIMIT $1 OFFSET $2`,
          [limit + 1, offset],
        );
        const hasMore = schemas.length > limit;
        const page = hasMore ? schemas.slice(0, limit) : schemas;

        return toolSuccess({
          schemas: page.map(schema => schema.schema_name),
          count: page.length,
          limit,
          offset,
          hasMore,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
