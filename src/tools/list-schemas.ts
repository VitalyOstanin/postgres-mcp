import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';

const listSchemasSchema = z.object({
  limit: z.number().int().min(1).max(1000).optional().default(100).describe('Maximum number of schemas to return (default: 100, max: 1000)'),
  offset: z.number().int().min(0).optional().default(0).describe('Number of schemas to skip for pagination (default: 0)'),
});

export type ListSchemasParams = z.infer<typeof listSchemasSchema>;

export function registerListSchemasTool(server: McpServer, client: PostgreSQLClient): void {
  server.registerTool(
    'list-schemas',
    {
      title: 'List Schemas',
      description: [
        'List all schemas in the PostgreSQL database (excludes the system schemas information_schema, pg_catalog, pg_toast).',
        'Use for: discovering available schemas before drilling down into objects with `list-objects`.',
        'Returns: `schemas` (array of names), `count`, pagination metadata (`limit`, `offset`, `hasMore`).',
        'Limitations: results are paginated (default limit 100, max 1000); use `offset` to walk further pages.',
      ].join(' '),
      inputSchema: listSchemasSchema.shape,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (params: ListSchemasParams, _extra) => {
      const { limit, offset } = params;

      if (!client.isConnectedToPostgreSQL()) {
        return toolError(new Error('Not connected to PostgreSQL. Please connect first.'));
      }

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
