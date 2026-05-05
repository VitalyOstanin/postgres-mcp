import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';

const connectSchema = z.object({
  readonlyMode: z.boolean().optional().describe('Run in read-only mode'),
  poolSize: z.number().optional().describe('Connection pool size'),
  idleTimeoutMillis: z.number().optional().describe('Idle timeout in milliseconds'),
  connectionTimeoutMillis: z.number().optional().describe('Connection timeout in milliseconds'),
});

export type ConnectParams = z.infer<typeof connectSchema>;

export function registerConnectTool(server: McpServer, client: PostgreSQLClient): void {
  server.registerTool(
    'connect',
    {
      title: 'Connect to PostgreSQL',
      description: [
        'Establish connection to PostgreSQL using the connection string from the POSTGRES_MCP_CONNECTION_STRING environment variable.',
        'Use for: opening a session before running queries; reconnecting with different pool/timeout settings.',
        'Call `service-info` first to check current connection status — if already connected to the same connection string, this tool short-circuits and returns success without reopening the pool.',
        'Limitations: the connection string itself cannot be passed as a parameter (it is read from the environment). Switching readonly mode at runtime requires reconnecting.',
      ].join(' '),
      inputSchema: connectSchema.shape,
      annotations: {
        // connect mutates server state (opens a pooled TCP connection,
        // stores credentials), so it is not a read-only operation.
        readOnlyHint: false,
      },
    },
    async (params: ConnectParams, _extra) => {
      try {
        // Only use the connection string from environment variable
        const connectionString = process.env['POSTGRES_MCP_CONNECTION_STRING'];

        if (!connectionString) {
          return toolError(new Error('Connection string is required. Please set POSTGRES_MCP_CONNECTION_STRING environment variable.'));
        }

        // Check if we're already connected to the same connection string
        const currentConnectionInfo = client.getConnectionInfo();

        if (currentConnectionInfo.isConnected && client.getConnectionString() === connectionString) {
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
        await client.connect(readonlyMode, poolSize, idleTimeoutMillis, connectionTimeoutMillis);

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
