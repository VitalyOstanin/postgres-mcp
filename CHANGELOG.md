# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Table of Contents

- [0.5.2](#052---2026-07-03)
- [0.5.1](#051---2026-05-07)
- [0.5.0](#050---2026-05-07)
- [0.4.0](#040---2026-05-07)
- [0.3.0](#030---2026-05-06)
- [0.2.0](#020---2026-05-06)
- [0.1.0](#010)

## [0.5.2] - 2026-07-03

### Changed
- Dependency maintenance: bumped runtime and dev dependencies to latest (`pg` 8.22.0, `pg-query-stream` 4.16.0, plus `eslint` / `vitest` / `typescript-eslint` / `@types/node` 26). Cleared high-severity npm advisories via lockfile updates. No change to the server's own API or behavior.
- CI: switched the Codecov upload from `CODECOV_TOKEN` to OIDC (`use_oidc: true` on `codecov/codecov-action`), and bumped `actions/checkout` to v7 and `codecov/codecov-action` to v7. The `build-and-test` job now requests `id-token: write` so the action exchanges a short-lived GitHub-issued JWT for an upload credential, removing the need to store a long-lived `CODECOV_TOKEN` secret in the repository.

### Added
- README: Codecov coverage badge in [README.md](README.md) and [README-ru.md](README-ru.md), linking to <https://codecov.io/gh/VitalyOstanin/postgres-mcp>.

## [0.5.1] - 2026-05-07

### Added
- `LICENSE` (MIT) file in repository root and added to the `files` allow-list so it ships in the published tarball.

## [0.5.0] - 2026-05-07

> **Breaking changes:** `show-object` with `type='function'` no longer returns rows for procedures (its SQL now filters by `prokind='f'`); call `show-object` with the new `type='procedure'` instead. See *Breaking* below.

### Fixed

- **`PostgreSQLClient` leaked the failed pool on `pool.on('error')`**: the error handler set `isConnected=false` but kept `this.pool` pointing at the dead pool, so the next `connect()` skipped `doDisconnect` (the guard requires `isConnected=true`) and overwrote the pool reference, leaving the previous pool's TCP sockets open until idle timeout. The handler now calls `pool.end().catch(() => {})` on the failed pool and clears `this.pool` if it still references that pool.
- **`PostgreSQLClient.streamQuery` and `withTransaction` returned a half-baked client to the pool after errors**: pg `client.release()` was called without an argument even when `stream.destroy()` had torn down a mid-response or `ROLLBACK` had failed, so the next caller could pick up a connection in inconsistent protocol state. Both methods now capture the error and pass it to `client.release(err)`, telling the pool to destroy the client instead of recycling it.
- **`redactConnectionString` did not handle URI query passwords**: a libpq parameter passed via the URI form (`postgresql://user@host/db?password=secret&sslmode=require`) was matched by the libpq-form regex, but the value class `[^\s'"]+` swallowed everything up to whitespace, so subsequent `&` parameters were dropped from the redacted output. The class now excludes `&`, so the redacted string preserves the rest of the query.
- **`show-object` returned procedures under `type:'function'`**: the function-branch SQL filtered by `prokind IN ('f','p')` while the response always set `type:'function'`, so a procedure with the same name as a function silently appeared as a function. Each branch now filters by exactly one `prokind` (see Breaking).
- **`list-objects` description listed window functions (`prokind='w'`) that the SQL never returned**: the description now matches the actual filter (`'f'` and `'p'` only).
- **`index-operation runDrop` had ~30 lines duplicated between concurrent and transactional branches**: shared lookup + `ifExists` short-circuit + `actualTable !== table` check moved to a single `preCheckIndexDrop` helper returning a discriminated union (`short-circuit` with the prepared response, or `proceed` with the resolved table/OID).
- **`postgres-stream` repeated the open-write-stream boilerplate twice**: extracted `openSafeWriteStream(filePath)` (mkdir + `'wx'` flags + finished promise) and used it from both `streamPostgresQueryToFile` and `writeArrayToFile`.
- **`IndexLookupRow.oid` was typed as `number` while `node-postgres` returns `int8` as a string**: the type now matches the wire format (`oid: string`), and `IndexDropPreCheck` propagates the change to the verification path.
- **`quoteIdent` echoed the entire identifier (could be 1 KB of LLM-generated noise) into its `Identifier exceeds 63 bytes` error**: the offending name is now truncated to ~80 characters with an ellipsis.
- **`show-object` could swallow a found-but-empty row**: the `if (!first) break` path treated a real row that decoded to `undefined` as "object does not exist". It now returns an explicit `Internal error: query returned an empty row`.

### Added

- `src/defaults.ts`: `DEFAULT_SCHEMA = 'public'` so the six call sites in `index-operation`, `list-objects` and `show-object` share one constant for both the Zod `.default(...)` and the destructuring fallback.
- `src/utils/sql-params.ts`: new `getSerializationIssue(value)` returning a discriminated `{ reason: 'cyclic' | 'depth' | 'type', ... }` so `execute-sql` can surface the actual cause of a parameter-validation failure (cyclic reference, depth-cap hit, disallowed `typeof`) instead of a single generic message. Boolean `isSerializableParam` is preserved as a thin wrapper for existing callers.
- `show-object` now accepts `type='procedure'`; the response shape mirrors the existing function form but with `type: 'procedure'`, so callers can drop the previous workaround of calling `type='function'` and post-filtering.
- `index-operation` registers a `default` branch on the operation `switch` that returns a structured `Unknown operation` error — defence-in-depth in case the Zod enum and the dispatch get out of sync.
- `index-operation` exports `resetDeprecationWarning()` so tests can run in any order without depending on the once-per-process warning side effect.
- `package.json#scripts.format` is now a real alias (`npm run --silent lint:fix`) instead of a copy of the same `eslint --fix` invocation, eliminating the drift risk.
- `package.json#scripts.prepublishOnly` now also runs `npm audit --omit=dev --audit-level=moderate`, so a moderate-or-higher production advisory blocks `npm publish` locally as well as in CI.
- `package.json#scripts.test`, `test:coverage`, `test:integration` are wrapped in `timeout 600` so a runaway local test run is killed after 10 minutes (CI already has its own `timeout-minutes`).
- Per-file JSDoc on `src/utils/date.ts` (timezone side-effect on `luxon.Settings.defaultZone`) and `src/utils/tool-response.ts` (`toolSuccess` / `toolError` envelope contract).
- `test/utils/pagination.test.ts`, `test/utils/sql-params.test.ts`, `test/utils/tool-response.test.ts` (45 new assertions) plus added cases in `redact.test.ts` and `sql-identifier.test.ts`. Suite total: 127 → 179 unit tests.

### Changed

- README / README-ru: `POSTGRES_MCP_OUTPUT_DIRS` carries an explicit security warning enumerating the system paths an operator must not include in the whitelist (`/`, `/etc`, `/usr`, `/var`, `/var/log`, `/root`, `/home`, `$HOME`, repository source root).
- README / README-ru: Project Structure now documents the gitignored `coverage/`, `temp/` and `docs/` trees so a fresh checkout doesn't surprise contributors.
- README / README-ru: Limitations of Read-Only Mode gains a Privilege Boundary subsection (auth/authz delegated to the PG role; least-privilege guidance for production); Connection Pool Behavior gains a latency tip for `--pool-size 2-4` when the MCP host issues parallel tool calls.
- AGENTS.md: documents the rationale behind `overrides.ip-address ^10.1.1` (GHSA-v2v4-37r5-5v8g, XSS in `Address6` HTML methods, vulnerable `<= 10.1.0`); npm strict-mode rejects comment keys in `overrides`, so the note lives outside the manifest.
- TODO.md: deferred follow-ups recorded — secret scanning in CI (gitleaks vs GitHub native), and `show-object` overload pagination + `includeDefinition` flag.
- Removed the legacy `Configuration for Qwen Code` snippet (and `QWEN.md`); the generic stdio/npx setup already documented for VS Code Cline applies to any MCP host.

### Breaking

- **`show-object` with `type='function'` no longer returns procedures.** The SQL now filters by `prokind='f'` (and the new `type='procedure'` filters by `prokind='p'`), so a query like `show-object schema=foo name=bar type=function` will return "does not exist" for a procedure named `bar`. Callers that relied on the previous mixed behaviour must call `show-object` with the matching `type` explicitly.

## [0.4.0] - 2026-05-07

> **Breaking changes:** the `index-operation` `list` response shape for the single-table case is now aggregated by index (one row, `columns: "a, b"`) instead of one row per column (`column_name`); the public `PostgreSQLClient.whenLifecycleSettled()` method is removed; `validateSafeOutputPath`, `generateTempFilePath` and `generatePostgresTempFilePath` are now async; `connect` short-circuits only when the full settings tuple matches and reconnects on any drift. See *Breaking* below.

### Fixed

- **CI on master**: removed the dangling reference to a non-existent `tsconfig.eslint.json` in the integration-tests step; the same `npm run typecheck` (which already covers `test-integration/`) is reused. The last four CI runs on master had been failing with `error TS5058`.
- **`connect` ignored pool/timeout/readonly settings on reconnect**: the fast-path now compares the full tuple `(connectionString, readonlyMode, poolSize, idleTimeoutMillis, connectionTimeoutMillis)` and reopens the pool when any field differs. Previously only the connection string was compared, so a documented use case ("reconnecting with different pool/timeout settings") silently no-op'd.
- **`index-operation drop` race window**: `concurrently=false` now runs lookup + DROP inside a single transaction (`PostgreSQLClient.withTransaction`), preventing a parallel session from swapping the index between the two statements; `concurrently=true` cannot use a transaction (PostgreSQL restriction), so it now records the index OID during lookup and verifies it is gone after DROP, reporting an honest `dropped: false` with a follow-up message instead of unconditional success.
- **`index-operation list` pagination broken in single-table branch**: LIMIT/OFFSET applied to per-column rows, so a multi-column index could be split across pages. Both branches now aggregate columns via `string_agg(... ORDER BY a.attnum)` and apply LIMIT/OFFSET to indexes.
- **`index-operation list` ignored partitioned tables**: filter relaxed to `t.relkind IN ('r','p')` so the listing now includes indexes that `drop` is willing to remove.
- **`index.ts` crash handler leaked DSNs**: `console.error` paths in `main().catch` and the SIGINT/SIGTERM shutdown branch now run `error.message`/`error.stack`/`error.cause` through `redactConnectionString`.
- **`PostgreSQLClient.disconnect` did not refresh `disconnectReason` after a pool error**: the field is now updated unconditionally (regardless of whether `pool.end()` runs), so `service-info` reports the latest cause instead of a stale "pool connection error".
- **`execute-sql` paid for parser/parameter validation before checking connection state**: the `requireConnection` guard moved to the start of the handler.
- **`isSerializableParam` could blow the stack on a cyclic parameter**: extracted to `src/utils/sql-params.ts` with a 64-level depth limit and a `WeakSet` cycle detector.

### Added

- `src/defaults.ts`: single source of truth for `DEFAULT_POOL_SIZE`, `DEFAULT_IDLE_TIMEOUT_MS`, `DEFAULT_CONNECTION_TIMEOUT_MS`, `DEFAULT_TIMEZONE`, pagination bounds. CLI, server constructor, client and `loadConfig` all import from here.
- `src/utils/connection-guard.ts` (`requireConnection`), `src/utils/connection-messages.ts` (canonical "connection string is required" message), `src/utils/pagination.ts` (`paginationLimitSchema`/`paginationOffsetSchema`), `src/utils/sql-params.ts` (`isSerializableParam` with cycle protection).
- `PostgreSQLClient.withTransaction(operation)` for check-then-act flows that require atomicity (used by `index-operation drop` non-concurrent path).
- ESLint flat-config rule `quotes: ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }]`. The repo is normalised; mixed quote-style cannot drift back.
- `npm run format` script (alias of `lint:fix`) — for contributors who reflexively run the conventional name.
- `index-operation list` now emits a structured `warnings` field in the response when the deprecated `tableName` alias is used (plus a one-shot `console.warn` per process); the canonical replacement is `table`.
- `test/utils/confirmation.test.ts`: 15-case unit suite covering `DESTRUCTIVE_CONFIRMATION_VALUE` and `classifyDestructive` (SELECT/INSERT/scoped UPDATE-DELETE pass; DROP/TRUNCATE/ALTER, UPDATE-without-WHERE, DELETE-without-WHERE are flagged; broken SQL defers to PostgreSQL).
- `vitest.integration.config.ts`: conservative initial coverage thresholds (statements/lines 50, branches 40, functions 50) so a regression that narrows the integration suite trips CI.
- `pre-publish-checks` workflow now runs the Node 22.x / 24.x matrix (mirrors `engines.node` lower bound) and adds an `npm audit --omit=dev --audit-level=high` step, closing the gap that allowed a tag to publish even when the audit job in `ci.yml` was failing.

### Changed

- All eight tools now use the shared `requireConnection` guard — duplicated `isConnectedToPostgreSQL`/`toolError(...)` blocks are removed; the wording lives in one place.
- `index-operation` handler split into `runCreate`, `runDrop`, `runList` private functions; the previous ~225-line lambda is gone.
- `execute-sql` handler split: file-mode logic extracted to `runSaveToFile`, parameter validation to `validateParams`, the inline `isSerializableParam` recursion replaced by the shared utility.
- `safe-path` resolves the allowed-output-dirs whitelist once via lazy init (`resetAllowedOutputDirsCache` exported for tests) instead of re-parsing `POSTGRES_MCP_OUTPUT_DIRS` and re-running `realpath` on every call.
- Every `register*Tool` function now has a one-line JSDoc.
- README / README-ru: new `Development`, `Build`, `Testing`, `Linting and Formatting`, `Project Structure`, `Local PostgreSQL Container` sections so new contributors don't have to reverse-engineer onboarding from `AGENTS.md`.
- AGENTS.md: hardened the Testing Credentials note — the `127.0.0.1:` prefix on the `compose.yaml` port binding is now called out as non-optional, and the CI service pattern is flagged as unsafe to copy onto self-hosted runners.
- Dependencies bumped to current minors: `pg ^8.20.0`, `pg-query-stream ^4.14.0`, `pgsql-parser ^17.9.15`, `luxon ^3.7.2`, `@types/pg ^8.20.0`; `packageManager` set to `npm@11.12.1`. `@types/pg-query-stream` removed entirely (the runtime package now ships its own types and the `@types/...` entry on the registry is just a forwarder stub).
- `node:` import-protocol prefix is now consistent across the codebase (`node:fs/promises`, `node:path`, `node:os`, `node:stream`, `node:events`, `node:crypto`).

### Breaking

- **`index-operation` `operation=list`, single-table branch**: the response previously emitted one row per indexed column with a `column_name` field; it now emits one row per index with a `columns` field (a comma-separated string in `attnum` order). The schema-wide branch was already shaped this way; the two branches are now consistent. Callers that read `column_name` must switch to `columns`.
- **`PostgreSQLClient.whenLifecycleSettled()` removed.** It was defined but never called from anywhere in this repo. If a downstream consumer was awaiting it before issuing tool calls, the method has to be re-introduced or the consumer must rely on `isConnectedToPostgreSQL()` plus `connect()` returning before the first tool call (the way `PostgreSQLServer.init()` already wires things up).
- **`validateSafeOutputPath`, `generateTempFilePath`, `generatePostgresTempFilePath` are now `async`.** Sync call sites must add `await`. Internal-only utilities, but exported from the published package.
- **`connect` short-circuit semantics tightened.** `Already connected to PostgreSQL with the same connection string` is replaced by `Already connected to PostgreSQL with the same connection string and settings`, and the tool reconnects whenever `readonlyMode`, `poolSize`, `idleTimeoutMillis` or `connectionTimeoutMillis` differs from the live pool. Behaviour now matches the documented intent ("reconnecting with different pool/timeout settings").
- **`index-operation` `operation=drop` with `concurrently=true`**: the response can now report `dropped: false` if a parallel session replaced the index between lookup and DROP. Previously the field was always `true`.
- **`@types/pg-query-stream` removed from devDependencies**: the runtime `pg-query-stream@4.x` ships its own types; the standalone `@types/...` entry was a stub. No source change is required, but a consumer that pinned the stub explicitly must drop the pin.

## [0.3.0] - 2026-05-06

> **Breaking changes:** `execute-sql` now refuses destructive statements (DROP/TRUNCATE/ALTER, UPDATE/DELETE without WHERE) without an explicit confirmation literal; `index-operation` `operation=drop` requires the same literal. See *Breaking* below.

### Added

- DX scaffolding: `.nvmrc` (Node 24), `.editorconfig`, `tsconfig.base.json` shared compiler options, `.github/dependabot.yml` with grouped weekly bumps for npm (types/eslint/vitest) and github-actions.
- Full `ToolAnnotations` set on every tool (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) so MCP hosts can reason about confirmation flows without parsing descriptions.
- `src/utils/confirmation.ts` with the shared destructive confirmation literal `I_KNOW_THIS_IS_DESTRUCTIVE` and an AST-based `classifyDestructive(query)` helper backed by `pgsql-parser`.

### Changed

- ESLint: switched to `typescript-eslint` v8 `projectService: true` (single shared TS server, lower memory than `parserOptions.project`); added `--cache --cache-location node_modules/.cache/eslint/`.
- Tsconfig layout reorganised mongo-style to support `projectService`: `tsconfig.json` includes src + tests + configs (noEmit, used by typecheck and projectService), new `tsconfig.build.json` for production sources only, removed the standalone `tsconfig.eslint.json`.
- `streamPostgresQueryToFile` and `writeArrayToFile` open output files with `{ flags: 'wx' }`. Concurrent calls targeting the same `filePath` now get `EEXIST` instead of silently clobbering each other.

### Breaking

- `execute-sql` now classifies its query via `pgsql-parser` and refuses to execute destructive statements (`DROP*`, `TRUNCATE`, `ALTER` family, plus `UPDATE` / `DELETE` without a `WHERE` clause) unless the caller passes `confirmation: "I_KNOW_THIS_IS_DESTRUCTIVE"`. Read-only mode still blocks writes at the server side via PG error 25006; this is the second gate for read-write deployments.
- `index-operation` `operation=drop` now requires `confirmation: "I_KNOW_THIS_IS_DESTRUCTIVE"`. `create` and `list` are unaffected.
- `streamPostgresQueryToFile` / `writeArrayToFile` no longer overwrite an existing target file. The previous behaviour was undocumented; any caller relying on it must now pick a unique `filePath` per invocation (timestamp, uuid).

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
