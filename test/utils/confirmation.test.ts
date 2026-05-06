import { describe, it, expect } from 'vitest';
import { classifyDestructive, DESTRUCTIVE_CONFIRMATION_VALUE } from '../../src/utils/confirmation';

describe('DESTRUCTIVE_CONFIRMATION_VALUE', () => {
  it('is a stable, hard-to-guess literal so an LLM cannot pass it accidentally', () => {
    expect(DESTRUCTIVE_CONFIRMATION_VALUE).toBe('I_KNOW_THIS_IS_DESTRUCTIVE');
    // Any drift in the literal is a contract change visible to every tool
    // description, so guard the constant from silent renames.
    expect(DESTRUCTIVE_CONFIRMATION_VALUE.length).toBeGreaterThanOrEqual(20);
  });
});

describe('classifyDestructive', () => {
  it('classifies an empty query as non-destructive', async () => {
    const result = await classifyDestructive('   ');

    expect(result.isDestructive).toBe(false);
  });

  it('classifies SELECT as non-destructive', async () => {
    const result = await classifyDestructive('SELECT 1');

    expect(result.isDestructive).toBe(false);
  });

  it('classifies WITH ... SELECT as non-destructive', async () => {
    const result = await classifyDestructive('WITH cte AS (SELECT 1 AS x) SELECT * FROM cte');

    expect(result.isDestructive).toBe(false);
  });

  it('classifies INSERT as non-destructive (writes are fine, only deletes/destroys gate)', async () => {
    const result = await classifyDestructive('INSERT INTO users (id, name) VALUES (1, $1)');

    expect(result.isDestructive).toBe(false);
  });

  it('classifies CREATE as non-destructive', async () => {
    const result = await classifyDestructive('CREATE TABLE users (id int)');

    expect(result.isDestructive).toBe(false);
  });

  it('classifies a scoped UPDATE (with WHERE) as non-destructive', async () => {
    const result = await classifyDestructive('UPDATE users SET name = $1 WHERE id = 1');

    expect(result.isDestructive).toBe(false);
  });

  it('classifies a scoped DELETE (with WHERE) as non-destructive', async () => {
    const result = await classifyDestructive('DELETE FROM users WHERE id = 1');

    expect(result.isDestructive).toBe(false);
  });

  it('classifies UPDATE without WHERE as destructive', async () => {
    const result = await classifyDestructive('UPDATE users SET name = $1');

    expect(result.isDestructive).toBe(true);
    expect(result.reason).toMatch(/UPDATE without WHERE/i);
  });

  it('classifies DELETE without WHERE as destructive', async () => {
    const result = await classifyDestructive('DELETE FROM users');

    expect(result.isDestructive).toBe(true);
    expect(result.reason).toMatch(/DELETE without WHERE/i);
  });

  it('classifies DROP TABLE as destructive', async () => {
    const result = await classifyDestructive('DROP TABLE users');

    expect(result.isDestructive).toBe(true);
    expect(result.reason).toMatch(/DropStmt/);
  });

  it('classifies DROP INDEX as destructive', async () => {
    const result = await classifyDestructive('DROP INDEX users_email_idx');

    expect(result.isDestructive).toBe(true);
  });

  it('classifies TRUNCATE as destructive', async () => {
    const result = await classifyDestructive('TRUNCATE TABLE users');

    expect(result.isDestructive).toBe(true);
    expect(result.reason).toMatch(/TruncateStmt/);
  });

  it('classifies ALTER TABLE as destructive', async () => {
    const result = await classifyDestructive('ALTER TABLE users ADD COLUMN extra int');

    expect(result.isDestructive).toBe(true);
    expect(result.reason).toMatch(/AlterTableStmt/);
  });

  it('classifies a syntactically broken query as non-destructive (defer to PG)', async () => {
    const result = await classifyDestructive('NOT A QUERY ;;;');

    // We don't want to over-block here — PostgreSQL will reject the
    // statement with a syntax error anyway, so a parser failure means
    // "not destructive at this layer" rather than "destructive by default".
    expect(result.isDestructive).toBe(false);
  });
});
