import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PostgreSQLClient } from '../postgres-client.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';
import { quoteIdent, quoteQualified } from '../utils/sql-identifier.js';
import { DESTRUCTIVE_CONFIRMATION_VALUE } from '../utils/confirmation.js';
import { requireConnection } from '../utils/connection-guard.js';
import { paginationLimitSchema, paginationOffsetSchema } from '../utils/pagination.js';

const indexOperationSchema = z.object({
  operation: z.enum(['create', 'drop', 'list']).describe('Operation to perform: create, drop or list indexes'),
  schema: z.string().optional().default('public').describe('Schema name where the table is located'),

  // Required for create; for drop, optional — when provided, the tool verifies
  // the named index actually belongs to that table before issuing DROP. For
  // list, narrows results to a single table. `tableName` is kept as a
  // deprecated alias and still accepted.
  table: z.string().optional().describe('Table name. Required for create; for drop, optional — when set, the tool verifies the index belongs to this table before dropping. For list, narrows the result to a specific table.'),
  name: z.string().optional().describe('Index name (required for create/drop)'),
  columns: z.array(z.string()).optional().describe('Array of column names to include in the index (required for create)'),
  unique: z.boolean().optional().default(false).describe('Whether to create a unique index'),
  ifNotExists: z.boolean().optional().default(false).describe('Add IF NOT EXISTS clause to prevent errors if index already exists (for create)'),
  concurrently: z.boolean().optional().default(false).describe('Use CONCURRENTLY for create/drop — does not block reads/writes on the table, but takes longer and cannot run inside a transaction'),

  // Parameters for DROP operation
  ifExists: z.boolean().optional().default(false).describe('Add IF EXISTS clause to prevent errors if index does not exist (for drop)'),
  confirmation: z.string().optional().describe(`Required when operation=drop. Must be exactly the string "${DESTRUCTIVE_CONFIRMATION_VALUE}" to confirm the index drop.`),

  // Parameters for LIST operation
  tableName: z.string().optional().describe('Deprecated alias of `table` for list operation. Use `table` instead.'),
  limit: paginationLimitSchema('rows'),
  offset: paginationOffsetSchema('rows'),
});

export type IndexOperationParams = z.infer<typeof indexOperationSchema>;

interface IndexRow {
  table_name: string;
  index_name: string;
  is_unique: boolean;
  columns: string;
}

// Track whether we have already warned about the deprecated `tableName` alias
// so the warning fires once per process lifetime instead of on every call.
let deprecatedTableNameWarned = false;

function optionalSqlClause(flag: boolean | undefined, keyword: string): string {
  return flag ? keyword : '';
}

async function runCreate(client: PostgreSQLClient, params: IndexOperationParams, schema: string): Promise<CallToolResult> {
  const { table, name, columns, unique, ifNotExists, concurrently } = params;

  if (!table || !name || !columns || columns.length === 0) {
    return toolError(new Error('For create operation: table, name, and columns are required'));
  }

  // PostgreSQL rejects CREATE UNIQUE INDEX CONCURRENTLY only in
  // older versions; modern PG (>= 9.2) supports it. Still, the
  // semantic is subtle (the index isn't valid until the second
  // pass), so flag the combination as not supported by this tool.
  if (concurrently && unique) {
    return toolError(new Error('concurrently=true cannot be combined with unique=true in this tool'));
  }

  const uniqueClause = optionalSqlClause(unique, 'UNIQUE');
  const concurrentlyClause = optionalSqlClause(concurrently, 'CONCURRENTLY');
  const ifNotExistsClause = optionalSqlClause(ifNotExists, 'IF NOT EXISTS');
  const columnsStr = columns.map(col => quoteIdent(col)).join(', ');
  const query = `CREATE ${uniqueClause} INDEX ${concurrentlyClause} ${ifNotExistsClause} ${quoteIdent(name)} ON ${quoteQualified(schema, table)} (${columnsStr})`;

  await client.executeQuery<Record<string, unknown>>(query);

  return toolSuccess({
    operation: 'create',
    schema,
    table,
    name,
    columns,
    unique,
    concurrently,
    message: `Index "${name}" created successfully on table "${schema}"."${table}"`,
  });
}

interface IndexLookupRow {
  oid: number;
  table_name: string;
}

async function runDrop(client: PostgreSQLClient, params: IndexOperationParams, schema: string): Promise<CallToolResult> {
  const { table, name, ifExists, concurrently, confirmation } = params;

  if (!name) {
    return toolError(new Error('For drop operation: name is required'));
  }

  if (confirmation !== DESTRUCTIVE_CONFIRMATION_VALUE) {
    return toolError(new Error(
      `Refused: index drop is destructive. Pass the confirmation literal "${DESTRUCTIVE_CONFIRMATION_VALUE}" in the "confirmation" parameter once the user has approved this operation.`,
    ));
  }

  const lookupSql = `SELECT i.oid::int8 AS oid, t.relname AS table_name
                       FROM pg_class i
                       JOIN pg_namespace n ON n.oid = i.relnamespace
                       JOIN pg_index ix ON ix.indexrelid = i.oid
                       JOIN pg_class t ON t.oid = ix.indrelid
                      WHERE i.relkind IN ('i', 'I')
                        AND n.nspname = $1
                        AND i.relname = $2`;

  if (concurrently) {
    // DROP INDEX CONCURRENTLY cannot run inside a transaction (PostgreSQL
    // restriction), so we issue lookup and drop separately. There is an
    // inherent race window between the two queries — a parallel session
    // could replace the index with another of the same name on a
    // different table. We mitigate by re-checking the OID after the drop
    // and reporting only what we actually removed.
    const lookup = await client.executeQuery<IndexLookupRow>(lookupSql, [schema, name]);

    if (lookup.length === 0) {
      if (ifExists) {
        return toolSuccess({
          operation: 'drop',
          schema,
          table,
          name,
          dropped: false,
          message: `Index "${schema}"."${name}" does not exist; skipped (ifExists=true)`,
        });
      }

      return toolError(new Error(`Index "${schema}"."${name}" does not exist`));
    }

    const lookupRow = lookup[0];
    const lookupOid = lookupRow?.oid;
    const actualTable = lookupRow?.table_name;

    if (table && actualTable !== table) {
      return toolError(new Error(
        `Index "${schema}"."${name}" belongs to table "${actualTable}", not "${table}". Re-issue the drop with the correct table, or omit \`table\` to skip the check.`,
      ));
    }

    const ifExistsClause = optionalSqlClause(ifExists, 'IF EXISTS');
    const dropSql = `DROP INDEX CONCURRENTLY ${ifExistsClause} ${quoteQualified(schema, name)}`;

    await client.executeQuery<Record<string, unknown>>(dropSql);

    // Verify that the OID we looked up is gone. If a parallel session
    // recreated an index with the same name between lookup and drop, the
    // current row in pg_class will have a different OID — we only claim
    // success for the OID we actually dropped.
    const verify = await client.executeQuery<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM pg_class WHERE oid = $1) AS exists',
      [lookupOid],
    );
    const dropped = !verify[0]?.exists;

    return toolSuccess({
      operation: 'drop',
      schema,
      table: actualTable,
      name,
      concurrently: true,
      dropped,
      message: dropped
        ? `DROP INDEX CONCURRENTLY issued for "${schema}"."${name}" (oid ${lookupOid}); index was removed.`
        : `DROP INDEX CONCURRENTLY issued for "${schema}"."${name}", but a row with oid ${lookupOid} still exists in pg_class — concurrent activity may have replaced the index.`,
    });
  }

  // Non-concurrent path: wrap lookup + drop in a single transaction so a
  // parallel session cannot swap the index between the two statements.
  return client.withTransaction(async (run) => {
    const lookup = await run<IndexLookupRow>(lookupSql, [schema, name]);

    if (lookup.length === 0) {
      if (ifExists) {
        return toolSuccess({
          operation: 'drop',
          schema,
          table,
          name,
          dropped: false,
          message: `Index "${schema}"."${name}" does not exist; skipped (ifExists=true)`,
        });
      }

      return toolError(new Error(`Index "${schema}"."${name}" does not exist`));
    }

    const lookupRow = lookup[0];
    const actualTable = lookupRow?.table_name;

    if (table && actualTable !== table) {
      return toolError(new Error(
        `Index "${schema}"."${name}" belongs to table "${actualTable}", not "${table}". Re-issue the drop with the correct table, or omit \`table\` to skip the check.`,
      ));
    }

    const ifExistsClause = optionalSqlClause(ifExists, 'IF EXISTS');
    const dropSql = `DROP INDEX ${ifExistsClause} ${quoteQualified(schema, name)}`;

    await run<Record<string, unknown>>(dropSql);

    return toolSuccess({
      operation: 'drop',
      schema,
      table: actualTable,
      name,
      concurrently: false,
      dropped: true,
      message: `Index "${name}" dropped successfully from table "${schema}"."${actualTable}"`,
    });
  });
}

async function runList(client: PostgreSQLClient, params: IndexOperationParams, schema: string): Promise<CallToolResult> {
  const { tableName, table, limit, offset } = params;

  // Accept either `table` (canonical) or `tableName` (deprecated)
  // to filter list results to a specific table. Warn once per process
  // when only the deprecated alias is supplied.
  if (tableName !== undefined && table === undefined && !deprecatedTableNameWarned) {
    deprecatedTableNameWarned = true;
    console.warn('[postgres-mcp] index-operation: parameter `tableName` is deprecated; use `table` instead.');
  }

  const searchTable = table ?? tableName;
  // Cover both ordinary tables (`r`) and partitioned parents (`p`) so the
  // list view is consistent with what `drop` operates on (drop already
  // accepts `relkind IN ('i', 'I')`, which covers indexes on partitions).
  const tableRelkindFilter = `t.relkind IN ('r', 'p')`;
  let query: string;
  let queryParams: Array<string | number>;

  if (searchTable) {
    // List indexes for a specific table aggregated by index, so LIMIT/OFFSET
    // applies to indexes (not row-per-column rows). string_agg preserves
    // attnum order so multi-column indexes show their column order.
    query = `
      SELECT
        t.relname AS table_name,
        i.relname AS index_name,
        ix.indisunique AS is_unique,
        string_agg(a.attname, ', ' ORDER BY a.attnum) AS columns
      FROM pg_index ix
      INNER JOIN pg_class t ON t.oid = ix.indrelid
      INNER JOIN pg_class i ON i.oid = ix.indexrelid
      INNER JOIN pg_namespace n ON n.oid = t.relnamespace
      INNER JOIN pg_attribute a
        ON a.attrelid = t.oid
        AND a.attnum = ANY(ix.indkey)
      WHERE ${tableRelkindFilter}
        AND t.relname = $1
        AND n.nspname = $2
      GROUP BY t.relname, i.relname, ix.indisunique
      ORDER BY t.relname, i.relname
      LIMIT $3 OFFSET $4
    `;
    queryParams = [searchTable, schema, limit + 1, offset];
  } else {
    // List all indexes in the schema, aggregated per index.
    //
    // Apply LIMIT/OFFSET to the index list FIRST, then pull
    // column names only for the paged indexes via LATERAL JOIN.
    query = `
      WITH paged_indexes AS (
        SELECT
          ix.indrelid,
          ix.indkey,
          ix.indisunique,
          t.relname AS table_name,
          i.relname AS index_name
        FROM pg_index ix
        INNER JOIN pg_class t ON t.oid = ix.indrelid
        INNER JOIN pg_class i ON i.oid = ix.indexrelid
        INNER JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE ${tableRelkindFilter}
          AND n.nspname = $1
        ORDER BY t.relname, i.relname
        LIMIT $2 OFFSET $3
      )
      SELECT
        pi.table_name,
        pi.index_name,
        cols.columns,
        pi.indisunique AS is_unique
      FROM paged_indexes pi
      CROSS JOIN LATERAL (
        SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) AS columns
        FROM pg_attribute a
        WHERE a.attrelid = pi.indrelid
          AND a.attnum = ANY(pi.indkey)
      ) cols
      ORDER BY pi.table_name, pi.index_name
    `;
    queryParams = [schema, limit + 1, offset];
  }

  const indexes = await client.executeQuery<IndexRow>(query, queryParams);
  const hasMore = indexes.length > limit;
  const page = hasMore ? indexes.slice(0, limit) : indexes;
  // Surface a structured deprecation hint in the response so MCP hosts can
  // pass it back to the user even when stderr (where console.warn lands)
  // is not visible.
  const warnings = (tableName !== undefined && table === undefined)
    ? ['Parameter `tableName` is deprecated; use `table` instead.']
    : undefined;

  return toolSuccess({
    operation: 'list',
    schema,
    table: searchTable,
    indexes: page,
    count: page.length,
    limit,
    offset,
    hasMore,
    ...(warnings ? { warnings } : {}),
  });
}

/**
 * Register the `index-operation` MCP tool. Provides three subcommands —
 * `create`, `drop`, `list` — for managing PostgreSQL indexes. The
 * destructive subcommand (`drop`) requires an explicit confirmation literal.
 */
export function registerIndexOperationTool(server: McpServer, client: PostgreSQLClient): void {
  server.registerTool(
    'index-operation',
    {
      title: 'Index Operations',
      description: [
        'Create, drop, or list indexes on PostgreSQL tables.',
        'Use for: adding a new (optionally unique) index on one or more columns; dropping an existing index; auditing the indexes that already exist on a table or in a schema.',
        'Operation `create`: requires `table`, `name`, `columns`. Optional: `unique`, `ifNotExists`, `concurrently`. Identifiers are escaped server-side.',
        'Operation `drop`: requires `name`. Optional: `table` (when set, the tool verifies that the index belongs to the given table before dropping), `ifExists`, `concurrently`. With `concurrently=false` the lookup and drop run inside a single transaction; with `concurrently=true` they cannot (PostgreSQL restriction) and the tool reports the post-drop OID check instead.',
        'Operation `list`: optional `table` (or deprecated `tableName`) to narrow results; supports `limit`/`offset` pagination (default 100, max 1000). Each row reports `columns` aggregated in attnum order so LIMIT/OFFSET applies to indexes (not per-column rows). Includes indexes on ordinary tables and partitioned parents (relkind `r` and `p`).',
        'Limitations: in read-only mode `create` and `drop` are rejected — only `list` is permitted. `concurrently` cannot be combined with `unique` for CREATE INDEX (this tool\'s constraint).',
      ].join(' '),
      inputSchema: indexOperationSchema.shape,
      annotations: {
        // Combined create/drop/list tool: operation=list is read-only,
        // create/drop are write-side and drop is destructive. The hints
        // describe the worst case so MCP hosts can apply the strictest
        // confirmation flow regardless of which subcommand is chosen.
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: IndexOperationParams) => {
      const guard = requireConnection(client);

      if (guard) return guard;

      const { operation, schema = 'public' } = params;

      // Defense-in-depth: PostgreSQL would reject CREATE/DROP INDEX with
      // error 25006 (read_only_sql_transaction) on a session opened with
      // `default_transaction_read_only=on` (see PostgreSQLClient.connect),
      // but rejecting at the tool boundary returns a domain-specific error
      // message ("Cannot perform index operation in read-only mode") that's
      // clearer to LLM clients than the raw PG error code.
      if (client.isReadonly() && operation !== 'list') {
        return toolError(new Error('Cannot perform index operation in read-only mode'));
      }

      try {
        switch (operation) {
          case 'create':
            return await runCreate(client, params, schema);
          case 'drop':
            return await runDrop(client, params, schema);
          case 'list':
            return await runList(client, params, schema);
        }
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
