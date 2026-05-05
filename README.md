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
- [Configuration for Qwen Code](#configuration-for-qwen-code)
- [Configuration for VS Code Cline](#configuration-for-vs-code-cline)
- [MCP Tools](#mcp-tools)
  - [Read-Only Mode Tools](#read-only-mode-tools)
  - [Non-Read-Only Mode Tools](#non-read-only-mode-tools)
  - [Limitations of Read-Only Mode](#limitations-of-read-only-mode)

## Requirements

- Node.js ≥ 20
- Environment variables:
  - `POSTGRES_MCP_CONNECTION_STRING` — PostgreSQL connection string (postgresql:// format)
  - `POSTGRES_MCP_TIMEZONE` — optional timezone for date operations (default: `Europe/Moscow`), must be a valid IANA timezone identifier (e.g., `Europe/London`, `America/New_York`, `Asia/Tokyo`)
  - `POSTGRES_MCP_OUTPUT_DIRS` — optional `:`-separated whitelist of directories where `execute-sql` is allowed to write `filePath` exports (default: only the OS temp directory). Use it when the LLM client needs to drop dumps next to the project, e.g. `POSTGRES_MCP_OUTPUT_DIRS=/var/data/exports:/srv/dumps`.
- CLI flags (passed via the MCP client's `args`):
  - `--read-only` / `--no-read-only` — start in read-only or read-write mode. Default: `--read-only`. To enable writes, pass `--no-read-only` in the MCP client config.
  - `--pool-size <n>` — connection pool size (default: 1).
  - `--idle-timeout <ms>` — idle timeout for pooled connections (default: 30000).
  - `--connection-timeout <ms>` — initial connection timeout (default: 10000).
  - `--auto-connect` — connect on startup using `POSTGRES_MCP_CONNECTION_STRING`. Default: off.

## Configuration for Qwen Code

To use this MCP server with [Qwen Code](https://qwenlm.github.io/qwen-code-docs/), add to `~/.qwen/settings.json`:

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

### Connection Pool Behavior

- The pool defaults to a single connection (`--pool-size 1`). This is a deliberate trade-off: with size 1, two parallel `tools/call` requests are serialized, but a multi-step transaction issued as several `execute-sql` calls (`BEGIN`, `…`, `COMMIT`) reliably lands on the same backend session. With `--pool-size > 1` consecutive `execute-sql` calls may hit different pooled clients, which silently breaks `BEGIN/COMMIT` flows split across calls — perform multi-statement transactions inside a single `execute-sql` (e.g. via CTE, `INSERT … ON CONFLICT`, or a `BEGIN; …; COMMIT;` block in one query). Increase `--pool-size` if you need parallel reads/writes and don't rely on multi-call transactions.
- A pool-level error (network drop, server restart, etc.) sets the server to disconnected state but does **not** automatically reconnect. The next call returns the recorded `connectionError`; call `connect` again to recover.
- `disconnect` closes all idle sockets via `pool.end()`. The MCP server itself keeps running and will accept a fresh `connect` immediately.
