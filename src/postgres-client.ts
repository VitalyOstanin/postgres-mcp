import { Pool, type PoolConfig } from 'pg';
import QueryStream from 'pg-query-stream';
import { redactConnectionString } from './utils/redact.js';

export class PostgreSQLClient {
  private pool: Pool | null = null;
  private isConnected: boolean = false;
  private connectionString: string | null = null;
  private readonlyMode: boolean = false;
  private disconnectReason: string | null = null;
  private connectionError: Error | null = null;
  private poolSize: number = 1;
  private idleTimeoutMillis: number = 30000;
  private connectionTimeoutMillis: number = 10000;

  /**
   * Set the readonly flag for subsequent connections. Note: changing this
   * after `connect()` has run does NOT take effect until you reconnect — the
   * setting is applied to the underlying pool's `options` startup parameter.
   */
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
      // Apply readonly mode at the session level via the PostgreSQL `options`
      // startup parameter. This runs once when each pooled connection is
      // established, so no per-query BEGIN/SET/COMMIT round-trip is needed.
      // Any explicit transaction the user opens will inherit the read-only
      // default. Switching readonly mode at runtime requires a reconnect.
      this.readonlyMode = readonlyMode;

      const poolConfig: PoolConfig = {
        connectionString: connString,
        max: poolSize,
        idleTimeoutMillis,
        connectionTimeoutMillis,
        ...(readonlyMode ? { options: '-c default_transaction_read_only=on' } : {}),
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.connectionError = error instanceof Error ? error : new Error(redactConnectionString(message));
      throw new Error(`Failed to connect to PostgreSQL: ${redactConnectionString(message)}`);
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

  private ensureConnected(): Pool {
    if (!this.isConnected || !this.pool) {
      this.connectionError ??= new Error('Not connected to PostgreSQL. Please connect first.');
      throw this.connectionError;
    }

    return this.pool;
  }

  getPool(): Pool {
    return this.ensureConnected();
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

  async executeQuery<T>(query: string, params?: unknown[]): Promise<T[]> {
    const pool = this.ensureConnected();
    const client = await pool.connect();

    try {
      // Read-only enforcement is applied at session level via the pool's
      // `options` startup parameter (see connect()). Any data-modifying
      // statement run on a read-only session fails with PostgreSQL error
      // 25006 (read_only_sql_transaction).
      const result = await client.query(query, params);

      return result.rows as T[];
    } finally {
      client.release();
    }
  }

  /**
   * Stream query results using pg-query-stream to avoid memory accumulation
   */
  async streamQuery(
    query: string,
    params?: unknown[],
    onRow?: (row: Record<string, unknown>) => void | Promise<void>,
  ): Promise<void> {
    if (!onRow) {
      throw new Error('onRow callback is required');
    }

    const pool = this.ensureConnected();
    const client = await pool.connect();
    const runStream = async (): Promise<void> => {
      const queryStream = new QueryStream(query, params ?? []);

      await new Promise<void>((resolve, reject) => {
        const stream = client.query(queryStream);

        stream.on('data', async (row: Record<string, unknown>) => {
          try {
            await onRow(row);
          } catch (error) {
            reject(error);
            stream.destroy(); // Stop the stream on error
          }
        });

        stream.on('end', () => { resolve(); });
        stream.on('error', (error) => { reject(error); });
      });
    };

    try {
      // Same as executeQuery: readonly enforcement is at the session level.
      await runStream();
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
