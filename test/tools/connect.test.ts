import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MockPostgreSQLClient } from '../__mocks__/postgres-client.mock';
import { resetMockClient, getMockClient } from '../utils/test-helpers';
import { registerConnectTool } from '../../src/tools/connect';
import { toolSuccess, toolError } from '../../src/utils/tool-response';

// Mock the PostgreSQL client
vi.mock('../../src/postgres-client', () => ({
  PostgreSQLClient: MockPostgreSQLClient,
  getMockPostgreSQLClient: () => new MockPostgreSQLClient(),
}));

// Mock the environment variable
const mockEnv = {
  POSTGRES_MCP_CONNECTION_STRING: 'postgresql://test:test@localhost:5432/test',
};

describe('Connect Tool', () => {
  interface MockServer {
    registerTool: Mock;
  }

  const defaults = {
    readonlyMode: true,
    poolSize: 1,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  };
  let mockServer: MockServer;
  let mockClient: ReturnType<typeof getMockClient>;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Snapshot the original env, then patch with the mock keys.
    originalEnv = { ...process.env };
    process.env = { ...process.env, ...mockEnv };

    // Reset the mock client state
    resetMockClient();

    // Create mock server
    mockServer = {
      registerTool: vi.fn(),
    };

    mockClient = getMockClient();
  });

  afterEach(() => {
    // Restore the env snapshot taken in beforeEach.
    process.env = originalEnv;
  });

  it('registers the connect tool correctly', () => {
    // Call the registration function
    registerConnectTool(mockServer as unknown as McpServer, mockClient, defaults);

    // Verify that registerTool was called with correct parameters
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'connect',
      expect.objectContaining({
        title: 'Connect to PostgreSQL',
        description: expect.stringContaining('Establish connection to PostgreSQL'),
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

  it('connects successfully when not already connected', async () => {
    // Get the instance that will be used by the tool
    const instance = getMockClient();

    instance.setConnected(false);

    // Get the registered tool function
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let toolFunction: any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockServer.registerTool = vi.fn().mockImplementation((_name: unknown, _config: unknown, func: any) => {
      toolFunction = func;
    });

    // Register the tool function
    registerConnectTool(mockServer as unknown as McpServer, instance, defaults);

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

  it('returns success when already connected with the same connection string and settings', async () => {
    // Get the instance that will be used by the tool
    const instance = getMockClient();

    instance.setConnected(true);

    // The tool now compares the full settings tuple before short-circuiting,
    // so every getter must report the value the tool is about to ask for —
    // otherwise the tool would (correctly) decide that something drifted and
    // reconnect.
    vi.spyOn(instance, 'getConnectionInfo').mockReturnValue({ isConnected: true });
    vi.spyOn(instance, 'getConnectionString').mockReturnValue(mockEnv.POSTGRES_MCP_CONNECTION_STRING);
    vi.spyOn(instance, 'isReadonly').mockReturnValue(defaults.readonlyMode);
    vi.spyOn(instance, 'getPoolSize').mockReturnValue(defaults.poolSize);
    vi.spyOn(instance, 'getIdleTimeoutMillis').mockReturnValue(defaults.idleTimeoutMillis);
    vi.spyOn(instance, 'getConnectionTimeoutMillis').mockReturnValue(defaults.connectionTimeoutMillis);

    // Get the registered tool function
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let toolFunction: any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockServer.registerTool = vi.fn().mockImplementation((_name: unknown, _config: unknown, func: any) => {
      toolFunction = func;
    });

    // Register the tool function
    registerConnectTool(mockServer as unknown as McpServer, instance, defaults);

    // Call the tool function
    const result = await toolFunction!({}, {});

    expect(result).toEqual(
      toolSuccess({
        success: true,
        message: 'Already connected to PostgreSQL with the same connection string and settings',
        isConnected: true,
      }),
    );
    // Settings already matched, so the tool must NOT have reopened the pool.
    expect(instance.connect).not.toHaveBeenCalled();
  });

  it('reconnects when readonly setting differs from the current pool', async () => {
    const instance = getMockClient();

    instance.setConnected(true);
    vi.spyOn(instance, 'getConnectionInfo').mockReturnValue({ isConnected: true });
    vi.spyOn(instance, 'getConnectionString').mockReturnValue(mockEnv.POSTGRES_MCP_CONNECTION_STRING);
    // Readonly drift: client is currently read-write, defaults ask for read-only.
    vi.spyOn(instance, 'isReadonly').mockReturnValue(false);
    vi.spyOn(instance, 'getPoolSize').mockReturnValue(defaults.poolSize);
    vi.spyOn(instance, 'getIdleTimeoutMillis').mockReturnValue(defaults.idleTimeoutMillis);
    vi.spyOn(instance, 'getConnectionTimeoutMillis').mockReturnValue(defaults.connectionTimeoutMillis);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let toolFunction: any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockServer.registerTool = vi.fn().mockImplementation((_name: unknown, _config: unknown, func: any) => {
      toolFunction = func;
    });
    registerConnectTool(mockServer as unknown as McpServer, instance, defaults);

    const result = await toolFunction!({}, {});

    expect(result).toEqual(
      toolSuccess({
        success: true,
        message: 'Connected to PostgreSQL successfully using POSTGRES_MCP_CONNECTION_STRING environment variable',
        isConnected: true,
      }),
    );
    expect(instance.connect).toHaveBeenCalledOnce();
    expect(instance.connect).toHaveBeenCalledWith(
      defaults.readonlyMode,
      defaults.poolSize,
      defaults.idleTimeoutMillis,
      defaults.connectionTimeoutMillis,
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
    mockServer.registerTool = vi.fn().mockImplementation((_name: unknown, _config: unknown, func: any) => {
      toolFunction = func;
    });

    // Register the tool function
    registerConnectTool(mockServer as unknown as McpServer, instance, defaults);

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

    vi.spyOn(mockInstance, 'connect').mockRejectedValue(connectionError);

    // Get the registered tool function
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let toolFunction: any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockServer.registerTool = vi.fn().mockImplementation((_name: unknown, _config: unknown, func: any) => {
      toolFunction = func;
    });

    // Register the tool to get the function
    registerConnectTool(mockServer as unknown as McpServer, mockInstance, defaults);

    // Call the tool function
    const result = await toolFunction!({}, {});

    // Verify error response
    expect(result).toEqual(toolError(connectionError));
  });
});
