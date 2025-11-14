import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';

const disconnectSchema = z.object({
});

export type DisconnectParams = z.infer<typeof disconnectSchema>;

// Export the registration function for the server
// The client parameter is required to match the registration function signature used by other tools
export function registerDisconnectTool(server: McpServer, client: PostgreSQLClient) {
  server.registerTool(
    'disconnect',
    {
      title: 'Disconnect from PostgreSQL',
      description: 'Disconnect from PostgreSQL and clear the connection. Use service_info to check connection status after disconnecting.',
      inputSchema: disconnectSchema.shape,
    },
    async () => {
      try {
        if (!client.isConnectedToPostgreSQL()) {
          return toolSuccess({
            success: true,
            message: 'Already disconnected from PostgreSQL',
            isConnected: false,
          });
        }

        await client.disconnect();

        return toolSuccess({
          success: true,
          message: 'Disconnected from PostgreSQL successfully',
          isConnected: false,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}