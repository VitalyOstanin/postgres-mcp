import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VERSION } from "./version.js";
import { PostgreSQLClient } from "./postgres-client.js";
import { loadConfig } from "./config.js";
import { initializeTimezone } from "./utils/date.js";
import { redactConnectionString } from "./utils/redact.js";
import { registerConnectTool } from "./tools/connect.js";
import { registerDisconnectTool } from "./tools/disconnect.js";
import { registerListSchemasTool } from "./tools/list-schemas.js";
import { registerServiceInfoTool } from "./tools/service-info.js";
import { registerExecuteSQLTool } from "./tools/execute-sql.js";
import { registerListObjectsTool } from "./tools/list-objects.js";
import { registerShowObjectTool } from "./tools/show-object.js";
import { registerIndexOperationTool } from "./tools/index-operation.js";

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
      autoConnect: options.autoConnect ?? false,
      readonlyMode: options.readonlyMode ?? true,
      poolSize: options.poolSize ?? 1,
      idleTimeout: options.idleTimeout ?? 30000,
      connectionTimeout: options.connectionTimeout ?? 10000,
    };
    this.server = new McpServer(
      {
        name: "postgres-mcp",
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

  async connect(transport: Parameters<McpServer["connect"]>[0]): Promise<void> {
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
