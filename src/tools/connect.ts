import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';

const connectSchema = z.object({
  readonlyMode: z.boolean().optional().describe('Run in read-only mode'),
  poolSize: z.number().optional().describe('Connection pool size'),
  idleTimeoutMillis: z.number().optional().describe('Idle timeout in milliseconds'),
  connectionTimeoutMillis: z.number().optional().describe('Connection timeout in milliseconds'),
});

export type ConnectParams = z.infer<typeof connectSchema>;

// Export the registration function for the server
// The client parameter is required to match the registration function signature used by other tools
export function registerConnectTool(server: McpServer, _client: PostgreSQLClient): void {
  server.registerTool(
    'connect',
    {
      title: 'Connect to PostgreSQL',
      description: 'Establish connection to PostgreSQL using connection string from environment variable POSTGRES_MCP_CONNECTION_STRING. Call service-info first to check current connection status.',
      inputSchema: connectSchema.shape,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (params: ConnectParams, _extra) => {
      const postgresClient = PostgreSQLClient.getInstance();

      try {
        // Only use the connection string from environment variable
        const connectionString = process.env['POSTGRES_MCP_CONNECTION_STRING'];

        if (!connectionString) {
          return toolError(new Error('Connection string is required. Please set POSTGRES_MCP_CONNECTION_STRING environment variable.'));
        }

        // Check if we're already connected to the same connection string
        const currentConnectionInfo = postgresClient.getConnectionInfo();

        if (currentConnectionInfo.isConnected && postgresClient.getConnectionString() === connectionString) {
          const response = {
            success: true,
            message: 'Already connected to PostgreSQL with the same connection string',
            isConnected: true,
          };

          return toolSuccess(response);
        }

        // Use default values if not provided - these are already handled by Zod
        const readonlyMode = params.readonlyMode ?? true;
        const poolSize = params.poolSize ?? 1;
        const idleTimeoutMillis = params.idleTimeoutMillis ?? 30000; // 30 seconds
        const connectionTimeoutMillis = params.connectionTimeoutMillis ?? 10000; // 10 seconds

        // If connection string is different or we're not connected, connect
        await postgresClient.connect(readonlyMode, poolSize, idleTimeoutMillis, connectionTimeoutMillis);

        const response = {
          success: true,
          message: 'Connected to PostgreSQL successfully using POSTGRES_MCP_CONNECTION_STRING environment variable',
          isConnected: true,
        };

        return toolSuccess(response);
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
