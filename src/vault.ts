import type Database from 'better-sqlite3';
import { openDb, upsertSecret, getSecretRow, getSecretRowByPseudokey, listSecretRows, removeSecret, pseudokeyExists, setMeta, getMeta } from './db.js';
import { generatePseudokey } from './pseudokey.js';
import { encryptSecret, decryptSecret } from './crypto.js';
import { loadIdentity, loadPublicIdentity, identityExists, type Identity } from './identity.js';

export interface SecretListing {
  name: string;
  pseudokey: string;
  created_at: number;
  updated_at: number;
}

export class Vault {
  private db: Database.Database;
  private fullIdentity?: Identity;
  private publicKey?: Uint8Array;

  private constructor(db: Database.Database) {
    this.db = db;
  }

  static open(): Vault {
    if (!identityExists()) {
      throw new Error('envault is not initialized. Run: envault init');
    }
    const db = openDb();
    if (!getMeta(db, 'schema_version')) {
      setMeta(db, 'schema_version', '1');
      setMeta(db, 'created_at', String(Math.floor(Date.now() / 1000)));
    }
    return new Vault(db);
  }

  private getPublicKey(): Uint8Array {
    if (!this.publicKey) {
      this.publicKey = loadPublicIdentity().x25519Pub;
    }
    return this.publicKey;
  }

  private async getFullIdentity(): Promise<Identity> {
    if (!this.fullIdentity) {
      this.fullIdentity = await loadIdentity();
    }
    return this.fullIdentity;
  }

  set(name: string, value: string): { pseudokey: string; created: boolean } {
    const pub = this.getPublicKey();
    const ciphertext = encryptSecret(value, pub, name);
    const existing = getSecretRow(this.db, name);
    const pseudokey = existing?.pseudokey ?? generatePseudokey(name, (pk) => pseudokeyExists(this.db, pk));
    const { created } = upsertSecret(this.db, name, pseudokey, ciphertext);
    return { pseudokey, created };
  }

  async get(name: string): Promise<string> {
    const row = getSecretRow(this.db, name);
    if (!row) {
      throw new Error(`secret not found: ${name}`);
    }
    const id = await this.getFullIdentity();
    return decryptSecret(new Uint8Array(row.ciphertext), id.x25519Priv, name);
  }

  getPseudokey(name: string): string | undefined {
    return getSecretRow(this.db, name)?.pseudokey;
  }

  async getByPseudokey(pseudokey: string): Promise<string | undefined> {
    const row = getSecretRowByPseudokey(this.db, pseudokey);
    if (!row) return undefined;
    const id = await this.getFullIdentity();
    return decryptSecret(new Uint8Array(row.ciphertext), id.x25519Priv, row.name);
  }

  list(): SecretListing[] {
    return listSecretRows(this.db);
  }

  remove(name: string): boolean {
    return removeSecret(this.db, name);
  }

  close(): void {
    this.db.close();
  }
}
