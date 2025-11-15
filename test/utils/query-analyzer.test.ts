import { describe, it, expect } from '@jest/globals';
import { supportsCursor } from '../../src/utils/query-analyzer.js';

// Adding test timeout settings that Jest should respect
describe('Query Analyzer - supportsCursor', () => {
  // Increase timeout for individual tests to accommodate parser initialization
  jest.setTimeout(30000);

  it('should return true for SELECT statements', async () => {
    const query = 'SELECT * FROM users';
    const result = await supportsCursor(query);

    expect(result).toBe(true);
  }, 10000);

  it('should return true for complex SELECT statements with JOINs', async () => {
    const query = 'SELECT u.name, p.title FROM users u JOIN posts p ON u.id = p.user_id WHERE u.active = true';
    const result = await supportsCursor(query);

    expect(result).toBe(true);
  }, 10000);

  it('should return true for SELECT with subqueries', async () => {
    const query = 'SELECT * FROM users WHERE id IN (SELECT user_id FROM orders WHERE total > 100)';
    const result = await supportsCursor(query);

    expect(result).toBe(true);
  }, 10000);

  it('should return true for SELECT with aggregation', async () => {
    const query = 'SELECT COUNT(*), AVG(amount) FROM orders GROUP BY user_id';
    const result = await supportsCursor(query);

    expect(result).toBe(true);
  }, 10000);

  it('should return false for INSERT statements', async () => {
    const query = 'INSERT INTO users (name, email) VALUES (\'John\', \'john@example.com\')';
    const result = await supportsCursor(query);

    expect(result).toBe(false);
  }, 10000);

  it('should return false for UPDATE statements', async () => {
    const query = 'UPDATE users SET name = \'Jane\' WHERE id = 1';
    const result = await supportsCursor(query);

    expect(result).toBe(false);
  }, 10000);

  it('should return false for DELETE statements', async () => {
    const query = 'DELETE FROM users WHERE id = 1';
    const result = await supportsCursor(query);

    expect(result).toBe(false);
  }, 10000);

  it('should return false for CREATE statements', async () => {
    const query = 'CREATE TABLE new_table (id SERIAL PRIMARY KEY, name VARCHAR(255))';
    const result = await supportsCursor(query);

    expect(result).toBe(false);
  }, 10000);

  it('should return false for ALTER statements', async () => {
    const query = 'ALTER TABLE users ADD COLUMN age INTEGER';
    const result = await supportsCursor(query);

    expect(result).toBe(false);
  }, 10000);

  it('should return false for DROP statements', async () => {
    const query = 'DROP TABLE old_table';
    const result = await supportsCursor(query);

    expect(result).toBe(false);
  }, 10000);

  it('should return false for EXPLAIN statements', async () => {
    const query = 'EXPLAIN SELECT * FROM users WHERE id = 1';
    const result = await supportsCursor(query);

    expect(result).toBe(false);
  }, 10000);

  it('should return false for EXPLAIN ANALYZE statements', async () => {
    const query = 'EXPLAIN ANALYZE SELECT COUNT(*) FROM large_table';
    const result = await supportsCursor(query);

    expect(result).toBe(false);
  }, 10000);

  it('should return false for EXPLAIN (ANALYZE, BUFFERS) statements', async () => {
    const query = 'EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM users WHERE active = true';
    const result = await supportsCursor(query);

    expect(result).toBe(false);
  }, 10000);

  it('should return false for VACUUM statements', async () => {
    const query = 'VACUUM ANALYZE users';
    const result = await supportsCursor(query);

    expect(result).toBe(false);
  }, 10000);

  it('should return false for invalid SQL', async () => {
    const query = 'SELECT * FROM users WHERE syntax error';
    const result = await supportsCursor(query);

    expect(result).toBe(false);
  }, 10000);

  it('should return false for empty query', async () => {
    const query = '';
    const result = await supportsCursor(query);

    expect(result).toBe(false);
  }, 10000);

  it('should return false for whitespace-only query', async () => {
    const query = '   \n  \t  ';
    const result = await supportsCursor(query);

    expect(result).toBe(false);
  }, 10000);

  it('should return false for SHOW statements', async () => {
    const query = 'SHOW server_version';
    const result = await supportsCursor(query);

    expect(result).toBe(false);
  }, 10000);

  it('should return false for SET statements', async () => {
    const query = 'SET timezone = \'UTC\'';
    const result = await supportsCursor(query);

    expect(result).toBe(false);
  }, 10000);
});
