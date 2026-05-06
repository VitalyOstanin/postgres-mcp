import { Pool, type PoolConfig } from 'pg';
import QueryStream from 'pg-query-stream';
import { redactConnectionString } from './utils/redact.js';
import {
  DEFAULT_CONNECTION_TIMEOUT_MS,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_POOL_SIZE,
  DEFAULT_READONLY_MODE,
} from './defaults.js';
import { CONNECTION_STRING_REQUIRED_MESSAGE } from './utils/connection-messages.js';

export class PostgreSQLClient {
  private pool: Pool | null = null;
  private isConnected = false;
  private connectionString: string | null = null;
  private readonlyMode = DEFAULT_READONLY_MODE;
  private disconnectReason: string | null = null;
  private connectionError: Error | null = null;
  private poolSize = DEFAULT_POOL_SIZE;
  private idleTimeoutMillis = DEFAULT_IDLE_TIMEOUT_MS;
  private connectionTimeoutMillis = DEFAULT_CONNECTION_TIMEOUT_MS;
  // Serializes connect/disconnect so two concurrent calls can't race creating
  // and overwriting `this.pool` (or call `pool.end()` twice on the same pool).
  private lifecyclePromise: Promise<void> = Promise.resolve();

  constructor(initialReadonlyMode: boolean = DEFAULT_READONLY_MODE) {
    this.readonlyMode = initialReadonlyMode;
  }

  isReadonly(): boolean {
    return this.readonlyMode;
  }

  async connect(
    readonlyMode: boolean = DEFAULT_READONLY_MODE,
    poolSize: number = DEFAULT_POOL_SIZE,
    idleTimeoutMillis: number = DEFAULT_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: number = DEFAULT_CONNECTION_TIMEOUT_MS,
  ): Promise<void> {
    return this.runExclusive(() => this.doConnect(readonlyMode, poolSize, idleTimeoutMillis, connectionTimeoutMillis));
  }

  async disconnect(reason: string = 'normal disconnect'): Promise<void> {
    return this.runExclusive(() => this.doDisconnect(reason));
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
      throw new Error(CONNECTION_STRING_REQUIRED_MESSAGE);
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

        // Release the failed pool's TCP sockets and drop our reference so a
        // subsequent connect() doesn't leak it by overwriting `this.pool`.
        // Only clear `this.pool` if it still points to *this* pool — a
        // newer connect may already have installed a fresh one.
        if (this.pool === pool) {
          this.pool = null;
        }
        void pool.end().catch(() => { /* shutdown errors swallowed */ });
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
    // Update the disconnect reason regardless of whether the pool is still
    // alive — if pool.on('error') already tore the pool down, an explicit
    // user-initiated disconnect should still overwrite the prior cause so
    // service-info reports the most recent reason.
    this.disconnectReason = reason;

    if (this.pool) {
      await this.pool.end();
      this.isConnected = false;
      this.pool = null;
      this.connectionString = null;
      this.connectionError = null;
    }
  }

  private ensureConnected(): Pool {
    if (!this.isConnected || !this.pool) {
      // Always raise a fresh error so callers see "call connect again" on
      // every attempt — caching `this.connectionError` and re-throwing it
      // makes every subsequent tool call after a failed connect look like
      // it failed for the same network reason, even after the database
      // has come back up. The original cause is preserved in `Error.cause`
      // for diagnostics.
      const cause = this.connectionError;
      const message = cause
        ? `Not connected to PostgreSQL (last attempt failed: ${cause.message}). Call \`connect\` to retry.`
        : 'Not connected to PostgreSQL. Please connect first.';

      throw new Error(message, cause ? { cause } : undefined);
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
   * Run a sequence of statements on a single physical connection inside a
   * single transaction. Used for check-then-act flows that must be atomic
   * (e.g. `index-operation drop` looks up the index and then drops it).
   * Cannot be used with statements that PostgreSQL forbids inside a
   * transaction block (notably `CREATE/DROP INDEX CONCURRENTLY`).
   */
  async withTransaction<T>(operation: (run: <R>(query: string, params?: unknown[]) => Promise<R[]>) => Promise<T>): Promise<T> {
    const pool = this.ensureConnected();
    const client = await pool.connect();
    let releaseError: Error | undefined;

    try {
      await client.query('BEGIN');

      const run = async <R>(query: string, params?: unknown[]): Promise<R[]> => {
        const result = await client.query(query, params);

        return result.rows as R[];
      };

      try {
        const value = await operation(run);

        await client.query('COMMIT');

        return value;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => { /* prefer the original error */ });
        releaseError = error instanceof Error ? error : new Error(String(error));
        throw error;
      }
    } finally {
      // Pass the error to release() so pg destroys the client instead of
      // returning it to the pool — after a failed query the connection's
      // protocol state may be inconsistent and reuse can break next callers.
      client.release(releaseError);
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
    let releaseError: Error | undefined;

    try {
      // Same as executeQuery: readonly enforcement is at the session level.
      for await (const row of stream as AsyncIterable<Record<string, unknown>>) {
        await onRow(row);
      }
    } catch (error) {
      stream.destroy();
      releaseError = error instanceof Error ? error : new Error(String(error));
      throw error;
    } finally {
      // After stream.destroy() the connection's protocol state may be
      // mid-response; pass the error to release() so pg destroys the client
      // instead of returning a half-baked connection to the pool.
      client.release(releaseError);
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
