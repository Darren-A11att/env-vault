import { x25519 } from '@noble/curves/ed25519.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from 'node:crypto';

const MAGIC = new Uint8Array([0x45, 0x4e, 0x56, 0x31]); // "ENV1"
const VERSION = 1;
const HKDF_INFO = new TextEncoder().encode('envault/v1');

export interface Ciphertext {
  blob: Uint8Array;
}

function deriveKey(sharedSecret: Uint8Array, ephPub: Uint8Array, recipientPub: Uint8Array): Uint8Array {
  const salt = new Uint8Array(ephPub.length + recipientPub.length);
  salt.set(ephPub, 0);
  salt.set(recipientPub, ephPub.length);
  return hkdf(sha256, sharedSecret, salt, HKDF_INFO, 32);
}

export function encryptSecret(plaintext: string, recipientX25519Pub: Uint8Array, aad: string): Uint8Array {
  const plainBytes = new TextEncoder().encode(plaintext);
  const aadBytes = new TextEncoder().encode(aad);

  const ephSecret = x25519.utils.randomSecretKey();
  const ephPub = x25519.getPublicKey(ephSecret);
  const shared = x25519.getSharedSecret(ephSecret, recipientX25519Pub);
  const key = deriveKey(shared, ephPub, recipientX25519Pub);

  const nonce = new Uint8Array(randomBytes(24));
  const cipher = xchacha20poly1305(key, nonce, aadBytes);
  const ct = cipher.encrypt(plainBytes);

  // Layout: MAGIC (4) | VERSION (1) | ephPub (32) | nonce (24) | ct+tag
  const out = new Uint8Array(4 + 1 + 32 + 24 + ct.length);
  let o = 0;
  out.set(MAGIC, o); o += 4;
  out[o++] = VERSION;
  out.set(ephPub, o); o += 32;
  out.set(nonce, o); o += 24;
  out.set(ct, o);
  return out;
}

export function decryptSecret(blob: Uint8Array, recipientX25519Priv: Uint8Array, aad: string): string {
  if (blob.length < 4 + 1 + 32 + 24 + 16) {
    throw new Error('ciphertext too short');
  }
  for (let i = 0; i < 4; i++) {
    if (blob[i] !== MAGIC[i]) {
      throw new Error('ciphertext missing ENV1 magic');
    }
  }
  const version = blob[4];
  if (version !== VERSION) {
    throw new Error(`unsupported ciphertext version: ${version}`);
  }
  const ephPub = blob.slice(5, 5 + 32);
  const nonce = blob.slice(5 + 32, 5 + 32 + 24);
  const ct = blob.slice(5 + 32 + 24);
  const aadBytes = new TextEncoder().encode(aad);

  const recipientPub = x25519.getPublicKey(recipientX25519Priv);
  const shared = x25519.getSharedSecret(recipientX25519Priv, ephPub);
  const key = deriveKey(shared, ephPub, recipientPub);

  const cipher = xchacha20poly1305(key, nonce, aadBytes);
  const plain = cipher.decrypt(ct);
  return new TextDecoder().decode(plain);
}
