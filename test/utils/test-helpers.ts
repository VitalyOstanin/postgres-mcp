import { MockPostgreSQLClientInstance } from '../__mocks__/postgres-client.mock.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Helper function to create a mock server
export function createMockServer(): jest.Mocked<McpServer> {
  return {
    registerTool: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
    close: jest.fn(),
  } as unknown as jest.Mocked<McpServer>;
}

// Helper function to get the mock client instance
export function getMockClient(): ReturnType<typeof MockPostgreSQLClientInstance.getInstance> {
  return MockPostgreSQLClientInstance.getInstance();
}

// Helper function to reset the mock client state
export function resetMockClient(): void {
  MockPostgreSQLClientInstance.resetInstance();

  const client = getMockClient();

  client.setConnected(false);
  client.setExecuteQueryError(null);
  client.setExecuteQueryResult([]);
}

// Helper function to call a tool function with parameters
export async function callToolFunction(
  toolFunction: (params: unknown) => Promise<unknown>,
  params: unknown,
): Promise<unknown> {
  return await toolFunction(params);
}
