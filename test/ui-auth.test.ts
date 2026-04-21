import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateToken,
  verifyToken,
  verifyHost,
  mintNonce,
  consumeNonce,
  __createNonceStore,
} from '../src/ui/auth.ts';

test('generateToken returns 64 hex chars', () => {
  const t = generateToken();
  assert.equal(t.length, 64);
  assert.match(t, /^[0-9a-f]{64}$/);
});

test('generateToken returns a different token each call', () => {
  const a = generateToken();
  const b = generateToken();
  assert.notEqual(a, b);
});

test('verifyToken accepts the correct token', () => {
  const t = generateToken();
  assert.equal(verifyToken(t, t), true);
});

test('verifyToken rejects wrong token of same length', () => {
  const a = generateToken();
  const b = generateToken();
  assert.equal(verifyToken(a, b), false);
});

test('verifyToken rejects undefined', () => {
  const t = generateToken();
  assert.equal(verifyToken(t, undefined), false);
});

test('verifyToken rejects empty string', () => {
  const t = generateToken();
  assert.equal(verifyToken(t, ''), false);
});

test('verifyToken rejects length-mismatched input', () => {
  const t = generateToken();
  assert.equal(verifyToken(t, 'abcd'), false);
  assert.equal(verifyToken(t, `${t}xx`), false);
});

test('verifyHost accepts 127.0.0.1 and localhost variants', () => {
  assert.equal(verifyHost('127.0.0.1'), true);
  assert.equal(verifyHost('127.0.0.1:1234'), true);
  assert.equal(verifyHost('localhost'), true);
  assert.equal(verifyHost('localhost:9999'), true);
});

test('verifyHost rejects non-local hosts', () => {
  assert.equal(verifyHost('evil.com'), false);
  assert.equal(verifyHost('example.com:80'), false);
  assert.equal(verifyHost('192.168.1.1'), false);
  assert.equal(verifyHost('0.0.0.0'), false);
  assert.equal(verifyHost(undefined), false);
  assert.equal(verifyHost(''), false);
});

test('mintNonce + consumeNonce are single-use', () => {
  const n = mintNonce();
  assert.equal(typeof n, 'string');
  assert.ok(n.length > 0);
  assert.equal(consumeNonce(n), true);
  assert.equal(consumeNonce(n), false);
});

test('consumeNonce returns false for unknown nonce', () => {
  assert.equal(consumeNonce('unknown-nonce-value'), false);
});

test('nonce is consumable within TTL (short wait)', async () => {
  const n = mintNonce();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(consumeNonce(n), true);
});

test('nonce expires after TTL (injected clock)', () => {
  let now = 1_000_000;
  const store = __createNonceStore({ now: () => now, ttlMs: 10_000 });
  const n = store.mint();
  // advance past TTL
  now += 10_001;
  assert.equal(store.consume(n), false);
});

test('nonce still valid before TTL (injected clock)', () => {
  let now = 1_000_000;
  const store = __createNonceStore({ now: () => now, ttlMs: 10_000 });
  const n = store.mint();
  now += 9_999;
  assert.equal(store.consume(n), true);
});
