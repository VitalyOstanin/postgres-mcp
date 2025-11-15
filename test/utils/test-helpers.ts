import { MockPostgreSQLClientInstance } from '../__mocks__/postgres-client.mock.js';

export interface MockServer {
  registerTool: jest.Mock;
}

// Helper function to create a mock server
export function createMockServer(): MockServer {
  return {
    registerTool: jest.fn(),
  };
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
