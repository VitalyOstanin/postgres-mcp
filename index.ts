#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PostgreSQLServer } from "./src/server.js";

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .option('auto-connect', {
      type: 'boolean',
      description: 'Auto connect to PostgreSQL on startup',
      default: false,
    })
    .option('read-only', {
      type: 'boolean',
      description: 'Run in read-only mode',
      default: true,
    })
    .option('pool-size', {
      type: 'number',
      description: 'Connection pool size',
      default: 1,
    })
    .option('idle-timeout', {
      type: 'number',
      description: 'Idle timeout in milliseconds',
      default: 30000, // 30 seconds
    })
    .option('connection-timeout', {
      type: 'number',
      description: 'Connection timeout in milliseconds',
      default: 10000, // 10 seconds
    })
    .parseAsync();
  const transport = new StdioServerTransport();
  const server = new PostgreSQLServer({
    autoConnect: argv['auto-connect'],
    readonlyMode: argv['read-only'],
    poolSize: argv['pool-size'],
    idleTimeout: argv['idle-timeout'],
    connectionTimeout: argv['connection-timeout'],
  });
  // Wire graceful shutdown: close the pool when the host sends SIGINT/SIGTERM
  // so PostgreSQL does not see abrupt connection drops on shutdown.
  //
  // Critical detail: a signal can arrive *during* startup (e.g. while
  // `server.init()` is still authenticating to PostgreSQL). If we naively
  // call `process.exit(0)` from the signal handler, we would tear the
  // process down while `init()` is mid-flight, leaking the half-opened
  // pool and serving an abrupt TCP reset to the database.
  //
  // Instead, we keep a reference to the startup promise and:
  //   1. Set `shuttingDown` so the startup path can skip
  //      `transport.connect` once it returns (we don't want the MCP host
  //      to think we're alive after the operator already asked us to stop).
  //   2. Await the startup promise from the shutdown handler before calling
  //      `server.shutdown()`, so the pool is fully created (and therefore
  //      cleanly closable) by the time we tear it down.
  let shuttingDown = false;
  const startup = (async (): Promise<void> => {
    await server.init();

    // ESLint can't see that `shuttingDown` is mutated by the SIGINT/SIGTERM
    // handler during the `await` above. The check is intentional.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (shuttingDown) {
      // The operator asked us to stop while we were still initialising;
      // don't attach the MCP transport — the shutdown path will close the
      // pool that init() just created.
      return;
    }
    await server.connect(transport);
  })();
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.error(`Received ${signal}, shutting down PostgreSQL MCP server...`);
    // Wait for any in-flight startup to settle (success or failure) before
    // tearing down — otherwise we'd race against init() finishing and
    // leak its pool.
    startup
      .catch(() => { /* startup failure surfaces in the main awaiter below */ })
      .then(() => server.shutdown())
      .then(() => { process.exit(0); })
      .catch((error: unknown) => {
        console.error('Error during shutdown:', error);
        process.exit(1);
      });
  };

  process.on('SIGINT', () => { shutdown('SIGINT'); });
  process.on('SIGTERM', () => { shutdown('SIGTERM'); });

  await startup;
}

main().catch((error) => {
  console.error("PostgreSQL MCP server crashed", error);
  process.exit(1);
});
