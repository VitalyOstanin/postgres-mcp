import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';

// Define the Tool type
interface Tool {
  name: string;
  description: string;
  inputSchema: object;
  // Examples can contain any structure based on the tool's requirements
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  examples?: any[];
  // Tool implementation params are dynamic based on the specific tool schema
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  implementation: (_params: any) => Promise<any>;
}

const connectSchema = z.object({
});

export type ConnectParams = z.infer<typeof connectSchema>;

export const connectTool: Tool = {
  name: 'connect',
  description: 'Establish connection to PostgreSQL using connection string from environment variable POSTGRES_MCP_CONNECTION_STRING. Call service_info first to check current connection status.',
  inputSchema: connectSchema,
  examples: [
    {
      input: {},
      output: {
        success: true,
        message: 'Connected to PostgreSQL successfully using POSTGRES_MCP_CONNECTION_STRING environment variable',
        isConnected: true,
      },
      description: 'Connect to PostgreSQL using connection string from environment variable',
    },
  ],
  // Parameters are required by the tool interface but not used since connect doesn't need input parameters
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async implementation(_params: ConnectParams) {
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

      // If connection string is different or we're not connected, connect
      await postgresClient.connect();

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
};

// Export the registration function for the server
// The _client parameter is required to match the registration function signature used by server.ts
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function registerConnectTool(server: McpServer, _client: PostgreSQLClient) {
  server.registerTool(
    connectTool.name,
    {
      description: connectTool.description,
      inputSchema: connectSchema.shape,
    },
    connectTool.implementation,
  );
}