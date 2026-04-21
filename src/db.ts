import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { getEnvaultDir, getVaultDbPath } from './paths.js';

export interface SecretRow {
  name: string;
  pseudokey: string;
  ciphertext: Buffer;
  created_at: number;
  updated_at: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS secrets (
  name        TEXT PRIMARY KEY,
  pseudokey   TEXT UNIQUE NOT NULL,
  ciphertext  BLOB NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pseudokey ON secrets(pseudokey);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDb(): Database.Database {
  const dir = getEnvaultDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const db = new Database(getVaultDbPath());
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}

export function setMeta(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
}

export function getMeta(db: Database.Database, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function upsertSecret(
  db: Database.Database,
  name: string,
  pseudokey: string,
  ciphertext: Uint8Array,
): { created: boolean } {
  const existing = db.prepare('SELECT pseudokey FROM secrets WHERE name = ?').get(name) as { pseudokey: string } | undefined;
  const now = Math.floor(Date.now() / 1000);
  if (existing) {
    db.prepare('UPDATE secrets SET ciphertext = ?, updated_at = ? WHERE name = ?').run(Buffer.from(ciphertext), now, name);
    return { created: false };
  }
  db.prepare('INSERT INTO secrets(name, pseudokey, ciphertext, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    name,
    pseudokey,
    Buffer.from(ciphertext),
    now,
    now,
  );
  return { created: true };
}

export function getSecretRow(db: Database.Database, name: string): SecretRow | undefined {
  return db.prepare('SELECT name, pseudokey, ciphertext, created_at, updated_at FROM secrets WHERE name = ?').get(name) as
    | SecretRow
    | undefined;
}

export function getSecretRowByPseudokey(db: Database.Database, pseudokey: string): SecretRow | undefined {
  return db
    .prepare('SELECT name, pseudokey, ciphertext, created_at, updated_at FROM secrets WHERE pseudokey = ?')
    .get(pseudokey) as SecretRow | undefined;
}

export function listSecretRows(db: Database.Database): Array<Pick<SecretRow, 'name' | 'pseudokey' | 'created_at' | 'updated_at'>> {
  return db
    .prepare('SELECT name, pseudokey, created_at, updated_at FROM secrets ORDER BY name')
    .all() as Array<Pick<SecretRow, 'name' | 'pseudokey' | 'created_at' | 'updated_at'>>;
}

export function removeSecret(db: Database.Database, name: string): boolean {
  const info = db.prepare('DELETE FROM secrets WHERE name = ?').run(name);
  return info.changes > 0;
}

export function pseudokeyExists(db: Database.Database, pseudokey: string): boolean {
  const row = db.prepare('SELECT 1 FROM secrets WHERE pseudokey = ?').get(pseudokey) as unknown;
  return row !== undefined;
}
