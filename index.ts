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
    .parseAsync();
  const readOnlyMode = argv['read-only'];
  const poolSize = argv['pool-size'];
  const transport = new StdioServerTransport();
  const server = new PostgreSQLServer(argv['auto-connect'], readOnlyMode, poolSize);

  await server.connect(transport);
}

main().catch((error) => {
  console.error("PostgreSQL MCP server crashed", error);
  process.exit(1);
});