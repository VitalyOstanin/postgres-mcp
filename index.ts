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
  const readOnlyMode = argv['read-only'];
  const poolSize = argv['pool-size'];
  const idleTimeout = argv['idle-timeout'];
  const connectionTimeout = argv['connection-timeout'];
  const transport = new StdioServerTransport();
  const server = new PostgreSQLServer(argv['auto-connect'], readOnlyMode, poolSize, idleTimeout, connectionTimeout);
  // Wire graceful shutdown: close the pool when the host sends SIGINT/SIGTERM
  // so PostgreSQL does not see abrupt connection drops on shutdown.
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.error(`Received ${signal}, shutting down PostgreSQL MCP server...`);
    server.shutdown().finally(() => { process.exit(0); });
  };

  process.on('SIGINT', () => { shutdown('SIGINT'); });
  process.on('SIGTERM', () => { shutdown('SIGTERM'); });

  await server.connect(transport);
}

main().catch((error) => {
  console.error("PostgreSQL MCP server crashed", error);
  process.exit(1);
});
