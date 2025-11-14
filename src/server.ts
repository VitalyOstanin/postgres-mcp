import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VERSION } from "./version.js";
import { PostgreSQLClient } from "./postgres-client.js";
import { loadConfig } from "./config.js";
import { initializeTimezone } from "./utils/date.js";
import { registerConnectTool } from "./tools/connect.js";
import { registerDisconnectTool } from "./tools/disconnect.js";
import { registerListDatabasesTool } from "./tools/list-databases.js";
import { registerListSchemasTool } from "./tools/list-schemas.js";
import { registerListTablesTool } from "./tools/list-tables.js";
import { registerListColumnsTool } from "./tools/list-columns.js";
import { registerServiceInfoTool } from "./tools/service-info.js";
import { registerTableInfoTool } from "./tools/table-info.js";
import { registerFindTool } from "./tools/find.js";
import { registerSelectTool } from "./tools/select.js";
import { registerCountTool } from "./tools/count.js";
import { registerInsertTool } from "./tools/insert.js";
import { registerUpdateTool } from "./tools/update.js";
import { registerDeleteTool } from "./tools/delete.js";
import { registerCreateTableTool } from "./tools/create-table.js";
import { registerDropTableTool } from "./tools/drop-table.js";
import { registerCreateIndexTool } from "./tools/create-index.js";
import { registerDropIndexTool } from "./tools/drop-index.js";
import { registerQueryTool } from "./tools/query.js";
import { registerExplainTool } from "./tools/explain.js";

export class PostgreSQLServer {
  private readonly server: McpServer;
  private readonly postgresClient: PostgreSQLClient;

  constructor(autoConnect: boolean = false, readonlyMode: boolean = true, poolSize: number = 1) {
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
    registerListDatabasesTool(this.server, this.postgresClient);
    registerListSchemasTool(this.server, this.postgresClient);
    registerListTablesTool(this.server, this.postgresClient);
    registerListColumnsTool(this.server, this.postgresClient);
    registerTableInfoTool(this.server, this.postgresClient);
    registerFindTool(this.server, this.postgresClient);
    registerSelectTool(this.server, this.postgresClient);
    registerCountTool(this.server, this.postgresClient);
    registerInsertTool(this.server, this.postgresClient);
    registerUpdateTool(this.server, this.postgresClient);
    registerDeleteTool(this.server, this.postgresClient);
    registerCreateTableTool(this.server, this.postgresClient);
    registerDropTableTool(this.server, this.postgresClient);
    registerCreateIndexTool(this.server, this.postgresClient);
    registerDropIndexTool(this.server, this.postgresClient);
    registerQueryTool(this.server, this.postgresClient);
    registerExplainTool(this.server, this.postgresClient);
    registerServiceInfoTool(this.server, this.postgresClient);

    // If auto-connect option is enabled, connect to PostgreSQL on startup
    if (autoConnect) {
      const connectionString = process.env['POSTGRES_MCP_CONNECTION_STRING'];

      if (connectionString) {
        // Connect in readonly mode if it's enabled
        this.postgresClient.connect(readonlyMode, poolSize).catch(error => {
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