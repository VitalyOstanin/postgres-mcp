import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { PostgreSQLClient } from '../postgres-client.js';
import { toolError } from './tool-response.js';

const NOT_CONNECTED_MESSAGE = 'Not connected to PostgreSQL. Please connect first.';

/**
 * Common guard for tool handlers that require an active PostgreSQL pool.
 * Returns a `CallToolResult` describing the error when the client is not
 * connected, or `null` when the caller can proceed.
 */
export function requireConnection(client: PostgreSQLClient): CallToolResult | null {
  if (client.isConnectedToPostgreSQL()) {
    return null;
  }

  return toolError(new Error(NOT_CONNECTED_MESSAGE));
}
