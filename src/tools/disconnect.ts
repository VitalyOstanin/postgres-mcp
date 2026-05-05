import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';

const disconnectSchema = z.object({
});

export type DisconnectParams = z.infer<typeof disconnectSchema>;

// Export the registration function for the server
// The client parameter is required to match the registration function signature used by other tools
export function registerDisconnectTool(server: McpServer, client: PostgreSQLClient): void {
  server.registerTool(
    'disconnect',
    {
      title: 'Disconnect from PostgreSQL',
      description: [
        'Disconnect from PostgreSQL: ends the connection pool, closes all idle TCP sockets, and clears the in-memory connection state.',
        'Use for: cleanly tearing down the session before exit; releasing the pool so a subsequent `connect` can use a different connection string or readonly mode.',
        'Use `service-info` afterwards to verify `isConnected: false`.',
        'Limitations: this is a no-op (returns success) when the server is already disconnected.',
      ].join(' '),
      inputSchema: disconnectSchema.shape,
      annotations: {
        // disconnect tears down the pool — a server-state mutation, not a read.
        readOnlyHint: false,
      },
    },
    async (_params, _extra) => {
      try {
        if (!client.isConnectedToPostgreSQL()) {
          return toolSuccess({
            success: true,
            message: 'Already disconnected from PostgreSQL',
            isConnected: false,
          });
        }

        await client.disconnect('client requested disconnect via MCP tool');

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
