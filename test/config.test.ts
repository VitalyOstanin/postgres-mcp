import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('returns the connection string when set to a non-empty value', () => {
    const config = loadConfig({
      POSTGRES_MCP_CONNECTION_STRING: 'postgresql://localhost/db',
    });

    expect(config.connectionString).toBe('postgresql://localhost/db');
  });

  it('treats empty POSTGRES_MCP_CONNECTION_STRING as undefined', () => {
    const config = loadConfig({
      POSTGRES_MCP_CONNECTION_STRING: '',
    });

    expect(config.connectionString).toBeUndefined();
  });

  it('treats whitespace-only POSTGRES_MCP_CONNECTION_STRING as undefined', () => {
    const config = loadConfig({
      POSTGRES_MCP_CONNECTION_STRING: '   ',
    });

    expect(config.connectionString).toBeUndefined();
  });

  it('trims surrounding whitespace from POSTGRES_MCP_TIMEZONE', () => {
    const config = loadConfig({
      POSTGRES_MCP_TIMEZONE: '  UTC  ',
    });

    expect(config.timezone).toBe('UTC');
  });

  it('falls back to default timezone when env is empty', () => {
    const config = loadConfig({
      POSTGRES_MCP_TIMEZONE: '',
    });

    expect(config.timezone).toBe('Europe/Moscow');
  });

  it('falls back to default timezone when env is unset', () => {
    const config = loadConfig({});

    expect(config.timezone).toBe('Europe/Moscow');
  });
});
