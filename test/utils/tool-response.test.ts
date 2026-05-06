import { describe, it, expect } from 'vitest';
import { z, type ZodError } from 'zod';
import { toolSuccess, toolError } from '../../src/utils/tool-response';

describe('toolSuccess', () => {
  it('wraps payload in { success: true, payload } and mirrors it in content text', () => {
    const result = toolSuccess({ rows: [1, 2, 3] });

    expect(result.structuredContent).toEqual({ success: true, payload: { rows: [1, 2, 3] } });
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify({ success: true, payload: { rows: [1, 2, 3] } }) },
    ]);
    expect(result.isError).toBeUndefined();
  });

  it('handles primitive payloads', () => {
    const result = toolSuccess('hello');

    expect(result.structuredContent).toEqual({ success: true, payload: 'hello' });
  });
});

describe('toolError', () => {
  it('produces ValidationError body for ZodError and tags isError', () => {
    const schema = z.object({ name: z.string() });
    let zodError: ZodError | undefined;

    try {
      schema.parse({ name: 42 });
    } catch (e) {
      zodError = e as ZodError;
    }

    const result = toolError(zodError);

    expect(result.isError).toBe(true);

    const body = result.structuredContent as Record<string, unknown>;

    expect(body['name']).toBe('ValidationError');
    expect(body['message']).toBe('Invalid input');
    expect(body['details']).toBeDefined();
  });

  it('redacts the connection string in plain Error message', () => {
    const error = new Error('connection failed for postgres://alice:secret@host:5432/db');
    const result = toolError(error);
    const body = result.structuredContent as Record<string, unknown>;

    expect(body['name']).toBe('Error');
    expect(body['message']).toContain('postgres://alice:***@host:5432/db');
    expect(body['message']).not.toContain('secret');
  });

  it('passes through pg-style fields code, detail, hint, severity (redacting detail)', () => {
    const pgError = Object.assign(new Error('boom for postgres://u:p@h/db'), {
      code: '42P01',
      detail: 'caused while connecting postgres://u:p@h/db',
      hint: 'check schema name',
      severity: 'ERROR',
    });
    const result = toolError(pgError);
    const body = result.structuredContent as Record<string, unknown>;

    expect(body['code']).toBe('42P01');
    expect(body['hint']).toBe('check schema name');
    expect(body['severity']).toBe('ERROR');
    expect(body['detail']).toContain('postgres://u:***@h/db');
    expect(body['detail']).not.toContain(':p@');
  });

  it('omits pg-style fields when not present', () => {
    const result = toolError(new Error('plain'));
    const body = result.structuredContent as Record<string, unknown>;

    expect(body['code']).toBeUndefined();
    expect(body['detail']).toBeUndefined();
    expect(body['hint']).toBeUndefined();
    expect(body['severity']).toBeUndefined();
  });

  it('falls back to UnknownError for non-Error values', () => {
    const result = toolError({ weird: 'shape' });
    const body = result.structuredContent as Record<string, unknown>;

    expect(body['name']).toBe('UnknownError');
    expect(body['message']).toBe('An unknown error occurred');
    expect(body['details']).toEqual({ weird: 'shape' });
  });

  it('redacts when error is passed as a raw string', () => {
    const result = toolError('failed: postgres://u:topsecret@h/db');
    const body = result.structuredContent as Record<string, unknown>;

    expect(body['details']).toContain('postgres://u:***@h/db');
    expect(body['details']).not.toContain('topsecret');
  });

  it('content text mirrors structuredContent exactly', () => {
    const result = toolError(new Error('boom'));
    const body = result.structuredContent as Record<string, unknown>;
    const {text} = (result.content[0] as { text: string });

    expect(JSON.parse(text)).toEqual(body);
  });
});
