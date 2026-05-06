import { parse } from 'pgsql-parser';

// Sentinel literal that must be passed explicitly to confirm a destructive
// operation. The value is intentionally long and unique so an LLM cannot pass
// it accidentally — the user has to see it in the tool description and
// consciously authorize the action.
export const DESTRUCTIVE_CONFIRMATION_VALUE = 'I_KNOW_THIS_IS_DESTRUCTIVE' as const;

export interface DestructiveCheck {
  isDestructive: boolean;
  // Human-readable reason for the destructive classification, suitable for
  // surfacing in an error message that explains why the confirmation literal
  // is required for this specific query.
  reason?: string;
}

// Statement types that we always treat as destructive irrespective of contents.
const ALWAYS_DESTRUCTIVE_KEYS = new Set<string>([
  'DropStmt',
  'DropdbStmt',
  'DropOwnedStmt',
  'DropRoleStmt',
  'DropTableSpaceStmt',
  'DropUserMappingStmt',
  'DropSubscriptionStmt',
  'TruncateStmt',
  'AlterTableStmt',
  'RenameStmt',
  'AlterObjectSchemaStmt',
  'AlterDatabaseStmt',
  'AlterRoleStmt',
]);

/**
 * Classify a SQL query as destructive based on its AST. Used to gate the
 * execute-sql tool: any query flagged here must be accompanied by the
 * destructive confirmation literal.
 *
 * Destructive cases:
 *  - DROP / TRUNCATE / ALTER family — always.
 *  - UPDATE without WHERE — bulk mutation.
 *  - DELETE without WHERE — bulk delete.
 *
 * Anything else (SELECT, scoped DELETE/UPDATE, INSERT, MERGE, DDL like CREATE)
 * is considered non-destructive at this layer. Insert/merge are left out
 * intentionally: they add data rather than removing it, and forcing
 * confirmation on every INSERT would defeat the ergonomic value of the gate.
 */
export async function classifyDestructive(query: string): Promise<DestructiveCheck> {
  const trimmed = query.trim();

  if (trimmed.length === 0) {
    return { isDestructive: false };
  }

  let ast;

  try {
    ast = await parse(trimmed);
  } catch {
    // Parser failure: defer to PostgreSQL itself rather than over-blocking
    // here. A syntax-broken query will be rejected by the server with a
    // clear error.
    return { isDestructive: false };
  }

  if (!Array.isArray(ast.stmts) || ast.stmts.length === 0) {
    return { isDestructive: false };
  }

  for (const wrapped of ast.stmts) {
    const stmt = wrapped?.stmt;

    if (!stmt || typeof stmt !== 'object') continue;

    for (const key of Object.keys(stmt)) {
      if (ALWAYS_DESTRUCTIVE_KEYS.has(key)) {
        return {
          isDestructive: true,
          reason: `${key} is always treated as destructive`,
        };
      }
    }

    const updateStmt = (stmt as Record<string, unknown>)['UpdateStmt'] as
      | { whereClause?: unknown }
      | undefined;

    if (updateStmt && !updateStmt.whereClause) {
      return {
        isDestructive: true,
        reason: 'UPDATE without WHERE clause — would mutate every row in the target table',
      };
    }

    const deleteStmt = (stmt as Record<string, unknown>)['DeleteStmt'] as
      | { whereClause?: unknown }
      | undefined;

    if (deleteStmt && !deleteStmt.whereClause) {
      return {
        isDestructive: true,
        reason: 'DELETE without WHERE clause — would delete every row in the target table',
      };
    }
  }

  return { isDestructive: false };
}
