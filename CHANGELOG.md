# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Table of Contents

- [Unreleased](#unreleased)
- [0.1.0](#010)

## [Unreleased]

### Added
- Identifier escaping helper (`quoteIdent`/`quoteQualified`) for the `index-operation` tool, eliminating SQL injection through `schema`/`table`/`name`/`columns` parameters.
- `validateSafeOutputPath` helper restricting `execute-sql` `filePath` writes to the OS temp directory; extendable via the `POSTGRES_MCP_OUTPUT_DIRS` environment variable (`:`-separated whitelist).
- `redactConnectionString` helper masking passwords in any text that passes through error responses or stderr logs.
- Pagination (`limit`/`offset`/`hasMore`) on `list-schemas`, `list-objects`, and `index-operation list`.
- `structuredContent` is now populated alongside the text response on every tool result for clients with an output schema.
- Graceful shutdown: SIGINT/SIGTERM now triggers an orderly pool teardown.
- Resource limits in the test runner (`maxWorkers: '10%'`, `testTimeout: 30000`, `hookTimeout: 30000`).
- Auto-synced `VERSION` constant: `src/version.ts` now imports `package.json#version` via native ESM import attributes (`with { type: 'json' }`); the manifest is copied into `dist/package.json` by the `postbuild` step so the runtime resolution works after publish.
- Integration tests against a real PostgreSQL 18.3 container (26 tests across `list-schemas`, `list-objects`, `show-object`, `execute-sql`, `index-operation`). Local lifecycle is managed by [compose.yaml](compose.yaml) and `podman-compose`. Scripts: `test:integration:up`, `test:integration`, `test:integration:down`. Run from a separate config ([vitest.integration.config.ts](vitest.integration.config.ts)) so unit tests stay containerless.
- CI: dedicated `integration-tests` job in [.github/workflows/ci.yml](.github/workflows/ci.yml) starts a `postgres:18.3-alpine` service container with healthcheck and runs `npm run test:integration` against it.

### Changed
- Test runner migrated from Jest to [Vitest](https://vitest.dev/) v4. Test wall time dropped from ~4.7 s to ~1.2 s (~4× speed-up); the `pgsql-parser` WASM "worker failed to exit gracefully" warning is gone. `npm test` now runs `vitest run`; `npm run test:watch` and `npm run test:coverage` are also available.
- `noUncheckedIndexedAccess: true` enabled in the main `tsconfig.json`. Array/Record element access now correctly yields `T | undefined`; affected call sites in `src/tools/show-object.ts` were updated to check the first row before use.
- Read-only mode is now enforced at the session level via `default_transaction_read_only=on` (PostgreSQL `options` startup parameter), eliminating the per-query `BEGIN`/`SET TRANSACTION READ ONLY`/`COMMIT` round-trips.
- `execute-sql` parameter validation accepts arrays and plain objects (for `ARRAY` / `JSONB`) and rejects non-serializable values (functions, symbols, exotic objects) with an explicit error.
- Temporary export files are now created via `mkdtempSync` inside `os.tmpdir()` (mode 0700), preventing symlink/TOCTOU races.
- `pgsql-parser` results are cached and a fast-path skips the WASM parse for clearly non-cursor first keywords (INSERT/UPDATE/DELETE/DDL/utility).
- `connect`/`disconnect` annotations now correctly report `readOnlyHint: false` (these tools mutate server state).
- `index-operation` accepts `table` for the `list` operation (previously only `tableName`); the old name is kept as a deprecated alias.
- All tool descriptions extended to follow the AGENTS.md format (Purpose / Use cases / Returns / Limitations).
- README: documented limitations of read-only mode (system catalog reads, SECURITY DEFINER functions, server-side file access).

### Fixed
- `index-operation list` with `tableName` previously emitted SQL referencing `n.nspname` without `pg_namespace n` in the `FROM` clause — fixed.
- `list-objects` no longer references the removed `pg_proc.proisagg` column (incompatible with PostgreSQL 11+).
- `DROP INDEX` now emits `IF EXISTS` before the index name (was after — invalid syntax).
- ROLLBACK now runs on the rare residual transaction errors, preventing pooled connections from being returned to the pool with an open transaction. (No longer reachable in practice after the read-only enforcement change above, but kept as defense in depth.)

### Removed
- Dead code in `src/utils/date.ts` (~200 lines of unused date helpers from another project).
- Unused `enrichConfigWithRedaction` helper.
- Unused `POSTGRES_MCP_POOL_SIZE` environment variable from configuration (CLI `--pool-size` is the single source of truth).
- Singleton `PostgreSQLClient.getInstance()` — clients are now plain instances passed via parameters.
- `jest.config.js`, `tsconfig.test.json`, `jest`, `ts-jest`, `@types/jest` — all replaced by Vitest (see Changed).

## [0.1.0] - initial release

- Initial PostgreSQL MCP server with `connect`, `disconnect`, `service-info`, `list-schemas`, `list-objects`, `show-object`, `execute-sql`, and `index-operation` tools.
- Read-only mode by default, cursor-based file export for SELECT queries, configurable connection pool.
