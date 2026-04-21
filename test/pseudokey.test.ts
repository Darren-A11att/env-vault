import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePseudokey, isPseudokey, scanPseudokeys, replacePseudokeys } from '../src/pseudokey.ts';

test('generatePseudokey produces valid format', () => {
  const pk = generatePseudokey('ANTHROPIC_API_KEY', () => false);
  assert.match(pk, /^envault-[0-9a-f]{8}$/);
});

test('generatePseudokey avoids collisions', () => {
  const existing = new Set<string>();
  const pk1 = generatePseudokey('NAME', (pk) => existing.has(pk));
  existing.add(pk1);
  const pk2 = generatePseudokey('NAME', (pk) => existing.has(pk));
  assert.notEqual(pk1, pk2);
});

test('isPseudokey matches single-value pseudokeys', () => {
  assert.equal(isPseudokey('envault-abc12345'), true);
  assert.equal(isPseudokey('envault-abcdef012345'), true);
  assert.equal(isPseudokey('envault-abc'), false);
  assert.equal(isPseudokey('envault-ABCDEF12'), false); // uppercase not allowed
  assert.equal(isPseudokey('prefix-envault-abc12345'), false);
  assert.equal(isPseudokey('envault-abc12345 extra'), false);
});

test('scanPseudokeys finds embedded tokens', () => {
  const text = 'Bearer envault-abc12345 and Authorization: envault-def67890fab';
  const hits = scanPseudokeys(text);
  assert.deepEqual(hits.sort(), ['envault-abc12345', 'envault-def67890fab']);
});

test('replacePseudokeys substitutes', () => {
  const text = 'key=envault-abc12345';
  const out = replacePseudokeys(text, (pk) => (pk === 'envault-abc12345' ? 'REAL' : undefined));
  assert.equal(out, 'key=REAL');
});

test('replacePseudokeys leaves unresolved tokens in place', () => {
  const text = 'envault-aaaaaaaa / envault-bbbbbbbb';
  const out = replacePseudokeys(text, (pk) => (pk === 'envault-aaaaaaaa' ? 'A' : undefined));
  assert.equal(out, 'A / envault-bbbbbbbb');
});
