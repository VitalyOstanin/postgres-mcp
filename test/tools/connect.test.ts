import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MockPostgreSQLClient } from '../__mocks__/postgres-client.mock';
import { resetMockClient, getMockClient } from '../utils/test-helpers';
import { registerConnectTool } from '../../src/tools/connect';
import { toolSuccess, toolError } from '../../src/utils/tool-response';

// Mock the PostgreSQL client
jest.mock('../../src/postgres-client', () => ({
  PostgreSQLClient: MockPostgreSQLClient,
  getMockPostgreSQLClient: () => new MockPostgreSQLClient(),
}));

// Mock the environment variable
const mockEnv = {
  POSTGRES_MCP_CONNECTION_STRING: 'postgresql://test:test@localhost:5432/test',
};

describe('Connect Tool', () => {
  interface MockServer {
    registerTool: jest.Mock;
  }

  let mockServer: MockServer;
  let mockClient: ReturnType<typeof getMockClient>;

  beforeEach(() => {
    // Set up environment variables
    process.env = { ...process.env, ...mockEnv };

    // Reset the mock client state
    resetMockClient();

    // Create mock server
    mockServer = {
      registerTool: jest.fn(),
    };

    mockClient = getMockClient();
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...process.env };
  });

  it('registers the connect tool correctly', () => {
    // Call the registration function
    registerConnectTool(mockServer as unknown as McpServer, mockClient);

    // Verify that registerTool was called with correct parameters
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'connect',
      expect.objectContaining({
        title: 'Connect to PostgreSQL',
        description: expect.stringContaining('Establish connection to PostgreSQL'),
        annotations: { readOnlyHint: true },
      }),
      expect.any(Function),
    );
  });

  it('connects successfully when not already connected', async () => {
    // Get the instance that will be used by the tool
    const instance = getMockClient();

    instance.setConnected(false);

    // Get the registered tool function
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let toolFunction: any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockServer.registerTool = jest.fn().mockImplementation((name: unknown, config: unknown, func: any) => {
      toolFunction = func;
    });

    // Register the tool function
    registerConnectTool(mockServer as unknown as McpServer, instance);

    // Call the tool function
    const result = await toolFunction!({}, {});

    // Verify success response
    expect(result).toEqual(
      toolSuccess({
        success: true,
        message: 'Connected to PostgreSQL successfully using POSTGRES_MCP_CONNECTION_STRING environment variable',
        isConnected: true,
      }),
    );
  });

  it('returns success when already connected to the same connection string', async () => {
    // Get the instance that will be used by the tool
    const instance = getMockClient();

    // Mock client is already connected
    instance.setConnected(true);

    // Mock the getConnectionInfo to return connected state
    jest.spyOn(instance, 'getConnectionInfo').mockReturnValue({
      isConnected: true,
    });

    // Mock the getConnectionString to return the expected connection string
    jest.spyOn(instance, 'getConnectionString').mockReturnValue(mockEnv.POSTGRES_MCP_CONNECTION_STRING);

    // Get the registered tool function
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let toolFunction: any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockServer.registerTool = jest.fn().mockImplementation((name: unknown, config: unknown, func: any) => {
      toolFunction = func;
    });

    // Register the tool function
    registerConnectTool(mockServer as unknown as McpServer, instance);

    // Call the tool function
    const result = await toolFunction!({}, {});

    // Verify success response for already connected
    expect(result).toEqual(
      toolSuccess({
        success: true,
        message: 'Already connected to PostgreSQL with the same connection string',
        isConnected: true,
      }),
    );
  });

  it('returns error when connection string is not set in environment', async () => {
    // Get the instance that will be used by the tool
    const instance = getMockClient();

    // Temporarily remove the connection string from environment
    delete process.env['POSTGRES_MCP_CONNECTION_STRING'];

    // Get the registered tool function
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let toolFunction: any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockServer.registerTool = jest.fn().mockImplementation((name: unknown, config: unknown, func: any) => {
      toolFunction = func;
    });

    // Register the tool function
    registerConnectTool(mockServer as unknown as McpServer, instance);

    // Call the tool function
    const result = await toolFunction!({}, {});

    // Verify error response
    expect(result).toEqual(
      toolError(new Error('Connection string is required. Please set POSTGRES_MCP_CONNECTION_STRING environment variable.')),
    );
  });

  it('handles connection errors properly', async () => {
    // Mock client to throw an error when connecting
    const connectionError = new Error('Failed to connect to PostgreSQL');
    // Get the same instance that will be used by the tool
    const mockInstance = getMockClient();

    jest.spyOn(mockInstance, 'connect').mockRejectedValue(connectionError);

    // Get the registered tool function
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let toolFunction: any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockServer.registerTool = jest.fn().mockImplementation((name: unknown, config: unknown, func: any) => {
      toolFunction = func;
    });

    // Register the tool to get the function
    registerConnectTool(mockServer as unknown as McpServer, mockInstance);

    // Call the tool function
    const result = await toolFunction!({}, {});

    // Verify error response
    expect(result).toEqual(toolError(connectionError));
  });
});
