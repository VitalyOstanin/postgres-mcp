// Integration test environment. Expects the postgres container from
// compose.yaml to be running on 127.0.0.1:55432 with user/db `test`.
process.env['POSTGRES_MCP_CONNECTION_STRING'] ??= 'postgresql://test:test@127.0.0.1:55432/test';
process.env['POSTGRES_MCP_TIMEZONE'] ??= 'UTC';

export {};
