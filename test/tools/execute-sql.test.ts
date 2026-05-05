import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockPostgreSQLClient } from '../__mocks__/postgres-client.mock';
import { resetMockClient, getMockClient, createMockServer, type MockServer } from '../utils/test-helpers';
import { registerExecuteSQLTool } from '../../src/tools/execute-sql';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { toolSuccess, toolError } from '../../src/utils/tool-response';
import { streamPostgresQueryToFile } from '../../src/utils/postgres-stream';
import { tmpdir } from 'os';
import { join } from 'path';

// Mock the PostgreSQL client
vi.mock('../../src/postgres-client', () => ({
  PostgreSQLClient: MockPostgreSQLClient,
}));

// Mock the postgres streaming utility
vi.mock('../../src/utils/postgres-stream', async (importOriginal) => {
  const actualModule = await importOriginal<typeof import('../../src/utils/postgres-stream')>();

  return {
    ...actualModule,
    streamPostgresQueryToFile: vi.fn(),
  };
});

// Define interface for Execute SQL tool parameters
interface ExecuteSQLTestParams {
  query: string;
  params?: unknown[];
  saveToFile?: boolean;
  filePath?: string;
  format?: 'jsonl' | 'json';
  forceSaveToFile?: boolean;
}

describe('Execute SQL Tool', () => {
 let mockServer: MockServer;
  let mockClient: ReturnType<typeof getMockClient>;

  beforeEach(() => {
    // Reset the mock client state
    resetMockClient();

    // Create mock server
    mockServer = createMockServer();
    mockClient = getMockClient();
  });

  it('registers the execute-sql tool correctly', () => {
    // Call the registration function
    registerExecuteSQLTool(mockServer as unknown as McpServer, mockClient);

    // Verify that registerTool was called with correct parameters
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'execute-sql',
      expect.objectContaining({
        title: 'Execute SQL Query',
        description: expect.stringContaining('Execute a custom SQL query against PostgreSQL'),
      }),
      expect.any(Function),
    );
  });

  it('executes SELECT query successfully and returns results', async () => {
    // Setup mock
    const mockResults = [
      { id: 1, name: 'John Doe' },
      { id: 2, name: 'Jane Smith' },
    ];

    mockClient.setExecuteQueryResult(mockResults);
    mockClient.setConnected(true);

    // Get the registered tool function
    let toolFunction: (params: ExecuteSQLTestParams) => Promise<unknown>;

    (mockServer.registerTool).mockImplementation((_name: unknown, _config: unknown, func: unknown) => {
      toolFunction = func as (params: ExecuteSQLTestParams) => Promise<unknown>;
    });

    // Register the tool function
    registerExecuteSQLTool(mockServer as unknown as McpServer, mockClient);

    // Call the tool function
    const result = await toolFunction!({
      query: 'SELECT * FROM users',
    });

    // Verify the result
    expect(result).toEqual(
      toolSuccess({
        query: 'SELECT * FROM users',
        records: mockResults,
        count: 2,
      }),
    );

    // No bind parameters were passed by the user, so the tool should call
    // executeQuery without a params array (lets pg use the simple-query path).
    expect(mockClient.executeQuery).toHaveBeenCalledWith('SELECT * FROM users', undefined);
  });

  it('executes query with parameters successfully', async () => {
    // Setup mock
    const mockResults = [
      { id: 1, name: 'John Doe' },
    ];

    mockClient.setExecuteQueryResult(mockResults);
    mockClient.setConnected(true);

    // Get the registered tool function
    let toolFunction: (params: ExecuteSQLTestParams) => Promise<unknown>;

    (mockServer.registerTool).mockImplementation((_name: unknown, _config: unknown, func: unknown) => {
      toolFunction = func as (params: ExecuteSQLTestParams) => Promise<unknown>;
    });

    // Register the tool function
    registerExecuteSQLTool(mockServer as unknown as McpServer, mockClient);

    // Call the tool function with parameters
    const result = await toolFunction!({
      query: 'SELECT * FROM users WHERE id = $1',
      params: [1],
    });

    // Verify the result
    expect(result).toEqual(
      toolSuccess({
        query: 'SELECT * FROM users WHERE id = $1',
        records: mockResults,
        count: 1,
      }),
    );

    // Verify that executeQuery was called with correct parameters
    expect(mockClient.executeQuery).toHaveBeenCalledWith('SELECT * FROM users WHERE id = $1', [1]);
  });

  it('returns error when not connected to PostgreSQL', async () => {
    // Setup mock to not be connected
    mockClient.setConnected(false);

    // Get the registered tool function
    let toolFunction: (params: ExecuteSQLTestParams) => Promise<unknown>;

    (mockServer.registerTool).mockImplementation((_name: unknown, _config: unknown, func: unknown) => {
      toolFunction = func as (params: ExecuteSQLTestParams) => Promise<unknown>;
    });

    // Register the tool function
    registerExecuteSQLTool(mockServer as unknown as McpServer, mockClient);

    // Call the tool function
    const result = await toolFunction!({
      query: 'SELECT * FROM users',
    });

    // Verify error response
    expect(result).toEqual(
      toolError(new Error('Not connected to PostgreSQL. Please connect first.')),
    );
  });

  it('returns error when in read-only mode and executing non-SELECT query (PostgreSQL prevents data modification)', async () => {
    // Setup mock
    const readOnlyError = new Error('cannot execute INSERT in a read-only transaction');

    readOnlyError.name = 'ReadOnlySqlTransactionError';

    mockClient.setConnected(true);
    mockClient.setExecuteQueryError(readOnlyError);
    vi.spyOn(mockClient, 'isReadonly').mockReturnValue(true);

    // Get the registered tool function
    let toolFunction: (params: ExecuteSQLTestParams) => Promise<unknown>;

    (mockServer.registerTool).mockImplementation((_name: unknown, _config: unknown, func: unknown) => {
      toolFunction = func as (params: ExecuteSQLTestParams) => Promise<unknown>;
    });

    // Register the tool function
    registerExecuteSQLTool(mockServer as unknown as McpServer, mockClient);

    // Call the tool function with non-SELECT query
    const result = await toolFunction!({
      query: 'INSERT INTO users (name) VALUES ($1)',
      params: ['John Doe'],
    });

    // Verify error response comes from PostgreSQL
    expect(result).toEqual(
      toolError(readOnlyError),
    );
  });

  it('handles query execution errors properly', async () => {
    // Setup mock
    const error = new Error('Database connection failed');

    mockClient.setExecuteQueryError(error);
    mockClient.setConnected(true);

    // Get the registered tool function
    let toolFunction: (params: ExecuteSQLTestParams) => Promise<unknown>;

    (mockServer.registerTool).mockImplementation((_name: unknown, _config: unknown, func: unknown) => {
      toolFunction = func as (params: ExecuteSQLTestParams) => Promise<unknown>;
    });

    // Register the tool function
    registerExecuteSQLTool(mockServer as unknown as McpServer, mockClient);

    // Call the tool function
    const result = await toolFunction!({
      query: 'SELECT * FROM users',
    });

    // Verify error response
    expect(result).toEqual(toolError(error));
  });

  it('saves query results to file when saveToFile is true', async () => {
    // Setup mock
    const mockResults = [
      { id: 1, name: 'John Doe' },
      { id: 2, name: 'Jane Smith' },
    ];

    mockClient.setExecuteQueryResult(mockResults);
    mockClient.setConnected(true);

    // Mock the streaming function
    // streamPostgresQueryToFile is auto-mocked via vi.mock at top of file
    const mockStreamFunction = vi.mocked(streamPostgresQueryToFile);
    const mockStreamResult = { filePath: '/tmp/test-output.json', count: 2 };

    mockStreamFunction.mockResolvedValue(mockStreamResult);

    // Get the registered tool function
    let toolFunction: (params: ExecuteSQLTestParams) => Promise<unknown>;

    (mockServer.registerTool).mockImplementation((_name: unknown, _config: unknown, func: unknown) => {
      toolFunction = func as (params: { query: string; params?: unknown[] }) => Promise<unknown>;
    });

    // Register the tool function
    registerExecuteSQLTool(mockServer as unknown as McpServer, mockClient);

    // Create a temporary file path
    const tempFilePath = join(tmpdir(), 'test-output.json');
    // Call the tool function with saveToFile
    const result = await toolFunction!({
      query: 'SELECT * FROM users',
      saveToFile: true,
      filePath: tempFilePath,
    });

    // Verify the result
    expect(result).toEqual(
      expect.objectContaining({
        content: [
          expect.objectContaining({
            type: 'text',
            text: expect.stringContaining('"savedToFile":true'),
          }),
        ],
      }),
    );

    // Parse the result to check specific content
    const resultText = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
    const parsedResult = JSON.parse(resultText);

    expect(parsedResult.payload).toEqual(
      expect.objectContaining({
        savedToFile: true,
        filePath: mockStreamResult.filePath,
        query: 'SELECT * FROM users',
        count: 2,
        format: 'jsonl',
      }),
    );

    // Verify that the streaming function was called with correct parameters
    expect(mockStreamFunction).toHaveBeenCalledWith(expect.any(Function), tempFilePath, 'jsonl');

    // Clean up
    mockStreamFunction.mockClear();
  });

  it('saves query results to file with jsonl format by default when saveToFile is true', async () => {
    // Setup mock
    const mockResults = [
      { id: 1, name: 'John Doe' },
    ];

    mockClient.setExecuteQueryResult(mockResults);
    mockClient.setConnected(true);

    // Mock the streaming function
    // streamPostgresQueryToFile is auto-mocked via vi.mock at top of file
    const mockStreamFunction = vi.mocked(streamPostgresQueryToFile);
    const mockStreamResult = { filePath: '/tmp/test-output.jsonl', count: 1 };

    mockStreamFunction.mockResolvedValue(mockStreamResult);

    // Get the registered tool function
    let toolFunction: (params: ExecuteSQLTestParams) => Promise<unknown>;

    (mockServer.registerTool).mockImplementation((_name: unknown, _config: unknown, func: unknown) => {
      toolFunction = func as (params: { query: string; params?: unknown[] }) => Promise<unknown>;
    });

    // Register the tool function
    registerExecuteSQLTool(mockServer as unknown as McpServer, mockClient);

    // Create a temporary file path
    const tempFilePath = join(tmpdir(), 'test-output.jsonl');
    // Call the tool function with saveToFile
    const result = await toolFunction!({
      query: 'SELECT * FROM users',
      saveToFile: true,
      filePath: tempFilePath,
      format: 'jsonl',
    });

    // Verify the result
    expect(result).toEqual(
      expect.objectContaining({
        content: [
          expect.objectContaining({
            type: 'text',
            text: expect.stringContaining('"savedToFile":true'),
          }),
        ],
      }),
    );

    // Parse the result to check specific content
    const resultText = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
    const parsedResult = JSON.parse(resultText);

    expect(parsedResult.payload).toEqual(
      expect.objectContaining({
        savedToFile: true,
        filePath: mockStreamResult.filePath,
        query: 'SELECT * FROM users',
        count: 1,
        format: 'jsonl',
      }),
    );

    // Verify that the streaming function was called with correct parameters
    expect(mockStreamFunction).toHaveBeenCalledWith(expect.any(Function), tempFilePath, 'jsonl');

    // Clean up
    mockStreamFunction.mockClear();
  });

  it('saves query results to file with json format when specified', async () => {
    // Setup mock
    const mockResults = [
      { id: 1, name: 'John Doe' },
    ];

    mockClient.setExecuteQueryResult(mockResults);
    mockClient.setConnected(true);

    // Mock the streaming function
    // streamPostgresQueryToFile is auto-mocked via vi.mock at top of file
    const mockStreamFunction = vi.mocked(streamPostgresQueryToFile);
    const mockStreamResult = { filePath: '/tmp/test-output.json', count: 1 };

    mockStreamFunction.mockResolvedValue(mockStreamResult);

    // Get the registered tool function
    let toolFunction: (params: ExecuteSQLTestParams) => Promise<unknown>;

    (mockServer.registerTool).mockImplementation((_name: unknown, _config: unknown, func: unknown) => {
      toolFunction = func as (params: { query: string; params?: unknown[] }) => Promise<unknown>;
    });

    // Register the tool function
    registerExecuteSQLTool(mockServer as unknown as McpServer, mockClient);

    // Create a temporary file path
    const tempFilePath = join(tmpdir(), 'test-output.json');
    // Call the tool function with saveToFile
    const result = await toolFunction!({
      query: 'SELECT * FROM users',
      saveToFile: true,
      filePath: tempFilePath,
      format: 'json',
    });

    // Verify the result
    expect(result).toEqual(
      expect.objectContaining({
        content: [
          expect.objectContaining({
            type: 'text',
            text: expect.stringContaining('"savedToFile":true'),
          }),
        ],
      }),
    );

    // Parse the result to check specific content
    const resultText = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
    const parsedResult = JSON.parse(resultText);

    expect(parsedResult.payload).toEqual(
      expect.objectContaining({
        savedToFile: true,
        filePath: mockStreamResult.filePath,
        query: 'SELECT * FROM users',
        count: 1,
        format: 'json',
      }),
    );

    // Verify that the streaming function was called with correct parameters
    expect(mockStreamFunction).toHaveBeenCalledWith(expect.any(Function), tempFilePath, 'json');

    // Clean up
    mockStreamFunction.mockClear();
  });

  it('passes plain object params through unchanged for JSON/JSONB (L10)', async () => {
    mockClient.setExecuteQueryResult([{ id: 1 }]);
    mockClient.setConnected(true);

    let toolFunction: (params: ExecuteSQLTestParams) => Promise<unknown>;

    (mockServer.registerTool).mockImplementation((_name: unknown, _config: unknown, func: unknown) => {
      toolFunction = func as (p: ExecuteSQLTestParams) => Promise<unknown>;
    });

    registerExecuteSQLTool(mockServer as unknown as McpServer, mockClient);

    const jsonParam = { foo: 'bar', nested: { ok: true } };

    await toolFunction!({
      query: 'SELECT $1::jsonb',
      params: [jsonParam],
    });

    expect(mockClient.executeQuery).toHaveBeenCalledWith('SELECT $1::jsonb', [jsonParam]);
  });

  it('passes array params through unchanged for ARRAY (L10)', async () => {
    mockClient.setExecuteQueryResult([{ id: 1 }]);
    mockClient.setConnected(true);

    let toolFunction: (params: ExecuteSQLTestParams) => Promise<unknown>;

    (mockServer.registerTool).mockImplementation((_name: unknown, _config: unknown, func: unknown) => {
      toolFunction = func as (p: ExecuteSQLTestParams) => Promise<unknown>;
    });

    registerExecuteSQLTool(mockServer as unknown as McpServer, mockClient);

    const arrayParam = [1, 2, 3];

    await toolFunction!({
      query: 'SELECT * FROM users WHERE id = ANY($1)',
      params: [arrayParam],
    });

    expect(mockClient.executeQuery).toHaveBeenCalledWith('SELECT * FROM users WHERE id = ANY($1)', [arrayParam]);
  });

  it('rejects non-serializable params (L10)', async () => {
    mockClient.setConnected(true);

    let toolFunction: (params: ExecuteSQLTestParams) => Promise<unknown>;

    (mockServer.registerTool).mockImplementation((_name: unknown, _config: unknown, func: unknown) => {
      toolFunction = func as (p: ExecuteSQLTestParams) => Promise<unknown>;
    });

    registerExecuteSQLTool(mockServer as unknown as McpServer, mockClient);

    const result = (await toolFunction!({
      query: 'SELECT $1',
      params: [() => 42],
    })) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('not serializable');
  });

  it('handles file operation errors during saveToFile', async () => {
    // Setup mock
    const mockResults = [
      { id: 1, name: 'John Doe' },
    ];

    mockClient.setExecuteQueryResult(mockResults);
    mockClient.setConnected(true);

    // Mock the streaming function to throw an error
    // streamPostgresQueryToFile is auto-mocked via vi.mock at top of file
    const mockStreamFunction = vi.mocked(streamPostgresQueryToFile);
    const error = new Error('Permission denied');

    mockStreamFunction.mockRejectedValue(error);

    // Get the registered tool function
    let toolFunction: (params: ExecuteSQLTestParams) => Promise<unknown>;

    (mockServer.registerTool).mockImplementation((_name: unknown, _config: unknown, func: unknown) => {
      toolFunction = func as (params: { query: string; params?: unknown[] }) => Promise<unknown>;
    });

    // Register the tool function
    registerExecuteSQLTool(mockServer as unknown as McpServer, mockClient);

    // Call the tool function with saveToFile (use a tmpdir-internal path to
    // pass safe-path validation; the mocked stream function will then throw)
    const result = await toolFunction!({
      query: 'SELECT * FROM users',
      saveToFile: true,
      filePath: join(tmpdir(), 'execute-sql-error-test.json'),
    });

    // Should return an error since streaming function failed
    expect(result).toEqual(
      expect.objectContaining({
        isError: true,
        content: [
          expect.objectContaining({
            type: 'text',
            text: expect.stringContaining('Permission denied'),
          }),
        ],
      }),
    );

    // Clean up
    mockStreamFunction.mockClear();
  });
});
