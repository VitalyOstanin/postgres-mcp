import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VERSION } from './version.js';
import { PostgreSQLClient } from './postgres-client.js';
import { loadConfig } from './config.js';
import { initializeTimezone } from './utils/date.js';
import { redactConnectionString } from './utils/redact.js';
import { supportsCursor } from './utils/query-analyzer.js';
import { registerConnectTool } from './tools/connect.js';
import { registerDisconnectTool } from './tools/disconnect.js';
import { registerListSchemasTool } from './tools/list-schemas.js';
import { registerServiceInfoTool } from './tools/service-info.js';
import { registerExecuteSQLTool } from './tools/execute-sql.js';
import { registerListObjectsTool } from './tools/list-objects.js';
import { registerShowObjectTool } from './tools/show-object.js';
import { registerIndexOperationTool } from './tools/index-operation.js';
import {
  DEFAULT_AUTO_CONNECT,
  DEFAULT_CONNECTION_TIMEOUT_MS,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_POOL_SIZE,
  DEFAULT_READONLY_MODE,
} from './defaults.js';

export interface PostgreSQLServerOptions {
  autoConnect?: boolean;
  readonlyMode?: boolean;
  poolSize?: number;
  idleTimeout?: number;
  connectionTimeout?: number;
}

export class PostgreSQLServer {
  private readonly server: McpServer;
  private readonly postgresClient: PostgreSQLClient;
  private readonly options: Required<PostgreSQLServerOptions>;

  constructor(options: PostgreSQLServerOptions = {}) {
    this.options = {
      autoConnect: options.autoConnect ?? DEFAULT_AUTO_CONNECT,
      readonlyMode: options.readonlyMode ?? DEFAULT_READONLY_MODE,
      poolSize: options.poolSize ?? DEFAULT_POOL_SIZE,
      idleTimeout: options.idleTimeout ?? DEFAULT_IDLE_TIMEOUT_MS,
      connectionTimeout: options.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT_MS,
    };
    this.server = new McpServer(
      {
        name: 'postgres-mcp',
        version: VERSION,
      },
      {
        capabilities: {
          tools: {
            listChanged: false,
          },
          logging: {},
        },
      },
    );

    const config = loadConfig();

    initializeTimezone(config.timezone);

    this.postgresClient = new PostgreSQLClient(this.options.readonlyMode);

    registerConnectTool(this.server, this.postgresClient, {
      readonlyMode: this.options.readonlyMode,
      poolSize: this.options.poolSize,
      idleTimeoutMillis: this.options.idleTimeout,
      connectionTimeoutMillis: this.options.connectionTimeout,
    });
    registerDisconnectTool(this.server, this.postgresClient);
    registerListSchemasTool(this.server, this.postgresClient);
    registerExecuteSQLTool(this.server, this.postgresClient);
    registerListObjectsTool(this.server, this.postgresClient);
    registerShowObjectTool(this.server, this.postgresClient);
    registerIndexOperationTool(this.server, this.postgresClient);
    registerServiceInfoTool(this.server, this.postgresClient);
  }

  /**
   * Run any startup work (notably, auto-connect to PostgreSQL) before the
   * MCP transport is wired up. Throws on misconfiguration or failed
   * auto-connect so the surrounding entry point can exit cleanly instead of
   * accepting tool calls against a half-initialised server.
   */
  async init(): Promise<void> {
    // Warm up the pgsql-parser WASM module so the first execute-sql call
    // with cursor analysis doesn't pay the ~20-100 ms cold-start cost on
    // the user's first query. Cheap (parses `SELECT 1`) and fire-and-forget
    // — failures here only mean the first parse takes longer, never an
    // outright error, so we swallow them. Done before auto-connect so the
    // module starts loading in parallel with the network handshake.
    void supportsCursor('SELECT 1').catch(() => { /* warm-up only */ });

    if (!this.options.autoConnect) {
      return;
    }

    const connectionString = process.env['POSTGRES_MCP_CONNECTION_STRING'];

    if (!connectionString) {
      throw new Error(
        '--auto-connect was requested but POSTGRES_MCP_CONNECTION_STRING is not set. Set the variable or omit --auto-connect to use the connect tool manually.',
      );
    }

    try {
      await this.postgresClient.connect(
        this.options.readonlyMode,
        this.options.poolSize,
        this.options.idleTimeout,
        this.options.connectionTimeout,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      throw new Error(`Failed to auto-connect to PostgreSQL: ${redactConnectionString(message)}`, { cause: error });
    }
  }

  async connect(transport: Parameters<McpServer['connect']>[0]): Promise<void> {
    await this.server.connect(transport);
  }

  /**
   * Best-effort graceful shutdown: close the PostgreSQL pool so any in-flight
   * connections are released cleanly. Safe to call multiple times.
   */
  async shutdown(): Promise<void> {
    try {
      if (this.postgresClient.isConnectedToPostgreSQL()) {
        await this.postgresClient.disconnect('server shutdown');
      }
    } catch (error) {
      // pg can include the raw DSN in error messages on shutdown failures.
      const message = error instanceof Error ? error.message : String(error);

      console.error('Error while shutting down PostgreSQL client:', redactConnectionString(message));
    }
  }
}
