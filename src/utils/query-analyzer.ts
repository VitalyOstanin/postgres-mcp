import { createHash } from 'node:crypto';
import { parse } from 'pgsql-parser';

// Statements that obviously do not support cursor-based streaming.
// Matched against the first keyword after stripping leading comments and
// whitespace. Used as a fast-path to avoid the WASM parser cost on every call.
const NON_CURSOR_FIRST_KEYWORDS = new Set([
  'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'TRUNCATE',
  'CREATE', 'ALTER', 'DROP', 'COMMENT', 'GRANT', 'REVOKE',
  'EXPLAIN', 'SHOW', 'SET', 'RESET',
  'VACUUM', 'ANALYZE', 'CLUSTER', 'REINDEX', 'REFRESH',
  'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE', 'PREPARE', 'EXECUTE', 'DEALLOCATE',
  'COPY', 'CALL', 'DO', 'LISTEN', 'NOTIFY', 'UNLISTEN',
  'LOCK', 'CHECKPOINT', 'DISCARD',
]);
// Cap the cache so a long-running session that sees many distinct queries
// cannot grow it without bound.
const CURSOR_CACHE_LIMIT = 256;
// Skip caching very large queries to avoid hashing megabyte-sized SQL on
// every call — the cache hit-rate on multi-KB ad-hoc SQL is near zero anyway.
const CACHE_QUERY_MAX_LENGTH = 4096;
const cursorCache = new Map<string, boolean>();

/**
 * Build a short, fixed-size cache key from the query text. Storing the full
 * SQL as the key would let a session that runs N distinct multi-KB queries
 * pin up to ~CURSOR_CACHE_LIMIT * length(query) bytes of heap. The hash
 * collision probability is negligible at sha1's 160 bits, and even on a
 * collision both queries would map to the same boolean (cursor / not), so
 * the worst case is a single mis-classification that the parser path would
 * have caught anyway.
 */
function cacheKey(trimmed: string): string {
  return createHash('sha1').update(trimmed).digest('hex');
}

function rememberInCache(query: string, value: boolean): boolean {
  if (query.length > CACHE_QUERY_MAX_LENGTH) {
    return value;
  }

  const key = cacheKey(query);

  if (cursorCache.size >= CURSOR_CACHE_LIMIT) {
    // Drop the oldest entry. Map iteration order is insertion order, so
    // shifting the first key works as a poor-man's LRU.
    const oldestKey = cursorCache.keys().next().value;

    if (oldestKey !== undefined) {
      cursorCache.delete(oldestKey);
    }
  }
  cursorCache.set(key, value);

  return value;
}

function readFromCache(query: string): boolean | undefined {
  if (query.length > CACHE_QUERY_MAX_LENGTH) {
    return undefined;
  }

  return cursorCache.get(cacheKey(query));
}

/**
 * Strip leading SQL comments (-- line and / * block * /) and whitespace, then
 * return the first uppercase keyword. Returns an empty string if the query is
 * blank or only contains comments.
 */
function firstKeyword(query: string): string {
  let i = 0;

  while (i < query.length) {
    const ch = query[i];

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    if (ch === '-' && query[i + 1] === '-') {
      const newline = query.indexOf('\n', i);

      if (newline === -1) {
        return '';
      }

      i = newline + 1;
      continue;
    }

    if (ch === '/' && query[i + 1] === '*') {
      const close = query.indexOf('*/', i + 2);

      if (close === -1) {
        return '';
      }

      i = close + 2;
      continue;
    }

    break;
  }

  let end = i;

  // Match a full SQL identifier (letters, digits, underscores) so that a
  // user-defined function like `mydb_func()` is split as a single token rather
  // than producing a partial keyword `MYDB` that could accidentally collide
  // with a real keyword if any future entry in NON_CURSOR_FIRST_KEYWORDS ever
  // contained a digit or underscore.
  while (end < query.length && /[A-Za-z0-9_]/.test(query[end] ?? '')) {
    end++;
  }

  return query.slice(i, end).toUpperCase();
}

/**
 * Checks if a PostgreSQL query supports cursor-based execution.
 *
 * SELECT, WITH ... SELECT, and VALUES statements support cursors. Anything
 * else (DML, DDL, utility) does not. Uses a keyword-prefix fast path to
 * avoid invoking the heavy `pgsql-parser` WASM on the obvious cases.
 */
export async function supportsCursor(query: string): Promise<boolean> {
  const trimmed = query.trim();

  if (trimmed.length === 0) {
    return false;
  }

  const cached = readFromCache(trimmed);

  if (cached !== undefined) {
    return cached;
  }

  const keyword = firstKeyword(trimmed);

  if (keyword === '') {
    return rememberInCache(trimmed, false);
  }

  if (NON_CURSOR_FIRST_KEYWORDS.has(keyword)) {
    return rememberInCache(trimmed, false);
  }

  // For SELECT / WITH / VALUES we still parse with pgsql-parser: the parser
  // catches syntax errors and write-CTEs (WITH ... INSERT) that the keyword
  // prefix cannot detect. The fast-path above covers all clear-cut writes.

  try {
    const ast = await parse(trimmed);

    if (!Array.isArray(ast.stmts) || ast.stmts.length === 0) {
      return rememberInCache(trimmed, false);
    }

    const stmt = ast.stmts[0]?.stmt;
    const isCursorCompatible = !!(stmt?.SelectStmt ?? stmt?.ValuesStmt);

    return rememberInCache(trimmed, isCursorCompatible);
  } catch {
    // Parser failure: assume not supported. Do not cache parser errors so
    // a transient failure does not stick to the query forever.
    return false;
  }
}
