import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStdinValue } from '../src/commands/set.ts';
import { Readable } from 'node:stream';

test('readStdinValue reads full stream and strips single trailing newline', async () => {
  const stream = Readable.from([Buffer.from('hello-world\n')]);
  const value = await readStdinValue(stream);
  assert.equal(value, 'hello-world');
});

test('readStdinValue preserves internal newlines', async () => {
  const stream = Readable.from([Buffer.from('line1\nline2\n')]);
  const value = await readStdinValue(stream);
  assert.equal(value, 'line1\nline2');
});

test('readStdinValue handles empty stream', async () => {
  const stream = Readable.from([]);
  const value = await readStdinValue(stream);
  assert.equal(value, '');
});

test('readStdinValue strips \\r\\n line ending', async () => {
  const stream = Readable.from([Buffer.from('value\r\n')]);
  const value = await readStdinValue(stream);
  assert.equal(value, 'value');
});
