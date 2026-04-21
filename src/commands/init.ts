import * as fs from 'node:fs';
import { generateIdentity, writeReusedIdentity, identityExists } from '../identity.js';
import { openDb, setMeta, getMeta } from '../db.js';
import { getEnvaultKeyPath, getEnvaultPubPath, getVaultDbPath } from '../paths.js';

export function initCmd(opts: { reuse?: string; force?: boolean } = {}): void {
  if (identityExists() && !opts.force) {
    const p = getEnvaultKeyPath();
    console.error(`envault is already initialized. Key at ${p}.`);
    console.error('Pass --force to overwrite (will destroy access to existing secrets).');
    process.exit(1);
  }

  if (opts.force && identityExists()) {
    fs.unlinkSync(getEnvaultKeyPath());
    const pub = getEnvaultPubPath();
    if (fs.existsSync(pub)) fs.unlinkSync(pub);
  }

  const result = opts.reuse
    ? writeReusedIdentity(opts.reuse)
    : generateIdentity();

  const db = openDb();
  if (!getMeta(db, 'schema_version')) {
    setMeta(db, 'schema_version', '1');
    setMeta(db, 'created_at', String(Math.floor(Date.now() / 1000)));
  }
  db.close();

  console.log(`envault initialized.`);
  console.log(`  private key: ${result.privPath} (0600)`);
  console.log(`  public key:  ${result.pubPath} (0644)`);
  console.log(`  vault db:    ${getVaultDbPath()}`);
  if (opts.reuse) {
    console.log(`  reused:      ${opts.reuse}`);
  }
}
