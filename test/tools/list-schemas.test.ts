import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MockPostgreSQLClient } from '../__mocks__/postgres-client.mock';
import { resetMockClient, getMockClient } from '../utils/test-helpers';
import { registerListSchemasTool } from '../../src/tools/list-schemas';
import { toolSuccess, toolError } from '../../src/utils/tool-response';

// Mock the PostgreSQL client
jest.mock('../../src/postgres-client', () => ({
  PostgreSQLClient: MockPostgreSQLClient,
}));

interface MockServer {
  registerTool: jest.Mock;
}

describe('ListSchemas Tool', () => {
  let mockServer: MockServer;
  let mockClient: ReturnType<typeof getMockClient>;

  beforeEach(() => {
    // Reset the mock client state
    resetMockClient();

    // Create mock server
    mockServer = {
      registerTool: jest.fn(),
    };

    mockClient = getMockClient();
  });

  it('registers the list-schemas tool correctly', () => {
    // Call the registration function
    registerListSchemasTool(mockServer as unknown as McpServer, mockClient);

    // Verify that registerTool was called with correct parameters
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'list-schemas',
      expect.objectContaining({
        title: 'List Schemas',
        description: expect.stringContaining('List all schemas'),
        annotations: { readOnlyHint: true },
      }),
      expect.any(Function),
    );
  });

  it('lists schemas successfully when connected', async () => {
    // Mock client is connected
    mockClient.setConnected(true);

    // Mock the query result
    const mockSchemas = [
      { schema_name: 'public' },
      { schema_name: 'myschema' },
      { schema_name: 'anotherschema' },
    ];

    mockClient.setExecuteQueryResult(mockSchemas);

    // Get the registered tool function
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let toolFunction: any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockServer.registerTool = jest.fn().mockImplementation((name: unknown, config: unknown, func: any) => {
      toolFunction = func;
    });

    // Register the tool to get the function
    registerListSchemasTool(mockServer as unknown as McpServer, mockClient);

    // Call the tool function
    const result = await toolFunction!();

    // Verify success response
    expect(result).toEqual(
      toolSuccess({
        schemas: ['public', 'myschema', 'anotherschema'],
        count: 3,
      }),
    );
  });

  it('returns error when not connected to PostgreSQL', async () => {
    // Mock client is not connected
    mockClient.setConnected(false);

    // Get the registered tool function
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let toolFunction: any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockServer.registerTool = jest.fn().mockImplementation((name: unknown, config: unknown, func: any) => {
      toolFunction = func;
    });

    // Register the tool to get the function
    registerListSchemasTool(mockServer as unknown as McpServer, mockClient);

    // Call the tool function
    const result = await toolFunction!();

    // Verify error response
    expect(result).toEqual(
      toolError(new Error('Not connected to PostgreSQL. Please connect first.')),
    );
  });

  it('handles query errors properly', async () => {
    // Mock client is connected
    mockClient.setConnected(true);

    // Mock the query to throw an error
    const queryError = new Error('Failed to query schemas');

    mockClient.setExecuteQueryError(queryError);

    // Get the registered tool function
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let toolFunction: any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockServer.registerTool = jest.fn().mockImplementation((name: unknown, config: unknown, func: any) => {
      toolFunction = func;
    });

    // Register the tool to get the function
    registerListSchemasTool(mockServer as unknown as McpServer, mockClient);

    // Call the tool function
    const result = await toolFunction!();

    // Verify error response
    expect(result).toEqual(toolError(queryError));
  });
});
