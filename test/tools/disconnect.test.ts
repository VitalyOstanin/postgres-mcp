import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MockPostgreSQLClient } from '../__mocks__/postgres-client.mock';
import { resetMockClient, getMockClient } from '../utils/test-helpers';
import { registerDisconnectTool } from '../../src/tools/disconnect';
import { toolSuccess, toolError } from '../../src/utils/tool-response';

// Mock the PostgreSQL client
vi.mock('../../src/postgres-client', () => ({
  PostgreSQLClient: MockPostgreSQLClient,
}));

interface MockServer {
  registerTool: Mock;
}

describe('Disconnect Tool', () => {
  let mockServer: MockServer;
  let mockClient: ReturnType<typeof getMockClient>;

  beforeEach(() => {
    // Reset the mock client state
    resetMockClient();

    // Create mock server
    mockServer = {
      registerTool: vi.fn(),
    };

    mockClient = getMockClient();
  });

  it('registers the disconnect tool correctly', () => {
    // Call the registration function
    registerDisconnectTool(mockServer as unknown as McpServer, mockClient);

    // Verify that registerTool was called with correct parameters
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'disconnect',
      expect.objectContaining({
        title: 'Disconnect from PostgreSQL',
        description: expect.stringContaining('Disconnect from PostgreSQL'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      }),
      expect.any(Function),
    );
  });

  it('disconnects successfully when connected', async () => {
    // Mock client is connected initially
    mockClient.setConnected(true);

    // Get the registered tool function
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let toolFunction: any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockServer.registerTool = vi.fn().mockImplementation((_name: unknown, _config: unknown, func: any) => {
      toolFunction = func;
    });

    // Register the tool to get the function
    registerDisconnectTool(mockServer as unknown as McpServer, mockClient);

    // Call the tool function
    const result = await toolFunction!();

    // Verify success response
    expect(result).toEqual(
      toolSuccess({
        success: true,
        message: 'Disconnected from PostgreSQL successfully',
        isConnected: false,
      }),
    );

    // Verify that disconnect was called
    expect(mockClient.isConnectedToPostgreSQL()).toBe(false);
  });

  it('returns success when already disconnected', async () => {
    // Mock client is already disconnected
    mockClient.setConnected(false);

    // Get the registered tool function
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let toolFunction: any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockServer.registerTool = vi.fn().mockImplementation((_name: unknown, _config: unknown, func: any) => {
      toolFunction = func;
    });

    // Register the tool to get the function
    registerDisconnectTool(mockServer as unknown as McpServer, mockClient);

    // Call the tool function
    const result = await toolFunction!();

    // Verify success response for already disconnected
    expect(result).toEqual(
      toolSuccess({
        success: true,
        message: 'Already disconnected from PostgreSQL',
        isConnected: false,
      }),
    );
  });

  it('handles disconnection errors properly', async () => {
    // Mock client to throw an error when disconnecting
    const disconnectionError = new Error('Failed to disconnect from PostgreSQL');
    // We need to create a new mock client with the error
    const errorClient = new MockPostgreSQLClient();

    vi.spyOn(errorClient, 'isConnectedToPostgreSQL').mockReturnValue(true);
    vi.spyOn(errorClient, 'disconnect').mockRejectedValue(disconnectionError);

    // Get the registered tool function
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let toolFunction: any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockServer.registerTool = vi.fn().mockImplementation((_name: unknown, _config: unknown, func: any) => {
      toolFunction = func;
    });

    // Register the tool to get the function
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerDisconnectTool(mockServer as unknown as McpServer, errorClient as any);

    // Call the tool function
    const result = await toolFunction!();

    // Verify error response
    expect(result).toEqual(toolError(disconnectionError));
  });
});
