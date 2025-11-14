import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VERSION } from "./version.js";
import { PostgreSQLClient } from "./postgres-client.js";
import { loadConfig } from "./config.js";
import { initializeTimezone } from "./utils/date.js";
import { registerConnectTool } from "./tools/connect.js";
import { registerDisconnectTool } from "./tools/disconnect.js";
import { registerListSchemasTool } from "./tools/list-schemas.js";
import { registerServiceInfoTool } from "./tools/service-info.js";
import { registerExecuteSQLTool } from "./tools/execute-sql.js";
import { registerListObjectsTool } from "./tools/list-objects.js";
import { registerShowObjectTool } from "./tools/show-object.js";
import { registerIndexOperationTool } from "./tools/index-operation.js";

export class PostgreSQLServer {
  private readonly server: McpServer;
  private readonly postgresClient: PostgreSQLClient;

  constructor(autoConnect: boolean = false, readonlyMode: boolean = true, poolSize: number = 1, idleTimeout: number = 30000, connectionTimeout: number = 10000) {
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

    // Load configuration and initialize timezone
    const config = loadConfig();

    initializeTimezone(config.timezone);

    this.postgresClient = PostgreSQLClient.getInstance();
    // Set the readonly mode immediately when creating the server
    this.postgresClient.setReadonlyMode(readonlyMode);

    // Import and register the connect tool
    registerConnectTool(this.server, this.postgresClient);
    registerDisconnectTool(this.server, this.postgresClient);
    registerListSchemasTool(this.server, this.postgresClient);
    registerExecuteSQLTool(this.server, this.postgresClient);
    registerListObjectsTool(this.server, this.postgresClient);
    registerShowObjectTool(this.server, this.postgresClient);
    registerIndexOperationTool(this.server, this.postgresClient);
    registerServiceInfoTool(this.server, this.postgresClient);

    // If auto-connect option is enabled, connect to PostgreSQL on startup
    if (autoConnect) {
      const connectionString = process.env['POSTGRES_MCP_CONNECTION_STRING'];

      if (connectionString) {
        // Connect in readonly mode if it's enabled
        this.postgresClient.connect(readonlyMode, poolSize, idleTimeout, connectionTimeout).catch(error => {
          console.error("Failed to auto-connect to PostgreSQL:", error);
          // Set connection error state or emit event for proper error handling
          // Consider retrying connection or notifying the user
          process.exitCode = 1;
        });
      }
    }
  }

  async connect(transport: Parameters<McpServer["connect"]>[0]): Promise<void> {
    await this.server.connect(transport);
  }
}
