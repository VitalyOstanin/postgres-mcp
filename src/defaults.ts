// Defaults shared between the CLI parser, the server constructor and the
// PostgreSQL client. Centralising them prevents the three sources of truth
// from drifting (e.g. CLI keeps `30000` but client falls back to a different
// value when called without arguments).

export const DEFAULT_POOL_SIZE = 1;
export const DEFAULT_IDLE_TIMEOUT_MS = 30000;
export const DEFAULT_CONNECTION_TIMEOUT_MS = 10000;
export const DEFAULT_TIMEZONE = 'Europe/Moscow';
export const DEFAULT_READONLY_MODE = true;
export const DEFAULT_AUTO_CONNECT = false;

// Pagination defaults shared by list-* tools.
export const DEFAULT_PAGE_LIMIT = 100;
export const MAX_PAGE_LIMIT = 1000;
export const MIN_PAGE_LIMIT = 1;
