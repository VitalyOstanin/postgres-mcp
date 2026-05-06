import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';

const listObjectsSchema = z.object({
  schema: z.string().optional().default('public').describe('Schema name to list objects from'),
  type: z.enum(['table', 'view', 'function', 'procedure', 'all']).optional().default('all').describe('Type of objects to list'),
  nameLike: z.string().optional().describe('Optional ILIKE pattern (use `%` for wildcards, `_` for single character) to filter object names server-side'),
  limit: z.number().int().min(1).max(1000).optional().default(100).describe('Maximum number of objects to return (default: 100, max: 1000)'),
  offset: z.number().int().min(0).optional().default(0).describe('Number of objects to skip for pagination (default: 0)'),
});

export type ListObjectsParams = z.infer<typeof listObjectsSchema>;

export function registerListObjectsTool(server: McpServer, client: PostgreSQLClient): void {
  server.registerTool(
    'list-objects',
    {
      title: 'List Objects',
      description: [
        'List objects (tables, views, functions, procedures) in a PostgreSQL schema.',
        'Use for: browsing what is available in a schema; narrowing by `type` (`table` / `view` / `function` / `procedure` / `all`); filtering by name pattern via `nameLike` (an ILIKE pattern, e.g. `user_%`).',
        'Returns: `objects` ([{ name, type }]), `count`, pagination metadata (`limit`, `offset`, `hasMore`).',
        'Limitations: aggregate functions are excluded; only `prokind` IN (`f`, `p`, `w`) are reported. Pagination defaults to 100 rows (max 1000).',
      ].join(' '),
      inputSchema: listObjectsSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: ListObjectsParams) => {
      const { schema = 'public', type = 'all', nameLike, limit, offset } = params;

      if (!client.isConnectedToPostgreSQL()) {
        return toolError(new Error('Not connected to PostgreSQL. Please connect first.'));
      }

      try {
        // Use placeholder $1 = schema, $2 = nameLike pattern (or null if not
        // provided). This way the ILIKE clause is harmless when no filter is
        // requested: `name ILIKE '%'` matches everything, and the IS NULL
        // branch lets a null parameter mean "no filter".
        const namePattern = nameLike ?? null;
        // Anchored-to-end behavior is up to the caller — we pass the pattern
        // through verbatim so users can use `%` / `_` as documented.
        let baseQuery = '';

        switch (type) {
          case 'table':
            baseQuery = `
              SELECT table_name as name, 'table' as type
              FROM information_schema.tables
              WHERE table_schema = $1
                AND table_type = 'BASE TABLE'
                AND ($2::text IS NULL OR table_name ILIKE $2)
              ORDER BY table_name
            `;
            break;
          case 'view':
            baseQuery = `
              SELECT table_name as name, 'view' as type
              FROM information_schema.views
              WHERE table_schema = $1
                AND ($2::text IS NULL OR table_name ILIKE $2)
              ORDER BY table_name
            `;
            break;
          case 'function':
            baseQuery = `
              SELECT p.proname as name, 'function' as type
              FROM pg_proc p
              JOIN pg_namespace n ON p.pronamespace = n.oid
              WHERE n.nspname = $1
                AND p.prokind = 'f'
                AND ($2::text IS NULL OR p.proname ILIKE $2)
              ORDER BY p.proname
            `;
            break;
          case 'procedure':
            baseQuery = `
              SELECT p.proname as name, 'procedure' as type
              FROM pg_proc p
              JOIN pg_namespace n ON p.pronamespace = n.oid
              WHERE n.nspname = $1
                AND p.prokind = 'p'
                AND ($2::text IS NULL OR p.proname ILIKE $2)
              ORDER BY p.proname
            `;
            break;
          case 'all':
          default:
            // Each UNION ALL branch carries its own ORDER BY / LIMIT so the
            // planner can stop after producing at most `limit + offset + 1`
            // rows per source instead of materialising every table, view,
            // and routine in the schema before sorting and slicing. Worst
            // case (all selected rows fall into one branch) we still need
            // `limit + offset + 1` from each source — adding `+1` keeps
            // `hasMore` computable from the outer LIMIT.
            baseQuery = `
              SELECT name, type FROM (
                (
                  SELECT table_name as name, 'table' as type
                  FROM information_schema.tables
                  WHERE table_schema = $1
                    AND table_type = 'BASE TABLE'
                    AND ($2::text IS NULL OR table_name ILIKE $2)
                  ORDER BY table_name
                  LIMIT $3
                )
                UNION ALL
                (
                  SELECT table_name as name, 'view' as type
                  FROM information_schema.views
                  WHERE table_schema = $1
                    AND ($2::text IS NULL OR table_name ILIKE $2)
                  ORDER BY table_name
                  LIMIT $3
                )
                UNION ALL
                (
                  SELECT p.proname as name,
                         CASE p.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END as type
                  FROM pg_proc p
                  JOIN pg_namespace n ON p.pronamespace = n.oid
                  WHERE n.nspname = $1
                    AND p.prokind IN ('f', 'p')
                    AND ($2::text IS NULL OR p.proname ILIKE $2)
                  ORDER BY p.proname
                  LIMIT $3
                )
              ) all_objects
              ORDER BY name
            `;
            break;
        }

        // 'all' uses three params already ($1 schema, $2 nameLike, $3
        // per-branch LIMIT cap), so the outer LIMIT/OFFSET take $4/$5.
        // Single-source variants use only $1/$2 inside `baseQuery`, so
        // the outer LIMIT/OFFSET are $3/$4.
        const query = type === 'all'
          ? `${baseQuery} LIMIT $4 OFFSET $5`
          : `${baseQuery} LIMIT $3 OFFSET $4`;
        const queryParams: unknown[] = type === 'all'
          ? [schema, namePattern, limit + offset + 1, limit + 1, offset]
          : [schema, namePattern, limit + 1, offset];
        const objects = await client.executeQuery<{ name: string; type: string }>(query, queryParams);
        const hasMore = objects.length > limit;
        const page = hasMore ? objects.slice(0, limit) : objects;

        return toolSuccess({
          schema,
          type,
          nameLike: namePattern,
          objects: page,
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
