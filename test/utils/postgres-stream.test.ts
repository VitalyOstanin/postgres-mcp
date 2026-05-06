import { describe, it, expect } from 'vitest';
import { Readable } from 'stream';
import { JsonArrayTransform, JsonLinesTransform } from '../../src/utils/postgres-stream';

async function collect(stream: NodeJS.ReadableStream): Promise<string> {
  let result = '';

  for await (const chunk of stream) {
    result += typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8');
  }

  return result;
}

describe('JsonArrayTransform', () => {
  it('emits an empty array `[]` when no rows pass through', async () => {
    const transform = new JsonArrayTransform();
    const source = Readable.from([], { objectMode: true });

    source.pipe(transform);
    expect(await collect(transform)).toBe('[]');
  });

  it('wraps a single row as a one-element JSON array', async () => {
    const transform = new JsonArrayTransform();
    const source = Readable.from([{ id: 1 }], { objectMode: true });

    source.pipe(transform);
    expect(await collect(transform)).toBe('[\n{"id":1}\n]');
  });

  it('separates multiple rows with `,` and closes with `\\n]`', async () => {
    const transform = new JsonArrayTransform();
    const source = Readable.from([{ a: 1 }, { b: 2 }], { objectMode: true });

    source.pipe(transform);
    expect(await collect(transform)).toBe('[\n{"a":1},\n{"b":2}\n]');
  });

  it('does NOT emit the opening `[` if JSON.stringify throws on the first row', async () => {
    // Circular structure — JSON.stringify will throw TypeError. The transform
    // must propagate that error WITHOUT having emitted `[\n` first, otherwise
    // the destination file would contain an unterminated JSON array prefix.
    const circular: Record<string, unknown> = { name: 'cycle' };

    circular['self'] = circular;

    const transform = new JsonArrayTransform();
    const source = Readable.from([circular], { objectMode: true });
    let collected = '';

    transform.on('data', (chunk: Buffer | string) => {
      collected += chunk.toString();
    });
    source.pipe(transform);

    await new Promise<void>((resolve) => {
      transform.on('error', () => { resolve(); });
      transform.on('end', () => { resolve(); });
    });
    expect(collected).toBe('');
  });
});

describe('JsonLinesTransform', () => {
  it('emits one JSON object per line', async () => {
    const transform = new JsonLinesTransform();
    const source = Readable.from([{ a: 1 }, { b: 2 }], { objectMode: true });

    source.pipe(transform);
    expect(await collect(transform)).toBe('{"a":1}\n{"b":2}\n');
  });

  it('emits empty output for an empty stream', async () => {
    const transform = new JsonLinesTransform();
    const source = Readable.from([], { objectMode: true });

    source.pipe(transform);
    expect(await collect(transform)).toBe('');
  });
});
