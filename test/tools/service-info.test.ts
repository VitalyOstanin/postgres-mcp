import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MockPostgreSQLClient } from '../__mocks__/postgres-client.mock';
import { resetMockClient, getMockClient } from '../utils/test-helpers';
import { registerServiceInfoTool } from '../../src/tools/service-info';
import { toolSuccess } from '../../src/utils/tool-response';
import { VERSION } from '../../src/version';

// Mock the PostgreSQL client
vi.mock('../../src/postgres-client', () => ({
  PostgreSQLClient: MockPostgreSQLClient,
}));

// Mock the date utility function
vi.mock('../../src/utils/date', () => ({
  getTimezone: vi.fn().mockReturnValue('UTC'),
  initializeTimezone: vi.fn(),
}));

interface MockServer {
  registerTool: Mock;
}

describe('ServiceInfo Tool', () => {
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

  it('registers the service-info tool correctly', () => {
    // Call the registration function
    registerServiceInfoTool(mockServer as unknown as McpServer, mockClient);

    // Verify that registerTool was called with correct parameters
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'service-info',
      expect.objectContaining({
        title: 'Service Information',
        description: expect.stringContaining('Get PostgreSQL service information'),
        annotations: { readOnlyHint: true },
      }),
      expect.any(Function),
    );
  });

  it('returns service info when connected', async () => {
    // Mock client is connected
    mockClient.setConnected(true);
    vi.spyOn(mockClient, 'isReadonly').mockReturnValue(false);

    // Mock connection info
    const mockConnectionInfo = {
      isConnected: true,
    };

    vi.spyOn(mockClient, 'getConnectionInfo').mockReturnValue(mockConnectionInfo);

    // Get the registered tool function
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let toolFunction: any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockServer.registerTool = vi.fn().mockImplementation((_name: unknown, _config: unknown, func: any) => {
      toolFunction = func;
    });

    // Register the tool to get the function
    registerServiceInfoTool(mockServer as unknown as McpServer, mockClient);

    // Call the tool function
    const result = await toolFunction!();

    // Verify success response
    expect(result).toEqual(
      toolSuccess({
        name: 'postgres-mcp',
        isConnected: true,
        readonly: false,
        version: VERSION,
        timezone: 'UTC',
        poolSize: 1,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      }),
    );
  });

  it('returns service info with connection error when not connected', async () => {
    // Mock client is not connected
    mockClient.setConnected(false);

    // Mock connection info with error
    const mockConnectionInfo = {
      isConnected: false,
      connectionError: 'Connection failed',
    };

    vi.spyOn(mockClient, 'getConnectionInfo').mockReturnValue(mockConnectionInfo);

    // Get the registered tool function
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let toolFunction: any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockServer.registerTool = vi.fn().mockImplementation((_name: unknown, _config: unknown, func: any) => {
      toolFunction = func;
    });

    // Register the tool to get the function
    registerServiceInfoTool(mockServer as unknown as McpServer, mockClient);

    // Call the tool function
    const result = await toolFunction!();

    // Verify success response with error info
    expect(result).toEqual(
      toolSuccess({
        name: 'postgres-mcp',
        isConnected: false,
        readonly: false, // Default readonly value from mock
        version: VERSION,
        timezone: 'UTC',
        connectionError: 'Connection failed',
      }),
    );
  });

  it('returns service info with disconnect reason when not connected', async () => {
    // Mock client is not connected
    mockClient.setConnected(false);

    // Mock connection info with disconnect reason
    const mockConnectionInfo = {
      isConnected: false,
      disconnectReason: 'normal disconnect',
    };

    vi.spyOn(mockClient, 'getConnectionInfo').mockReturnValue(mockConnectionInfo);

    // Get the registered tool function
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let toolFunction: any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockServer.registerTool = vi.fn().mockImplementation((_name: unknown, _config: unknown, func: any) => {
      toolFunction = func;
    });

    // Register the tool to get the function
    registerServiceInfoTool(mockServer as unknown as McpServer, mockClient);

    // Call the tool function
    const result = await toolFunction!();

    // Verify success response with disconnect reason
    expect(result).toEqual(
      toolSuccess({
        name: 'postgres-mcp',
        isConnected: false,
        readonly: false, // Default readonly value from mock
        version: VERSION,
        timezone: 'UTC',
        disconnectReason: 'normal disconnect',
      }),
    );
  });

  it('returns service info with both disconnect reason and connection error when not connected', async () => {
    // Mock client is not connected
    mockClient.setConnected(false);

    // Mock connection info with both disconnect reason and connection error
    const mockConnectionInfo = {
      isConnected: false,
      disconnectReason: 'timeout',
      connectionError: 'Connection timeout error',
    };

    vi.spyOn(mockClient, 'getConnectionInfo').mockReturnValue(mockConnectionInfo);

    // Get the registered tool function
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let toolFunction: any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockServer.registerTool = vi.fn().mockImplementation((_name: unknown, _config: unknown, func: any) => {
      toolFunction = func;
    });

    // Register the tool to get the function
    registerServiceInfoTool(mockServer as unknown as McpServer, mockClient);

    // Call the tool function
    const result = await toolFunction!();

    // Verify success response with both disconnect reason and connection error
    expect(result).toEqual(
      toolSuccess({
        name: 'postgres-mcp',
        isConnected: false,
        readonly: false, // Default readonly value from mock
        version: VERSION,
        timezone: 'UTC',
        disconnectReason: 'timeout',
        connectionError: 'Connection timeout error',
      }),
    );
  });
});
