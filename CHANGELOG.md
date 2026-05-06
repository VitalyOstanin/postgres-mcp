# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Table of Contents

- [0.2.0](#020---2026-05-06)
- [0.1.0](#010)

## [0.2.0] - 2026-05-06

> **Breaking changes:** `engines.node` is now `>=22.0.0` (was `>=20.0.0`); `zod` major upgrade (3 → 4); `show-object` returns function overloads as `overloads[]` instead of a single flat object. See *Changed* / *Removed*.

### Added
- Identifier escaping helper (`quoteIdent`/`quoteQualified`) for the `index-operation` tool, eliminating SQL injection through `schema`/`table`/`name`/`columns` parameters.
- `validateSafeOutputPath` helper restricting `execute-sql` `filePath` writes to the OS temp directory; extendable via the `POSTGRES_MCP_OUTPUT_DIRS` environment variable (`:`-separated whitelist).
- `redactConnectionString` helper masking passwords in any text that passes through error responses or stderr logs (URL form `postgres(?:ql)?://user:pass@host`, libpq `password=...`, URL-encoded escapes like `%20` / `%3A`).
- Pagination (`limit`/`offset`/`hasMore`) on `list-schemas`, `list-objects`, and `index-operation list`.
- `structuredContent` is now populated alongside the text response on every tool result for clients with an output schema.
- Graceful shutdown: SIGINT/SIGTERM now triggers an orderly pool teardown; signal handlers wait for startup to settle before calling `shutdown()` so a half-opened pool isn't torn down mid-init.
- Connection-lifecycle mutex in `PostgreSQLClient` — concurrent `connect`/`disconnect` calls now serialize on a promise queue (`whenLifecycleSettled()` exposed for callers that need to wait for in-flight work).
- `pgsql-parser` WASM warm-up in `PostgreSQLServer.init()` so the first SELECT with cursor analysis doesn't pay the cold-start cost.
- Resource limits in the test runner (`maxWorkers: '10%'`, `testTimeout: 30000`, `hookTimeout: 30000`).
- Auto-synced `VERSION` constant: `src/version.ts` now imports `package.json#version` via native ESM import attributes (`with { type: 'json' }`); the manifest is copied into `dist/package.json` by the `postbuild` step so the runtime resolution works after publish.
- Integration tests against a real PostgreSQL 18.3 container (26 tests across `list-schemas`, `list-objects`, `show-object`, `execute-sql`, `index-operation`). Local lifecycle is managed by [compose.yaml](compose.yaml) and `podman-compose`. Scripts: `test:integration:up`, `test:integration`, `test:integration:down`. Run from a separate config ([vitest.integration.config.ts](vitest.integration.config.ts)) so unit tests stay containerless.
- CI: dedicated `integration-tests` job in [.github/workflows/ci.yml](.github/workflows/ci.yml) starts a `postgres:18.3-alpine` service container with healthcheck and runs `npm run test:integration` against it. Job now runs on a Node 22.x / 24.x matrix and gates on `tsc -p tsconfig.eslint.json --noEmit` plus `npm run lint` before the test step.
- CI: separate `audit` job — `npm audit --omit=dev --audit-level=high` blocks the build on high+ advisories in production deps; full deps are audited as advisory only.
- CI: Codecov upload on Node 22.x via `codecov/codecov-action@v6.0.0` (SHA-pinned), driven by `npm run test:coverage`.
- Publish workflow: smoke pack-and-install step before `npm publish` — builds the real tarball, installs it into a clean throwaway dir, runs the bin entry with `--help` to catch broken `files` allow-list / missing deps / shebang issues.
- Coverage thresholds in `vitest.config.ts` (statements 75 / branches 65 / functions 80 / lines 75) with explicit excludes for integration-only files.
- Compile-time interface check in `test/__mocks__/postgres-client.mock.ts`: `Pick<PostgreSQLClient, ...>` assertion fails at `tsc` time if the real client's public surface drifts.
- Repository hardening guide in [README-release.md](README-release.md): branch protection rule recipe (required status checks, `Require linear history`, no force-push, no admin bypass) and `npm-publish` environment gating with required reviewers.

### Changed
- **Breaking:** `engines.node` raised from `>=20.0.0` to `>=22.0.0`. Node 20 LTS enters Maintenance in April 2026; picking 22 keeps the runtime current. `engines.npm` set to `>=10.0.0`; `packageManager: npm@11.9.0` added for reproducible installs.
- **Breaking:** `show-object` for `type: 'function'` now returns `{ name, schema, type, overloads: [{ arguments, identityArguments, returnType, definition }] }` — every overload sharing the name is included (using `pg_get_function_identity_arguments` for unambiguous identification). Previous releases returned a single flat object built from the first row.
- **Breaking dep upgrades:**
  - `zod` 3.x → 4.x
  - `eslint` 9.x → 10.x (added `preserve-caught-error` compliance — thrown errors carry `cause`)
  - `typescript` 5.x → 6.x
  - `@types/node` 22.x → 25.x
- All GitHub Actions SHA-pinned and bumped to v6: `actions/checkout@v6.0.2`, `actions/setup-node@v6.4.0`, `codecov/codecov-action@v6.0.0`.
- Test runner migrated from Jest to [Vitest](https://vitest.dev/) v4. Test wall time dropped from ~4.7 s to ~1.2 s (~4× speed-up); the `pgsql-parser` WASM "worker failed to exit gracefully" warning is gone. `npm test` now runs `vitest run`; `npm run test:watch` and `npm run test:coverage` are also available.
- `noUncheckedIndexedAccess: true` enabled in the main `tsconfig.json`. Array/Record element access now correctly yields `T | undefined`; affected call sites in `src/tools/show-object.ts` were updated to check the first row before use.
- Read-only mode is now enforced at the session level via `default_transaction_read_only=on` (PostgreSQL `options` startup parameter), eliminating the per-query `BEGIN`/`SET TRANSACTION READ ONLY`/`COMMIT` round-trips.
- `execute-sql` parameter validation accepts arrays and plain objects (for `ARRAY` / `JSONB`), `Buffer` and `Uint8Array` (for `bytea`), and rejects non-serializable values (functions, symbols, exotic objects) with an explicit error.
- `executeQuery` passes `undefined` (not `[]`) to node-postgres when no parameters are bound, restoring the simple-query protocol path and avoiding a per-query plan-cache entry.
- Temporary export files are now created via `mkdtempSync` inside `os.tmpdir()` (mode 0700), preventing symlink/TOCTOU races.
- `cursorCache` now uses SHA-1 of the trimmed query as the key (not the full SQL text) with LRU eviction at 256 entries; queries longer than 4 KB skip the cache. A keyword fast-path still skips the WASM parse for clearly non-cursor first keywords (INSERT/UPDATE/DELETE/DDL/utility).
- `list-objects type=all` pushes `ORDER BY` / `LIMIT` into each `UNION ALL` branch so the planner caps each source at `limit + offset + 1` rows instead of materialising the whole schema before sorting.
- `index-operation list` (schema-wide) reorganized as a CTE with `LATERAL` JOIN: pagination cap is applied before the JOIN with `pg_attribute`. Per-page attribute lookups instead of a full scan after `GROUP BY`.
- `show-object` for table/view: skips the second info-query in the common case (non-empty columns prove existence); falls back to the catalog only when the column list is empty.
- `show-object` SQL filters `prokind IN ('f', 'p')` so procedures are returned alongside functions.
- `connect`/`disconnect` annotations now correctly report `readOnlyHint: false` (these tools mutate server state).
- `index-operation` accepts `table` for the `list` operation (previously only `tableName`); the old name is kept as a deprecated alias.
- All tool descriptions extended to follow the AGENTS.md format (Purpose / Use cases / Returns / Limitations).
- README: documented limitations of read-only mode (system catalog reads, SECURITY DEFINER functions, server-side file access); test credentials warning (`test:test` is for the local compose container only).
- `test/setup.ts`: `POSTGRES_MCP_CONNECTION_STRING` uses `??=` instead of `=`, no longer overwriting a developer's local DSN. Global `beforeEach`/`afterEach` snapshot/restore `POSTGRES_MCP_OUTPUT_DIRS` so dev-machine env doesn't change validation behaviour.
- `test-integration/helpers.ts`: admin pool reads DSN from `POSTGRES_MCP_CONNECTION_STRING` (single source of truth with `setup.ts`).

### Fixed
- `index-operation list` with `tableName` previously emitted SQL referencing `n.nspname` without `pg_namespace n` in the `FROM` clause — fixed.
- `list-objects` no longer references the removed `pg_proc.proisagg` column (incompatible with PostgreSQL 11+).
- `DROP INDEX` now emits `IF EXISTS` before the index name (was after — invalid syntax).
- `index-operation drop` validates that a passed `table` actually owns the named index before issuing `DROP`.
- `PostgreSQLClient.ensureConnected` always raises a fresh error on each call instead of caching `connectionError` forever; the original cause is preserved via `Error.cause`.
- Pool leak on connect failure: a created pool is now always closed when validation fails before it is assigned to `this.pool`.
- `streamPostgresQueryToFile` honours back-pressure via async iteration and tears down the write stream on error so file descriptors are not leaked.
- `JsonArrayTransform`: opening `[\n` is no longer emitted before `JSON.stringify` succeeds — circular references in the first row no longer leave an unterminated JSON prefix on disk.
- ROLLBACK now runs on the rare residual transaction errors, preventing pooled connections from being returned to the pool with an open transaction. (No longer reachable in practice after the read-only enforcement change above, but kept as defense in depth.)

### Security
- All `npm audit` advisories cleared in production scope — including a transitive `ip-address` advisory resolved via npm `overrides: { "ip-address": "^10.1.1" }`.
- `connectionError` and `getConnectionInfo()` payloads are redacted before being surfaced to the MCP client; pool `'error'` events also redact stack traces.

### Removed
- Dead code in `src/utils/date.ts` (~200 lines of unused date helpers from another project).
- Unused `enrichConfigWithRedaction` helper.
- Unused `POSTGRES_MCP_POOL_SIZE` environment variable from configuration (CLI `--pool-size` is the single source of truth).
- Singleton `PostgreSQLClient.getInstance()` — clients are now plain instances passed via parameters.
- `setReadonlyMode` method (no-op after `connect()`; readonly mode is set on connect and locked for the session).
- `.npmignore` (single source of truth via `package.json#files`).
- `jest.config.js`, `tsconfig.test.json`, `jest`, `ts-jest`, `@types/jest` — all replaced by Vitest (see Changed).

## [0.1.0] - initial release

- Initial PostgreSQL MCP server with `connect`, `disconnect`, `service-info`, `list-schemas`, `list-objects`, `show-object`, `execute-sql`, and `index-operation` tools.
- Read-only mode by default, cursor-based file export for SELECT queries, configurable connection pool.
