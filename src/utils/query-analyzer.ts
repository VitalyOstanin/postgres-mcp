import { parse } from 'pgsql-parser';

/**
 * Checks if a PostgreSQL query supports cursor-based execution.
 * Currently, SELECT statements support cursors which allow streaming results.
 * Other statement types (INSERT, UPDATE, DELETE, DDL) do not support cursors.
 *
 * @param query The SQL query to analyze
 * @returns boolean indicating if the query supports cursor-based execution
 */
export async function supportsCursor(query: string): Promise<boolean> {
  try {
    // Parse the query to get its AST (Abstract Syntax Tree)
    const ast = await parse(query.trim());

    // The AST structure has stmts array, not a direct array
    // Access the statements from ast.stmts
    if (!Array.isArray(ast.stmts) || ast.stmts.length === 0) {
      return false;
    }

    // Get the first statement
    const stmt = ast.stmts[0]?.stmt;
    // Determine if the query is compatible with cursor-based execution
    // Based on PostgreSQL documentation, only certain statements support cursors
    // Primarily SELECT statements are compatible with cursors for streaming
    const isCursorCompatible = !!(
      stmt?.SelectStmt ?? // Direct SELECT statement
      stmt?.ValuesStmt   // VALUES statement (can be streamed in some cases)
    );

    return isCursorCompatible;
  } catch (_error) {
    // IMPORTANT: If parsing fails, we return false (no cursor support)
    // This is the safer approach - if we can't parse the query,
    // we assume it's not supported for cursor-based execution
    return false;
  }
}
