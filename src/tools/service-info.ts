import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess } from '../utils/tool-response.js';
import { redactConnectionString } from '../utils/redact.js';
import { VERSION } from '../version.js';
import { getTimezone } from '../utils/date.js';

const serviceInfoSchema = z.object({
});

export type ServiceInfoParams = z.infer<typeof serviceInfoSchema>;

// Export the registration function for the server
// The client parameter is required to match the registration function signature used by other tools
export function registerServiceInfoTool(server: McpServer, client: PostgreSQLClient): void {
  server.registerTool(
    'service-info',
    {
      title: 'Service Information',
      description: [
        'Get PostgreSQL service information and current connection status.',
        'Use for: a quick health check before issuing queries; inspecting current pool size, timeouts and timezone.',
        'Returns: `name`, `version`, `isConnected`, `readonly`, `timezone`. When connected: `poolSize`, `idleTimeoutMillis`, `connectionTimeoutMillis`. When disconnected: `disconnectReason` and/or `connectionError`.',
        'Limitations: this reports server-internal state only — it does not query PostgreSQL.',
      ].join(' '),
      inputSchema: serviceInfoSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        // service-info reports server-internal state only — it does not
        // touch PostgreSQL — so the answer depends on no external system.
        openWorldHint: false,
      },
    },
    async (_params, _extra) => {
      const connectionInfo = client.getConnectionInfo();
      const baseResponse = {
        name: 'postgres-mcp',
        isConnected: connectionInfo.isConnected,
        readonly: client.isReadonly(),
        version: VERSION,
        timezone: getTimezone(),
      };
      // Create extended response based on connection status
      let finalResponse;

      if (!connectionInfo.isConnected) {
        // Defense in depth: messages reach `connectionInfo` already redacted
        // by PostgreSQLClient, but run them through one more time so any
        // future code path that bypasses the client redaction still cannot
        // surface a DSN to the MCP client.
        finalResponse = {
          ...baseResponse,
          ...(connectionInfo.disconnectReason && { disconnectReason: redactConnectionString(connectionInfo.disconnectReason) }),
          ...(connectionInfo.connectionError && { connectionError: redactConnectionString(connectionInfo.connectionError) }),
        };
      } else {
        finalResponse = {
          ...baseResponse,
          poolSize: client.getPoolSize(),
          idleTimeoutMillis: client.getIdleTimeoutMillis(),
          connectionTimeoutMillis: client.getConnectionTimeoutMillis(),
        };
      }

      return toolSuccess(finalResponse);
    },
  );
}
