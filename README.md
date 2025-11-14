# PostgreSQL Model Context Protocol (MCP) Server

MCP server for comprehensive PostgreSQL integration: database operations, tables, queries, connection management, monitoring.

## Features

- Connect to PostgreSQL databases via connection string
- Read-only mode using PostgreSQL's transaction-level read-only mode
- Comprehensive toolset for database operations
- Support for large data sets through streaming
- Standard MCP protocol implementation

## Prerequisites

- Node.js >= 20.0.0
- PostgreSQL server accessible via connection string

## Installation

```bash
npm install -g @vitalyostanin/postgres-mcp
```

## Usage

```bash
# Set the connection string environment variable
export POSTGRES_MCP_CONNECTION_STRING="postgresql://username:password@host:port/database"

# Start the MCP server
postgres-mcp --read-only --pool-size=5
```

### Command Line Options

- `--read-only`: Run in read-only mode (default: true)
- `--auto-connect`: Auto connect to PostgreSQL on startup (default: false)
- `--pool-size`: Connection pool size (default: 1)

## Environment Variables

- `POSTGRES_MCP_CONNECTION_STRING`: PostgreSQL connection string
- `POSTGRES_MCP_TIMEZONE`: Timezone for date operations (default: Europe/Moscow)
- `POSTGRES_MCP_POOL_SIZE`: Connection pool size (default value is overridden by --pool-size CLI option)

## Tools

The server provides the following tools:

### Connection Tools
- `connect`: Connect to PostgreSQL
- `disconnect`: Disconnect from PostgreSQL
- `service_info`: Get service information and connection status

### Database Exploration Tools
- `list-databases`: List all databases
- `list-schemas`: List all schemas in the database
- `list-tables`: List all tables in a schema
- `list-columns`: List all columns in a table
- `table-info`: Get information about a table (size, row count, etc.)

### Data Operation Tools
- `select`: Execute SELECT queries
- `find`: Query data from tables
- `count`: Count records in tables
- `insert`: Insert records
- `update`: Update records
- `delete`: Delete records
- `query`: Execute arbitrary SQL queries
- `execute`: Execute arbitrary SQL commands

### Schema Operation Tools
- `create-table`: Create a new table
- `drop-table`: Drop a table
- `create-index`: Create an index
- `drop-index`: Drop an index
- `alter-table`: Modify table structure

### Analysis Tools
- `explain`: Analyze query execution plan
- `postgresql-logs`: Get PostgreSQL logs
- `db-stats`: Get database statistics

## License

MIT