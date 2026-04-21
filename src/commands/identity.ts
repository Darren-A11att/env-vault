import * as fs from 'node:fs';
import { identityExists, loadIdentity, loadPublicIdentity } from '../identity.js';
import {
  fingerprintFromPublicKey,
  forgetScalar,
  loadCachedScalar,
} from '../identity-cache.js';
import { getEnvaultKeyPath, getEnvaultPubPath } from '../paths.js';

function requireInitialized(): void {
  if (!identityExists()) {
    throw new Error('envault is not initialized. Run: envault init');
  }
}

function currentFingerprint(): string {
  const pubPath = getEnvaultPubPath();
  if (!fs.existsSync(pubPath)) {
    throw new Error(`Public key not found at ${pubPath}. Run: envault init`);
  }
  const { ed25519Pub } = loadPublicIdentity();
  return fingerprintFromPublicKey(ed25519Pub);
}

export async function identityUnlockCmd(): Promise<void> {
  requireInitialized();
  // loadIdentity performs the prompt + cache on success when forceUncached is set.
  const id = await loadIdentity({ forceUncached: true });
  const fingerprint = fingerprintFromPublicKey(id.ed25519Pub);
  console.log(`cached: ${fingerprint}`);
}

export function identityForgetCmd(): void {
  requireInitialized();
  const fingerprint = currentFingerprint();
  const deleted = forgetScalar(fingerprint);
  if (deleted) {
    console.log(`forgotten: ${fingerprint}`);
  } else {
    console.log(`no cache entry for ${fingerprint}`);
  }
}

export function identityShowCmd(): void {
  requireInitialized();
  const fingerprint = currentFingerprint();
  const cached = loadCachedScalar(fingerprint);
  console.log(`fingerprint: ${fingerprint}`);
  console.log(`key:         ${getEnvaultKeyPath()}`);
  console.log(`cache:       ${cached ? 'present' : 'absent'}`);
}
