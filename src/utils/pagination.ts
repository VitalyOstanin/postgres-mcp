import { z } from 'zod';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, MIN_PAGE_LIMIT } from '../defaults.js';

/**
 * Common `limit` schema for paginated list-* tools. Centralising the bounds
 * keeps every tool description and validation in sync with the constants in
 * `src/defaults.ts`.
 */
export function paginationLimitSchema(itemLabel: string) {
  return z.number().int().min(MIN_PAGE_LIMIT).max(MAX_PAGE_LIMIT).optional()
    .default(DEFAULT_PAGE_LIMIT)
    .describe(`Maximum number of ${itemLabel} to return (default: ${DEFAULT_PAGE_LIMIT}, max: ${MAX_PAGE_LIMIT})`);
}

export function paginationOffsetSchema(itemLabel: string) {
  return z.number().int().min(0).optional().default(0)
    .describe(`Number of ${itemLabel} to skip for pagination (default: 0)`);
}
