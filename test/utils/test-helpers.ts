import { vi, type Mock } from 'vitest';
import type { PostgreSQLClient } from '../../src/postgres-client.js';
import { MockPostgreSQLClientInstance } from '../__mocks__/postgres-client.mock.js';

export interface MockServer {
  registerTool: Mock;
}

// Helper function to create a mock server
export function createMockServer(): MockServer {
  return {
    registerTool: vi.fn(),
  };
}

// Mock client appears to call sites both as the real PostgreSQLClient (for
// registerXxxTool signatures) and as the mock helper class (for setMock*
// methods). The intersection lets TypeScript accept both views.
type MockClient = PostgreSQLClient & ReturnType<typeof MockPostgreSQLClientInstance.getInstance>;

// Helper function to get the mock client instance
export function getMockClient(): MockClient {
  return MockPostgreSQLClientInstance.getInstance() as unknown as MockClient;
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
