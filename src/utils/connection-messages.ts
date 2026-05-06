// Shared user-facing strings related to PostgreSQL connection lifecycle.
// Centralised so a wording change applies to every tool (connect, server
// auto-connect, MCP-side guards) without keeping multiple copies in sync.

export const CONNECTION_STRING_REQUIRED_MESSAGE =
  'Connection string is required. Please set POSTGRES_MCP_CONNECTION_STRING environment variable.';
