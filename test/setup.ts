// Vitest global setup for unit tests.
//
// We pre-seed POSTGRES_MCP_CONNECTION_STRING so suites that exercise the
// PostgreSQL client wrapper (with `pg` mocked at the module level) don't have
// to set it themselves. Tests that probe configuration loading should pass an
// explicit `env` map to `loadConfig` instead of relying on process.env.
process.env['POSTGRES_MCP_CONNECTION_STRING'] = 'postgresql://test:test@localhost:5432/test';

export {};
