import { Pool, type PoolConfig } from 'pg';
import QueryStream from 'pg-query-stream';

export class PostgreSQLClient {
  private static instance: PostgreSQLClient;
  private pool: Pool | null = null;
  private isConnected: boolean = false;
  private connectionString: string | null = null;
  private readonlyMode: boolean = false;
  private disconnectReason: string | null = null;
  private connectionError: Error | null = null;
  private poolSize: number = 1;
  private idleTimeoutMillis: number = 30000;
  private connectionTimeoutMillis: number = 10000;

  private constructor() {}

  static getInstance(): PostgreSQLClient {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!PostgreSQLClient.instance) {
      PostgreSQLClient.instance = new PostgreSQLClient();
    }

    return PostgreSQLClient.instance;
  }

  setReadonlyMode(readonly: boolean): void {
    this.readonlyMode = readonly;
  }

  isReadonly(): boolean {
    return this.readonlyMode;
  }

  async connect(readonlyMode: boolean = true, poolSize: number = 1, idleTimeoutMillis: number = 30000, connectionTimeoutMillis: number = 10000): Promise<void> {
    // Only use connection string from environment variable
    const connString = process.env['POSTGRES_MCP_CONNECTION_STRING'];

    if (!connString) {
      throw new Error('Connection string is required. Please set POSTGRES_MCP_CONNECTION_STRING environment variable.');
    }

    if (this.isConnected && this.pool) {
      // If already connected, disconnect before new connection
      await this.disconnect();
    }

    try {
      const poolConfig: PoolConfig = {
        connectionString: connString,
        max: poolSize,
        idleTimeoutMillis,
        connectionTimeoutMillis,
        // Additional pool configuration options can be added here
      };

      this.pool = new Pool(poolConfig);
      this.poolSize = poolSize;
      this.idleTimeoutMillis = idleTimeoutMillis;
      this.connectionTimeoutMillis = connectionTimeoutMillis;

      // Add event listeners to detect connection issues
      this.pool.on('error', (error) => {
        // General connection error
        if (this.isConnected) {
          this.isConnected = false;
          this.connectionError = error instanceof Error ? error : new Error(String(error));
          this.disconnectReason = 'pool connection error';
        }
      });

      // Test the connection
      const client = await this.pool.connect();

      await client.query('SELECT 1');
      client.release();

      this.connectionString = connString;
      this.isConnected = true;
      this.disconnectReason = null; // Clear disconnect reason on successful connection
      this.connectionError = null; // Clear any previous connection error
      this.setReadonlyMode(readonlyMode);
    } catch (error) {
      this.connectionError = error instanceof Error ? error : new Error(String(error));
      throw new Error(`Failed to connect to PostgreSQL: ${error}`);
    }
  }

  async disconnect(reason: string = "normal disconnect"): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.isConnected = false;
      this.pool = null;
      this.connectionString = null;
      this.disconnectReason = reason;
      this.connectionError = null; // Clear any error when disconnecting intentionally
    }
  }

  private ensureConnected(): void {
    if (!(this.isConnected && this.pool)) {
      this.connectionError ??= new Error('Not connected to PostgreSQL. Please connect first.');
      throw this.connectionError;
    }
  }

  getPool(): Pool {
    this.ensureConnected();

    return this.pool!;
  }

  getPoolSize(): number {
    return this.poolSize;
  }

  getIdleTimeoutMillis(): number {
    return this.idleTimeoutMillis;
  }

  getConnectionTimeoutMillis(): number {
    return this.connectionTimeoutMillis;
  }

  async executeQuery<T>(query: string, params?: Array<string | number | boolean | Date | null>): Promise<T[]> {
    this.ensureConnected();

    const client = await this.pool!.connect();

    try {
      // In readonly mode, run the query inside a readonly transaction
      // PostgreSQL's READ ONLY transaction mode prevents data-modifying operations
      if (this.readonlyMode) {
        // Begin transaction
        await client.query('BEGIN');
        // Set transaction as readonly - this ensures no data modification is allowed
        // within this transaction (INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, etc.)
        await client.query('SET TRANSACTION READ ONLY');

        // Execute the query
        const result = await client.query(query, params);

        // End transaction
        await client.query('COMMIT');

        return result.rows as T[];
      } else {
        // Execute the query directly in read-write mode
        const result = await client.query(query, params);

        return result.rows as T[];
      }
    } finally {
      client.release();
    }
  }

  /**
   * Stream query results using pg-query-stream to avoid memory accumulation
   */
  async streamQuery(
    query: string,
    params?: Array<string | number | boolean | Date | null>,
    onRow?: (row: Record<string, unknown>) => void | Promise<void>,
  ): Promise<void> {
    if (!onRow) {
      throw new Error('onRow callback is required');
    }
    this.ensureConnected();

    const client = await this.pool!.connect();

    try {
      if (this.readonlyMode) {
        // Begin transaction
        await client.query('BEGIN');
        // Set transaction as readonly
        await client.query('SET TRANSACTION READ ONLY');

        // Create a query stream
        const queryStream = new QueryStream(query, params ?? []);
        // Create a promise to handle the completion of the stream
        const streamPromise = new Promise<void>((resolve, reject) => {
          const stream = client.query(queryStream);

          stream.on('data', async (row: Record<string, unknown>) => {
            try {
              await onRow(row);
            } catch (error) {
              reject(error);
              stream.destroy(); // Stop the stream on error
            }
          });

          stream.on('end', () => {
            resolve();
          });

          stream.on('error', (error) => {
            reject(error);
          });
        });

        await streamPromise;

        // End transaction
        await client.query('COMMIT');
      } else {
        // Create a query stream in read-write mode
        const queryStream = new QueryStream(query, params ?? []);
        // Create a promise to handle the completion of the stream
        const streamPromise = new Promise<void>((resolve, reject) => {
          const stream = client.query(queryStream);

          stream.on('data', async (row: Record<string, unknown>) => {
            try {
              await onRow(row);
            } catch (error) {
              reject(error);
              stream.destroy(); // Stop the stream on error
            }
          });

          stream.on('end', () => {
            resolve();
          });

          stream.on('error', (error) => {
            reject(error);
          });
        });

        await streamPromise;
      }
    } finally {
      client.release();
    }
  }

  isConnectedToPostgreSQL(): boolean {
    return this.isConnected;
  }

  getConnectionInfo(): { isConnected: boolean; disconnectReason?: string; connectionError?: string } {
    const info: { isConnected: boolean; disconnectReason?: string; connectionError?: string } = {
      isConnected: this.isConnected,
    };

    if (!this.isConnected && this.disconnectReason) {
      info.disconnectReason = this.disconnectReason;
    }

    if (this.connectionError) {
      info.connectionError = this.connectionError.message;
    }

    return info;
  }

  getConnectionString(): string | null {
    return this.connectionString;
  }
}
