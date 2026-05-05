import { vi } from 'vitest';

class MockPostgreSQLClientClass {
  private executeQueryResult: Array<Record<string, unknown>> = [];
  private executeQueryError: Error | null = null;
  private mockReadonlyMode: boolean = false;
  private mockIsConnected: boolean = false;
  private mockConnectionError: Error | null = null;
  private mockDisconnectReason: string | null = null;
  private mockConnectionString: string | null = null;
  private mockPool: { connect: () => Promise<{ query: (query: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>; release: () => void }> } | null = null;
  private mockPoolSize: number = 1;
  private mockIdleTimeoutMillis: number = 30000;
  private mockConnectionTimeoutMillis: number = 10000;

  constructor(initialReadonlyMode: boolean = false) {
    this.mockReadonlyMode = initialReadonlyMode;
    this.mockPool = { connect: () => Promise.resolve({ query: (_query: string, _params?: unknown[]) => Promise.resolve({ rows: [] }), release() {} }) };
  }

  connect = vi.fn().mockImplementation(async (readonlyMode: boolean = true, poolSize: number = 1, idleTimeout: number = 30000, connectionTimeout: number = 10000): Promise<void> => {
    this.mockReadonlyMode = readonlyMode;
    this.mockIsConnected = true;
    this.mockDisconnectReason = null;
    this.mockConnectionError = null;
    this.mockPoolSize = poolSize;
    this.mockIdleTimeoutMillis = idleTimeout;
    this.mockConnectionTimeoutMillis = connectionTimeout;
    // Simulate a simple pool object
    this.mockPool = { connect: () => Promise.resolve({ query: (_query: string, _params?: unknown[]) => Promise.resolve({ rows: [] }), release() {} }) };
  });

  disconnect = vi.fn().mockImplementation(async (reason: string = "normal disconnect"): Promise<void> => {
    this.mockIsConnected = false;
    this.mockPool = null;
    this.mockConnectionString = null;
    this.mockDisconnectReason = reason;
    this.mockConnectionError = null;
  });

  isReadonly = vi.fn().mockImplementation((): boolean => {
    return this.mockReadonlyMode;
  });

  setConnected = vi.fn().mockImplementation((connected: boolean): void => {
    this.mockIsConnected = connected;
  });

  setExecuteQueryResult = vi.fn().mockImplementation((result: Array<Record<string, unknown>>): void => {
    this.executeQueryResult = result;
  });

  setExecuteQueryError = vi.fn().mockImplementation((error: Error | null): void => {
    this.executeQueryError = error;
  });

  executeQuery = vi.fn().mockImplementation(async <T>(_query: string, _params?: unknown[]): Promise<T[]> => {
    if (this.executeQueryError) {
      throw this.executeQueryError;
    }

    return this.executeQueryResult as T[];
  });

  streamQuery = vi.fn().mockImplementation(async (
    _query: string,
    _params: unknown[] | undefined,
    onRow: (row: Record<string, unknown>) => void | Promise<void>,
  ): Promise<void> => {
    if (this.executeQueryError) {
      throw this.executeQueryError;
    }
    for (const row of this.executeQueryResult) {
      await onRow(row);
    }
  });

  whenLifecycleSettled = vi.fn().mockImplementation(async (): Promise<void> => {
    return Promise.resolve();
  });

  isConnectedToPostgreSQL = vi.fn().mockImplementation((): boolean => {
    return this.mockIsConnected;
  });

  getConnectionInfo = vi.fn().mockImplementation((): { isConnected: boolean; disconnectReason?: string; connectionError?: string } => {
    const info: { isConnected: boolean; disconnectReason?: string; connectionError?: string } = {
      isConnected: this.mockIsConnected,
    };

    if (!this.mockIsConnected && this.mockDisconnectReason) {
      info.disconnectReason = this.mockDisconnectReason;
    }

    if (this.mockConnectionError) {
      info.connectionError = this.mockConnectionError.message;
    }

    return info;
  });

  getConnectionString = vi.fn().mockImplementation((): string | null => {
    // Return a mock connection string for testing
    return this.mockConnectionString ?? 'postgresql://test:test@localhost:5432/test';
  });

  getPool = vi.fn().mockImplementation(() => {
    if (!(this.mockIsConnected && this.mockPool)) {
      this.mockConnectionError ??= new Error('Not connected to PostgreSQL. Please connect first.');
      throw this.mockConnectionError;
    }

    return this.mockPool;
  });

  getPoolSize = vi.fn().mockImplementation((): number => {
    return this.mockPoolSize;
  });

  getIdleTimeoutMillis = vi.fn().mockImplementation((): number => {
    return this.mockIdleTimeoutMillis;
  });

  getConnectionTimeoutMillis = vi.fn().mockImplementation((): number => {
    return this.mockConnectionTimeoutMillis;
  });
}

// Export the class directly as the mock constructor.
// vitest's `vi.fn().mockImplementation(() => new Class())` cannot be invoked
// via `new`, so we expose the class itself.
export const MockPostgreSQLClient = MockPostgreSQLClientClass;

// Maintain a singleton instance for testing purposes
let mockInstance: InstanceType<typeof MockPostgreSQLClient> | null = null;

// Create a getInstance function that returns one singleton mock instance
export const MockPostgreSQLClientInstance = {
  getInstance: vi.fn((): InstanceType<typeof MockPostgreSQLClient> => {
    mockInstance ??= new MockPostgreSQLClient();

    return mockInstance;
  }),
  resetInstance(): void {
    mockInstance = null;
  },
};

// Add a static getInstance method to the MockPostgreSQLClient itself
(MockPostgreSQLClient as typeof MockPostgreSQLClient & { getInstance: () => InstanceType<typeof MockPostgreSQLClientClass> }).getInstance = MockPostgreSQLClientInstance.getInstance;
