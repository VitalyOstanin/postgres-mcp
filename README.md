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

- [Table of Contents](#table-of-contents)
- [Requirements](#requirements)
- [Configuration for Qwen Code](#configuration-for-qwen-code)
- [Configuration for VS Code Cline](#configuration-for-vs-code-cline)
- [MCP Tools](#mcp-tools)
  - [Read-Only Mode Tools](#read-only-mode-tools)
  - [Non-Read-Only Mode Tools](#non-read-only-mode-tools)

## Requirements

- Node.js ≥ 20
- Environment variables:
  - `POSTGRES_MCP_CONNECTION_STRING` — PostgreSQL connection string (postgresql:// format)
  - `POSTGRES_MCP_TIMEZONE` — optional timezone for date operations (default: `Europe/Moscow`), must be a valid IANA timezone identifier (e.g., `Europe/London`, `America/New_York`, `Asia/Tokyo`)
  - `POSTGRES_MCP_POOL_SIZE` — optional connection pool size (default: 1)

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

**Note:** This configuration uses npx to run the published package. For local development, use `"command": "node"` with `"args": ["/absolute/path/to/postgres-mcp/dist/index.js"]`. The `POSTGRES_MCP_TIMEZONE` and `POSTGRES_MCP_POOL_SIZE` environment variables are optional.

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

**Note:** This configuration uses npx to run the published package. For local development, use `"command": "node"` with `"args": ["/absolute/path/to/postgres-mcp/dist/index.js"]`. The `POSTGRES_MCP_TIMEZONE` and `POSTGRES_MCP_POOL_SIZE` environment variables are optional.

## MCP Tools

### Read-Only Mode Tools

| Tool | Description | Main Parameters |
| --- | --- | --- |
| `service-info` | Get PostgreSQL service information and current connection status | — |
| `connect` | Establish connection to PostgreSQL using connection string | `readonlyMode` — run in read-only mode (default: true), `poolSize` — connection pool size (default: 1), `idleTimeoutMillis` — idle timeout in milliseconds (default: 30000), `connectionTimeoutMillis` — connection timeout in milliseconds (default: 10000) |
| `disconnect` | Disconnect from PostgreSQL and clear the connection | — |
| `list-schemas` | List all schemas in the PostgreSQL database | — |
| `list-objects` | List objects (tables, views, functions) in a PostgreSQL schema | `schema` — schema name (default: 'public'), `type` — type of objects: 'table', 'view', 'function', 'all' (default: 'all') |
| `show-object` | Show detailed information about a PostgreSQL object (table, view, or function) | `schema` — schema name (default: 'public'), `name` — object name (table, view, or function name), `type` — type of the object: 'table', 'view', 'function' |
| `execute-sql` | Execute a custom SQL query against PostgreSQL (supports SELECT, INSERT, UPDATE, DELETE, DDL operations) | `query` — SQL query to execute, `params` — parameters for the SQL query (optional), `saveToFile` — save results to a file instead of returning them directly. When enabled, uses cursor-based streaming for SELECT queries to avoid memory issues (optional), `filePath` — explicit path to save the file (optional, auto-generated if not provided), `forceSaveToFile` — force saving results to a file even if the query does not support cursor-based streaming (e.g., INSERT, UPDATE, DELETE). When this flag is true, non-SELECT queries will also be saved to file but may consume more memory. Default is false. |
| `index-operation` | Create, drop, or list indexes on PostgreSQL tables (list operation only in read-only mode) | `operation` — operation to perform: 'create', 'drop' or 'list', `schema` — schema name where the table is located (default: 'public'), `table` — table name to create/drop index on (required for create/drop), `name` — index name (required for create/drop), `columns` — array of column names to include in the index (required for create), `unique` — whether to create a unique index (default: false), `ifNotExists` — add IF NOT EXISTS clause for create operation (default: false), `ifExists` — add IF EXISTS clause for drop operation (default: false), `tableName` — table name to list indexes for (optional for list operation) |

### Non-Read-Only Mode Tools

| Tool | Description | Main Parameters |
| --- | --- | --- |
| `execute-sql` | Execute a custom SQL query against PostgreSQL (supports SELECT, INSERT, UPDATE, DELETE, DDL operations) | `query` — SQL query to execute, `params` — parameters for the SQL query (optional), `saveToFile` — save results to a file instead of returning them directly. When enabled, uses cursor-based streaming for SELECT queries to avoid memory issues (optional), `filePath` — explicit path to save the file (optional, auto-generated if not provided), `forceSaveToFile` — force saving results to a file even if the query does not support cursor-based streaming (e.g., INSERT, UPDATE, DELETE). When this flag is true, non-SELECT queries will also be saved to file but may consume more memory. Default is false. |

**Note:** The server runs in read-only mode by default to prevent accidental data modifications. In read-only mode, all write operations are blocked including:
- Data modification operations: `INSERT`, `UPDATE`, `DELETE`, DDL statements
- Index operations: `create` and `drop` operations in index-operation tool
- Any `execute-sql` operations that contain write queries when in read-only mode

The following operations are restricted in read-only mode:
- DDL operations in `execute-sql` (CREATE, ALTER, DROP, etc.)
- `create` and `drop` operations in `index-operation`
These operations are only available when the server is running in read-write mode.
