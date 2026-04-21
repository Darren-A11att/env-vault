import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  fingerprintFromPublicKey,
  cacheScalar,
  loadCachedScalar,
  forgetScalar,
  setKeychainBackend,
  getKeychainBackend,
  MemoryKeychainBackend,
} from '../src/identity-cache.ts';

let mem: MemoryKeychainBackend;

beforeEach(() => {
  mem = new MemoryKeychainBackend();
  setKeychainBackend(mem);
});

test('fingerprintFromPublicKey is deterministic and 16 hex chars', () => {
  const pub = new Uint8Array(32);
  for (let i = 0; i < 32; i++) pub[i] = i;

  const fp1 = fingerprintFromPublicKey(pub);
  const fp2 = fingerprintFromPublicKey(pub);
  assert.equal(fp1, fp2);
  assert.equal(fp1.length, 16);
  assert.match(fp1, /^[0-9a-f]{16}$/);

  const pub2 = new Uint8Array(32);
  pub2[0] = 1;
  const fpOther = fingerprintFromPublicKey(pub2);
  assert.notEqual(fp1, fpOther);
});

test('cacheScalar / loadCachedScalar roundtrip', () => {
  const fp = 'a'.repeat(16);
  const scalar = new Uint8Array(32);
  for (let i = 0; i < 32; i++) scalar[i] = (i * 7) & 0xff;

  assert.equal(loadCachedScalar(fp), undefined);
  cacheScalar(fp, scalar);
  const loaded = loadCachedScalar(fp);
  assert.ok(loaded);
  assert.equal(loaded!.length, 32);
  assert.deepEqual(Array.from(loaded!), Array.from(scalar));
});

test('forgetScalar returns true once then false', () => {
  const fp = 'b'.repeat(16);
  cacheScalar(fp, new Uint8Array(32));
  assert.equal(forgetScalar(fp), true);
  assert.equal(forgetScalar(fp), false);
  assert.equal(loadCachedScalar(fp), undefined);
});

test('different fingerprints isolate scalars', () => {
  const fpA = 'a'.repeat(16);
  const fpB = 'b'.repeat(16);
  const scalarA = new Uint8Array(32).fill(1);
  const scalarB = new Uint8Array(32).fill(2);

  cacheScalar(fpA, scalarA);
  cacheScalar(fpB, scalarB);

  const loadedA = loadCachedScalar(fpA);
  const loadedB = loadCachedScalar(fpB);
  assert.ok(loadedA);
  assert.ok(loadedB);
  assert.deepEqual(Array.from(loadedA!), Array.from(scalarA));
  assert.deepEqual(Array.from(loadedB!), Array.from(scalarB));

  assert.equal(forgetScalar(fpA), true);
  assert.equal(loadCachedScalar(fpA), undefined);
  // fpB entry is untouched
  const stillB = loadCachedScalar(fpB);
  assert.ok(stillB);
  assert.deepEqual(Array.from(stillB!), Array.from(scalarB));
});

test('getKeychainBackend returns the active backend', () => {
  assert.equal(getKeychainBackend(), mem);
});
