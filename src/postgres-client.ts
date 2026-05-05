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
  // Serializes connect/disconnect so two concurrent calls can't race creating
  // and overwriting `this.pool` (or call `pool.end()` twice on the same pool).
  private lifecyclePromise: Promise<void> = Promise.resolve();

  constructor(initialReadonlyMode: boolean = true) {
    this.readonlyMode = initialReadonlyMode;
  }

  isReadonly(): boolean {
    return this.readonlyMode;
  }

  async connect(readonlyMode: boolean = true, poolSize: number = 1, idleTimeoutMillis: number = 30000, connectionTimeoutMillis: number = 10000): Promise<void> {
    return this.runExclusive(() => this.doConnect(readonlyMode, poolSize, idleTimeoutMillis, connectionTimeoutMillis));
  }

  async disconnect(reason: string = "normal disconnect"): Promise<void> {
    return this.runExclusive(() => this.doDisconnect(reason));
  }

  /**
   * Promise returned by the most recent ongoing connect/disconnect (or a
   * resolved promise once nothing is in flight). Other call sites can `await`
   * it before doing work that requires a stable pool — e.g. ensuring an
   * auto-connect from the constructor finished before serving the first MCP
   * request.
   */
  async whenLifecycleSettled(): Promise<void> {
    await this.lifecyclePromise.catch(() => { /* swallow — caller checks isConnected */ });
  }

  private runExclusive(operation: () => Promise<void>): Promise<void> {
    const next = this.lifecyclePromise
      .catch(() => { /* previous failure shouldn't block subsequent attempts */ })
      .then(operation);

    this.lifecyclePromise = next;

    return next;
  }

  private async doConnect(readonlyMode: boolean, poolSize: number, idleTimeoutMillis: number, connectionTimeoutMillis: number): Promise<void> {
    const connString = process.env['POSTGRES_MCP_CONNECTION_STRING'];

    if (!connString) {
      throw new Error('Connection string is required. Please set POSTGRES_MCP_CONNECTION_STRING environment variable.');
    }

    if (this.isConnected && this.pool) {
      await this.doDisconnect('reconnect requested');
    }

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
    const pool = new Pool(poolConfig);

    pool.on('error', (error) => {
      if (this.isConnected) {
        this.isConnected = false;

        // Some pg/network errors include the raw connection string in their
        // message; redact it here so getConnectionInfo() / service-info don't
        // hand the password back to the MCP client.
        const message = error instanceof Error ? error.message : String(error);
        const redacted = new Error(redactConnectionString(message));

        if (error instanceof Error && error.stack) {
          redacted.stack = redactConnectionString(error.stack);
        }
        this.connectionError = redacted;
        this.disconnectReason = 'pool connection error';
      }
    });

    try {
      const client = await pool.connect();

      try {
        await client.query('SELECT 1');
      } finally {
        client.release();
      }

      this.pool = pool;
      this.poolSize = poolSize;
      this.idleTimeoutMillis = idleTimeoutMillis;
      this.connectionTimeoutMillis = connectionTimeoutMillis;
      this.connectionString = connString;
      this.isConnected = true;
      this.disconnectReason = null;
      this.connectionError = null;
    } catch (error) {
      // Close the pool we just created — otherwise its TCP sockets keep the
      // event loop alive and a retry would create a second pool, leaking the
      // first one.
      await pool.end().catch(() => { /* swallow shutdown errors */ });

      const message = error instanceof Error ? error.message : String(error);
      const redactedMessage = redactConnectionString(message);
      // Always store a redacted Error — getConnectionInfo() / service-info
      // surface this to the MCP client, and pg sometimes embeds the raw DSN
      // in `error.message`.
      const redactedError = new Error(redactedMessage);

      if (error instanceof Error && error.stack) {
        redactedError.stack = redactConnectionString(error.stack);
      }
      this.connectionError = redactedError;
      throw new Error(`Failed to connect to PostgreSQL: ${redactedMessage}`, { cause: error });
    }
  }

  private async doDisconnect(reason: string): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.isConnected = false;
      this.pool = null;
      this.connectionString = null;
      this.disconnectReason = reason;
      this.connectionError = null;
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
   * Stream query results using pg-query-stream. Uses async iteration so the
   * stream is naturally paused while `onRow` is awaited — without this, an
   * `async` data listener silently drops back-pressure and pg-query-stream
   * keeps emitting rows into a growing in-memory queue.
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
    const queryStream = new QueryStream(query, params ?? []);
    const stream = client.query(queryStream);

    try {
      // Same as executeQuery: readonly enforcement is at the session level.
      for await (const row of stream as AsyncIterable<Record<string, unknown>>) {
        await onRow(row);
      }
    } catch (error) {
      stream.destroy();
      throw error;
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
