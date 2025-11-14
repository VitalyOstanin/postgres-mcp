class MockPostgreSQLClientClass {
  private executeQueryResult: Array<Record<string, unknown>> = [];
  private executeQueryError: Error | null = null;
  private mockReadonlyMode: boolean = false;
  private mockIsConnected: boolean = false;
  private mockConnectionError: Error | null = null;
  private mockDisconnectReason: string | null = null;
  private mockConnectionString: string | null = null;
  private mockPool: { connect: () => Promise<{ query: (query: string, params?: Array<string | number | boolean | null>) => Promise<{ rows: Array<Record<string, unknown>> }>; release: () => void }> } | null = null;
  private mockPoolSize: number = 1;
  private mockIdleTimeoutMillis: number = 30000;
  private mockConnectionTimeoutMillis: number = 10000;

  constructor() {
    // Initialize mock values
    this.mockPool = { connect: () => Promise.resolve({ query: (_query: string, _params?: Array<string | number | boolean | null>) => Promise.resolve({ rows: [] }), release() {} }) };
  }

  connect = jest.fn().mockImplementation(async (readonlyMode: boolean = true, poolSize: number = 1, idleTimeout: number = 30000, connectionTimeout: number = 10000): Promise<void> => {
    this.mockReadonlyMode = readonlyMode;
    this.mockIsConnected = true;
    this.mockDisconnectReason = null;
    this.mockConnectionError = null;
    this.mockPoolSize = poolSize;
    this.mockIdleTimeoutMillis = idleTimeout;
    this.mockConnectionTimeoutMillis = connectionTimeout;
    // Simulate a simple pool object
    this.mockPool = { connect: () => Promise.resolve({ query: (_query: string, _params?: Array<string | number | boolean | null>) => Promise.resolve({ rows: [] }), release() {} }) };
  });

  disconnect = jest.fn().mockImplementation(async (reason: string = "normal disconnect"): Promise<void> => {
    this.mockIsConnected = false;
    this.mockPool = null;
    this.mockConnectionString = null;
    this.mockDisconnectReason = reason;
    this.mockConnectionError = null;
  });

  setReadonlyMode = jest.fn().mockImplementation((readonly: boolean): void => {
    this.mockReadonlyMode = readonly;
  });

  isReadonly = jest.fn().mockImplementation((): boolean => {
    return this.mockReadonlyMode;
  });

  setConnected = jest.fn().mockImplementation((connected: boolean): void => {
    this.mockIsConnected = connected;
  });

  setExecuteQueryResult = jest.fn().mockImplementation((result: Array<Record<string, unknown>>): void => {
    this.executeQueryResult = result;
  });

  setExecuteQueryError = jest.fn().mockImplementation((error: Error | null): void => {
    this.executeQueryError = error;
  });

  executeQuery = jest.fn().mockImplementation(async <T>(_query: string, _params?: Array<string | number | boolean | Date | null>): Promise<T[]> => {
    if (this.executeQueryError) {
      throw this.executeQueryError;
    }

    return this.executeQueryResult as T[];
  });

  isConnectedToPostgreSQL = jest.fn().mockImplementation((): boolean => {
    return this.mockIsConnected;
  });

  getConnectionInfo = jest.fn().mockImplementation((): { isConnected: boolean; disconnectReason?: string; connectionError?: string } => {
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

  getConnectionString = jest.fn().mockImplementation((): string | null => {
    // Return a mock connection string for testing
    return this.mockConnectionString ?? 'postgresql://test:test@localhost:5432/test';
  });

  getPool = jest.fn().mockImplementation(() => {
    if (!(this.mockIsConnected && this.mockPool)) {
      this.mockConnectionError ??= new Error('Not connected to PostgreSQL. Please connect first.');
      throw this.mockConnectionError;
    }

    return this.mockPool;
  });

  getPoolSize = jest.fn().mockImplementation((): number => {
    return this.mockPoolSize;
  });

  getIdleTimeoutMillis = jest.fn().mockImplementation((): number => {
    return this.mockIdleTimeoutMillis;
  });

  getConnectionTimeoutMillis = jest.fn().mockImplementation((): number => {
    return this.mockConnectionTimeoutMillis;
  });
}

// Create a type-compatible mock object
export const MockPostgreSQLClient = jest.fn().mockImplementation(() => new MockPostgreSQLClientClass());

// Maintain a singleton instance for testing purposes
let mockInstance: InstanceType<typeof MockPostgreSQLClient> | null = null;

// Create a getInstance function that returns one singleton mock instance
export const MockPostgreSQLClientInstance = {
  getInstance: jest.fn((): InstanceType<typeof MockPostgreSQLClient> => {
    mockInstance ??= new MockPostgreSQLClient();

    return mockInstance;
  }),
  resetInstance(): void {
    mockInstance = null;
  },
};

// Add a static getInstance method to the MockPostgreSQLClient itself
(MockPostgreSQLClient as typeof MockPostgreSQLClient & { getInstance: () => InstanceType<typeof MockPostgreSQLClientClass> }).getInstance = MockPostgreSQLClientInstance.getInstance;
