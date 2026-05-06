import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolSuccess, toolError } from '../utils/tool-response.js';
import { CONNECTION_STRING_REQUIRED_MESSAGE } from '../utils/connection-messages.js';

const connectSchema = z.object({
  readonlyMode: z.boolean().optional().describe('Run in read-only mode'),
  poolSize: z.number().optional().describe('Connection pool size'),
  idleTimeoutMillis: z.number().optional().describe('Idle timeout in milliseconds'),
  connectionTimeoutMillis: z.number().optional().describe('Connection timeout in milliseconds'),
});

export type ConnectParams = z.infer<typeof connectSchema>;

export interface ConnectToolDefaults {
  readonlyMode: boolean;
  poolSize: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
}

/**
 * Register the `connect` MCP tool. Opens a PostgreSQL pool using
 * the connection string from `POSTGRES_MCP_CONNECTION_STRING`. Returns
 * success without reopening the pool when the requested settings
 * already match the current connection.
 */
export function registerConnectTool(server: McpServer, client: PostgreSQLClient, defaults: ConnectToolDefaults): void {
  server.registerTool(
    'connect',
    {
      title: 'Connect to PostgreSQL',
      description: [
        'Establish connection to PostgreSQL using the connection string from the POSTGRES_MCP_CONNECTION_STRING environment variable.',
        'Use for: opening a session before running queries; reconnecting with different pool/timeout settings.',
        'Call `service-info` first to check current connection status — if already connected to the same connection string AND with matching readonly/pool/timeout settings, this tool short-circuits and returns success without reopening the pool. When any setting differs, the pool is closed and reopened with the new values.',
        'Limitations: the connection string itself cannot be passed as a parameter (it is read from the environment). Switching readonly mode at runtime requires reconnecting. Omitted parameters fall back to the values supplied via the server CLI flags (--read-only, --pool-size, --idle-timeout, --connection-timeout), not to hard-coded defaults.',
      ].join(' '),
      inputSchema: connectSchema.shape,
      annotations: {
        // connect mutates server state (opens a pooled TCP connection,
        // stores credentials), so it is not a read-only operation. It is
        // idempotent: calling connect again with the same connection
        // string and settings short-circuits to a no-op (see fast-path
        // below).
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: ConnectParams, _extra) => {
      try {
        const connectionString = process.env['POSTGRES_MCP_CONNECTION_STRING'];

        if (!connectionString) {
          return toolError(new Error(CONNECTION_STRING_REQUIRED_MESSAGE));
        }

        // Inherit from server-level CLI defaults so that an operator who
        // launched with `--pool-size=10` doesn't silently fall back to 1
        // when the MCP client calls `connect` without arguments.
        const readonlyMode = params.readonlyMode ?? defaults.readonlyMode;
        const poolSize = params.poolSize ?? defaults.poolSize;
        const idleTimeoutMillis = params.idleTimeoutMillis ?? defaults.idleTimeoutMillis;
        const connectionTimeoutMillis = params.connectionTimeoutMillis ?? defaults.connectionTimeoutMillis;
        const currentConnectionInfo = client.getConnectionInfo();
        // Short-circuit only when the full set of effective parameters
        // matches: connection string AND readonly AND pool size AND both
        // timeouts. Any drift (e.g. caller asked for a different pool size
        // or wants to flip readonly mode) must trigger a real reconnect so
        // the request takes effect; the previous behaviour silently
        // ignored everything except the connection string.
        const sameSettings = currentConnectionInfo.isConnected
          && client.getConnectionString() === connectionString
          && client.isReadonly() === readonlyMode
          && client.getPoolSize() === poolSize
          && client.getIdleTimeoutMillis() === idleTimeoutMillis
          && client.getConnectionTimeoutMillis() === connectionTimeoutMillis;

        if (sameSettings) {
          return toolSuccess({
            success: true,
            message: 'Already connected to PostgreSQL with the same connection string and settings',
            isConnected: true,
          });
        }

        await client.connect(readonlyMode, poolSize, idleTimeoutMillis, connectionTimeoutMillis);

        return toolSuccess({
          success: true,
          message: 'Connected to PostgreSQL successfully using POSTGRES_MCP_CONNECTION_STRING environment variable',
          isConnected: true,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
