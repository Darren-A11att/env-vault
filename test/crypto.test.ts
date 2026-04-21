import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret } from '../src/crypto.ts';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';

test('encrypt/decrypt roundtrip', () => {
  const seed = ed25519.utils.randomSecretKey();
  const edPub = ed25519.getPublicKey(seed);
  const xPriv = ed25519.utils.toMontgomerySecret(seed);
  const xPub = ed25519.utils.toMontgomery(edPub);

  const plaintext = 'sk-ant-api03-abc123-def456';
  const blob = encryptSecret(plaintext, xPub, 'ANTHROPIC_API_KEY');
  const out = decryptSecret(blob, xPriv, 'ANTHROPIC_API_KEY');
  assert.equal(out, plaintext);
});

test('decrypt fails with wrong AAD', () => {
  const seed = ed25519.utils.randomSecretKey();
  const edPub = ed25519.getPublicKey(seed);
  const xPriv = ed25519.utils.toMontgomerySecret(seed);
  const xPub = ed25519.utils.toMontgomery(edPub);

  const blob = encryptSecret('value', xPub, 'NAME_A');
  assert.throws(() => decryptSecret(blob, xPriv, 'NAME_B'));
});

test('decrypt fails with wrong key', () => {
  const seed1 = ed25519.utils.randomSecretKey();
  const seed2 = ed25519.utils.randomSecretKey();
  const xPub1 = ed25519.utils.toMontgomery(ed25519.getPublicKey(seed1));
  const xPriv2 = ed25519.utils.toMontgomerySecret(seed2);

  const blob = encryptSecret('value', xPub1, 'NAME');
  assert.throws(() => decryptSecret(blob, xPriv2, 'NAME'));
});

test('ciphertext has expected magic', () => {
  const seed = ed25519.utils.randomSecretKey();
  const xPub = ed25519.utils.toMontgomery(ed25519.getPublicKey(seed));
  const blob = encryptSecret('v', xPub, 'N');
  assert.equal(blob[0], 0x45);
  assert.equal(blob[1], 0x4e);
  assert.equal(blob[2], 0x56);
  assert.equal(blob[3], 0x31);
  assert.equal(blob[4], 1); // version
});
