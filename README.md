# PostgreSQL MCP Server

Also available in Russian: [README-ru.md](README-ru.md)

[![CI](https://github.com/VitalyOstanin/postgres-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/VitalyOstanin/postgres-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@vitalyostanin/postgres-mcp.svg)](https://www.npmjs.com/package/@vitalyostanin/postgres-mcp)

**Note**: This project is designed for my personal needs. I do not plan to expand its functionality with features I don't use or cannot verify. You are free to submit suggestions and pull requests, but I make no guarantee that everything will be accepted.

MCP server for comprehensive PostgreSQL integration with the following capabilities:

- **Database operations** - connect to PostgreSQL instances, list databases and schemas
- **Table management** - list tables, views, functions and get detailed information
- **Query tools** - execute SELECT, INSERT, UPDATE, DELETE queries with full PostgreSQL syntax
- **Connection management** - manage PostgreSQL connections with read-only mode support
- **Streaming file export** - streaming save to files for large datasets
- **Read-only mode** - safe read-only operations to prevent accidental data modifications
- **Monitoring** - database statistics, performance metrics
- **Schema operations** - create, modify, and drop tables, views, functions and indexes

## Table of Contents

- [Requirements](#requirements)
- [Configuration for VS Code Cline](#configuration-for-vs-code-cline)
- [Development](#development)
  - [Project Structure](#project-structure)
  - [Build](#build)
  - [Testing](#testing)
  - [Linting and Formatting](#linting-and-formatting)
  - [Working with the Local PostgreSQL Container](#working-with-the-local-postgresql-container)
- [MCP Tools](#mcp-tools)
  - [Read-Only Mode Tools](#read-only-mode-tools)
  - [Non-Read-Only Mode Tools](#non-read-only-mode-tools)
  - [Limitations of Read-Only Mode](#limitations-of-read-only-mode)

## Requirements

- Node.js ≥ 22
- Environment variables:
  - `POSTGRES_MCP_CONNECTION_STRING` — PostgreSQL connection string (postgresql:// format)
  - `POSTGRES_MCP_TIMEZONE` — optional timezone for date operations (default: `Europe/Moscow`), must be a valid IANA timezone identifier (e.g., `Europe/London`, `America/New_York`, `Asia/Tokyo`)
  - `POSTGRES_MCP_OUTPUT_DIRS` — optional `:`-separated whitelist of directories where `execute-sql` is allowed to write `filePath` exports (default: only the OS temp directory). Use it when the LLM client needs to drop dumps next to the project, e.g. `POSTGRES_MCP_OUTPUT_DIRS=/var/data/exports:/srv/dumps`. **Security warning:** the whitelist is the operator's responsibility — once a directory is listed, anything the MCP process can write goes there. Do not include system or shared paths such as `/`, `/etc`, `/usr`, `/var`, `/var/log`, `/root`, `/home`, your `$HOME`, or the project source root; restrict it to dedicated export directories.
- CLI flags (passed via the MCP client's `args`):
  - `--read-only` / `--no-read-only` — start in read-only or read-write mode. Default: `--read-only`. To enable writes, pass `--no-read-only` in the MCP client config.
  - `--pool-size <n>` — connection pool size (default: 1).
  - `--idle-timeout <ms>` — idle timeout for pooled connections (default: 30000).
  - `--connection-timeout <ms>` — initial connection timeout (default: 10000).
  - `--auto-connect` — connect on startup using `POSTGRES_MCP_CONNECTION_STRING`. Default: off.

## Configuration for VS Code Cline

To use this MCP server with [Cline](https://github.com/cline/cline) extension in VS Code:

1. Open VS Code with Cline extension installed
2. Click the MCP Servers icon in Cline's top navigation
3. Select the "Configure" tab and click "Configure MCP Servers"
4. Add the following configuration to `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "postgres-mcp": {
      "command": "npx",
      "args": ["-y", "@vitalyostanin/postgres-mcp@latest"],
      "env": {
        "POSTGRES_MCP_CONNECTION_STRING": "postgresql://localhost:5432/postgres"
      }
    }
  }
}
```

**Note:** This configuration uses npx to run the published package. For local development, use `"command": "node"` with `"args": ["/absolute/path/to/postgres-mcp/dist/index.js"]`. The `POSTGRES_MCP_TIMEZONE` environment variable is optional. The pool size is controlled by the CLI flag `--pool-size` (default `1`); it cannot be changed via environment variables.

## Development

This section is for contributors and operators running the server from a checkout. Detailed style and review notes for AI agents live in [AGENTS.md](AGENTS.md).

```bash
git clone https://github.com/VitalyOstanin/postgres-mcp.git
cd postgres-mcp
npm install
```

Node.js 24 is the recommended development version (see [.nvmrc](.nvmrc)). The `engines.node` floor is `>=22` so the package still publishes for Node 22 LTS, and CI runs the matrix on both 22.x and 24.x.

### Project Structure

- `index.ts` — CLI entry point (`bin: postgres-mcp`); parses arguments, wires the stdio transport, registers signal handlers.
- `src/server.ts` — `PostgreSQLServer` class; owns the pool lifecycle and registers all MCP tools.
- `src/postgres-client.ts` — thin async wrapper over `pg.Pool` (lifecycle, `executeQuery`, `streamQuery`, `withTransaction`).
- `src/tools/` — one file per MCP tool (`connect`, `disconnect`, `service-info`, `list-schemas`, `list-objects`, `show-object`, `execute-sql`, `index-operation`).
- `src/utils/` — shared helpers: connection guard, redaction, identifier quoting, pagination, SQL-param validation, file-path safety, streaming, query analysis.
- `src/defaults.ts` — single source of truth for default pool size, timeouts, timezone, pagination bounds.
- `test/` — vitest unit suite (mocks the pool); `test-integration/` — vitest integration suite that talks to a real PostgreSQL container.
- `coverage/` — generated by `npm run test:coverage`; HTML coverage report (gitignored).
- `temp/` — local scratch/staging directory used by tests (gitignored).
- `docs/` — local-only project documentation; `docs/reviews/` holds review reports written by `project-check` skills (the whole `docs/` tree is gitignored, nothing here is published).

### Build

| Command           | What it does                                                                 |
| ----------------- | ---------------------------------------------------------------------------- |
| `npm run build`   | Compile TypeScript with `tsconfig.build.json` into `dist/`. Sets the `+x` bit and copies `package.json` to `dist/` via `postbuild`. |
| `npm run dev`     | TypeScript watch (`tsc --watch`). The MCP stdio server itself is not hot-reloaded — restart the MCP client after rebuilds. |
| `npm start`       | Run the built server (`node dist/index.js`). Use after `npm run build`.      |
| `npm run typecheck` | `tsc -p tsconfig.json --noEmit` (covers `src/`, `test/`, `test-integration/`, top-level files). |

### Testing

| Command                              | What it does                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| `npm test`                           | Run the unit suite (`vitest run` against `test/`).                               |
| `npm run test:watch`                 | Run unit tests in watch mode.                                                    |
| `npm run test:coverage`              | Run unit tests with coverage; HTML report lands in `coverage/index.html`.        |
| `npm run test:integration`           | Run the integration suite against the local PostgreSQL container.                |
| `npm run test:integration:up`        | `podman-compose -f compose.yaml up -d` — start the container.                    |
| `npm run test:integration:down`      | `podman-compose -f compose.yaml down` — stop and remove the container.           |

The unit suite uses a pool mock (`test/__mocks__/postgres-client.mock.ts`); the integration suite needs a running PostgreSQL container exposed on `127.0.0.1:55432` — start it with `npm run test:integration:up` before `npm run test:integration`.

### Linting and Formatting

Formatting is enforced by ESLint stylistic rules (no separate Prettier configuration). Run:

| Command                | What it does                                              |
| ---------------------- | --------------------------------------------------------- |
| `npm run lint`         | Lint `.ts` / `.mts` files via the flat-config in `eslint.config.mjs`. |
| `npm run lint:fix`     | Same as `lint`, but auto-fixes safe rule violations.       |
| `npm run format`       | Alias of `lint:fix`. Use whichever name you prefer.        |

### Working with the Local PostgreSQL Container

[`compose.yaml`](compose.yaml) declares a PostgreSQL 18 service bound to `127.0.0.1:55432` with the throwaway credentials `test:test`. These credentials are intentional for the local container and the matching CI service — they are also referenced from [`test/setup.ts`](test/setup.ts) and [`test-integration/setup.ts`](test-integration/setup.ts). Do not change the binding to `0.0.0.0` and do not copy `compose.yaml` into a production environment.

```bash
npm run test:integration:up      # start container in background
npm run test:integration         # run integration tests against it
npm run test:integration:down    # tear it down when finished
```

## MCP Tools

### Read-Only Mode Tools

#### `service-info`
Get PostgreSQL service information and current connection status. No parameters.

#### `connect`
Establish a connection using `POSTGRES_MCP_CONNECTION_STRING`.
- `readonlyMode` (boolean, default `true`).
- `poolSize` (number, default `1`).
- `idleTimeoutMillis` (number, default `30000`).
- `connectionTimeoutMillis` (number, default `10000`).

#### `disconnect`
Close the pool and clear connection state. No parameters.

#### `list-schemas`
List user schemas (excludes `information_schema`, `pg_catalog`, `pg_toast`).
- `limit` (number, 1–1000, default `100`).
- `offset` (number, default `0`).

#### `list-objects`
List tables, views, or functions in a schema.
- `schema` (string, default `'public'`).
- `type` (`'table' | 'view' | 'function' | 'all'`, default `'all'`).
- `limit` (number, 1–1000, default `100`).
- `offset` (number, default `0`).

#### `show-object`
Show detailed information about a single table, view, or function.
- `schema` (string, default `'public'`).
- `name` (string, required) — object name.
- `type` (`'table' | 'view' | 'function'`, required).

#### `execute-sql`
Run a SELECT/WITH/VALUES query (read-only mode rejects data-modifying statements with PostgreSQL error 25006).
- `query` (string, required) — SQL with `$1`/`$2` placeholders.
- `params` (array, optional) — values. Allowed: scalars, `null`, `Date`, `Buffer`, arrays, plain objects (sent as JSON/JSONB).
- `saveToFile` (boolean, default `false`) — stream results to a file.
- `filePath` (string, optional) — must be inside the OS temp dir or one of `POSTGRES_MCP_OUTPUT_DIRS`.
- `format` (`'jsonl' | 'json'`, default `'jsonl'`).
- `forceSaveToFile` (boolean, default `false`) — for non-cursor queries, buffer in memory then write.

#### `index-operation` (only `operation: 'list'` in read-only mode)
- `operation` (`'create' | 'drop' | 'list'`, required).
- `schema` (string, default `'public'`).
- `table` (string) — required for `create`/`drop`; optional for `list` (filters by table).
- `name` (string) — index name; required for `create`/`drop`.
- `columns` (string[]) — required for `create`.
- `unique` (boolean, default `false`).
- `ifNotExists` / `ifExists` (boolean, default `false`).
- `tableName` (string, deprecated alias of `table` for `list`).
- `limit` (number, 1–1000, default `100`); `offset` (number, default `0`).

### Non-Read-Only Mode Tools

In read-write mode (`--no-read-only`) all tools above are available, plus `execute-sql` accepts INSERT/UPDATE/DELETE/DDL and `index-operation` allows `create`/`drop`. Parameter shapes are unchanged.

**Note:** The server runs in read-only mode by default to prevent accidental data modifications. Read-only enforcement is applied at the session level: when `connect` opens the pool with `readonlyMode=true`, every pooled connection is started with `default_transaction_read_only=on`, so any data-modifying statement fails server-side with PostgreSQL error 25006 (`read_only_sql_transaction`).

In read-only mode the following are blocked:
- `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `TRUNCATE`
- DDL: `CREATE`, `ALTER`, `DROP`, `COMMENT`, `GRANT`, `REVOKE`
- `create` and `drop` operations in the `index-operation` tool

### Limitations of Read-Only Mode

Read-only mode is a guard-rail, not a full sandbox. The following operations are still possible because they are not write transactions in PostgreSQL's sense:

- Reading sensitive system catalogs (`pg_authid`, `pg_shadow`, etc.) if the connecting role has privileges.
- Calling `SECURITY DEFINER` functions that internally write data — the inner role's writes bypass the outer session flag.
- Server-side file access functions such as `pg_read_server_files`, `lo_export`, `COPY ... TO PROGRAM` (the latter requires superuser).
- Switching readonly mode at runtime requires a reconnect; calling the `connect` tool again with a different `readonlyMode` value rebuilds the pool with the new setting.

For stronger isolation, use a PostgreSQL role that lacks `INSERT`/`UPDATE`/`DELETE`/`USAGE` on the relevant objects.

**Privilege boundary (production recommendation):** authentication and authorisation are delegated entirely to the PostgreSQL role embedded in `POSTGRES_MCP_CONNECTION_STRING` — the MCP server has no user concept of its own. For production deployments, connect with a role that has only the minimum privileges your workload needs: avoid superusers, do not grant `pg_read_server_files`, and audit any `SECURITY DEFINER` functions on the search path before exposing them via `execute-sql`. Run with the default `--read-only` and without `--auto-connect` whenever possible, and source the connection string from a secret manager rather than committing it to a config file.

### Connection Pool Behavior

- The pool defaults to a single connection (`--pool-size 1`). This is a deliberate trade-off: with size 1, two parallel `tools/call` requests are serialized, but a multi-step transaction issued as several `execute-sql` calls (`BEGIN`, `…`, `COMMIT`) reliably lands on the same backend session. With `--pool-size > 1` consecutive `execute-sql` calls may hit different pooled clients, which silently breaks `BEGIN/COMMIT` flows split across calls — perform multi-statement transactions inside a single `execute-sql` (e.g. via CTE, `INSERT … ON CONFLICT`, or a `BEGIN; …; COMMIT;` block in one query). Increase `--pool-size` if you need parallel reads/writes and don't rely on multi-call transactions.
- Latency tip: if your MCP host issues several tool calls in parallel (e.g. `list-schemas` + `service-info` + `execute-sql` at once) and you want them to overlap on the database side, raise `--pool-size` to 2–4. Keep the multi-call-transaction caveat above in mind — anything that splits `BEGIN`/`COMMIT` across calls must stay on a size-1 pool.
- A pool-level error (network drop, server restart, etc.) sets the server to disconnected state but does **not** automatically reconnect. The next call returns the recorded `connectionError`; call `connect` again to recover.
- `disconnect` closes all idle sockets via `pool.end()`. The MCP server itself keeps running and will accept a fresh `connect` immediately.
