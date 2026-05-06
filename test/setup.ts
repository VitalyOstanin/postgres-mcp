// Vitest global setup for unit tests.
//
// We pre-seed POSTGRES_MCP_CONNECTION_STRING so suites that exercise the
// PostgreSQL client wrapper (with `pg` mocked at the module level) don't have
// to set it themselves. Tests that probe configuration loading should pass an
// explicit `env` map to `loadConfig` instead of relying on process.env.
//
// `??=` (not `=`) so that a developer who already has POSTGRES_MCP_CONNECTION_STRING
// pointing at their own dev database keeps that value when running the unit
// suite — unit tests mock `pg` anyway, so the actual DSN isn't used, but
// silently overwriting the env breaks subsequent commands run from the same
// shell (e.g. a manual `node dist/index.js` after `npm test`).
import { beforeEach, afterEach } from 'vitest';

process.env['POSTGRES_MCP_CONNECTION_STRING'] ??= 'postgresql://test:test@localhost:5432/test';

// Env vars whose value on the dev machine could silently change test
// behavior (e.g. by widening a path-validation whitelist). We snapshot
// and clear them around every test so suites only see what they
// explicitly set themselves. Suites that need a value should set it in
// their own beforeEach/afterEach — this hook will then snapshot and
// restore that scoped value.
const ISOLATED_ENVS = ['POSTGRES_MCP_OUTPUT_DIRS'] as const;
const isolatedEnvSnapshot: Partial<Record<(typeof ISOLATED_ENVS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const key of ISOLATED_ENVS) {
    isolatedEnvSnapshot[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ISOLATED_ENVS) {
    const original = isolatedEnvSnapshot[key];

    if (original !== undefined) {
      process.env[key] = original;
    } else {
      delete process.env[key];
    }
  }
});

export {};
