// Shared .env parse+upsert pipeline used by both the CLI `envault import`
// command and the web UI `POST /api/import` handler.
//
// Intentionally transport-agnostic: it takes raw env text and a vault-like
// object with a `set()` method, and returns a structured summary. It never
// reads or writes files, and never prints. Callers handle I/O and rendering.

import dotenv from 'dotenv';
import { isPseudokey } from '../pseudokey.js';

// Same validator the CRUD handler + `envault set` use. Letters, digits,
// underscore; must not start with a digit. Case-insensitive.
const NAME_RE = /^[A-Z_][A-Z0-9_]*$/i;

export interface ImportMapping {
  name: string;
  pseudokey: string;
  /** Already-pseudokey values are recorded but not re-upserted. */
  skipped: boolean;
}

export interface ImportRejection {
  name: string;
  reason: string;
}

export interface ImportResult {
  /** Ordered list of actually-upserted + already-pseudokey entries. */
  mappings: ImportMapping[];
  /** Entries whose names failed validation (never upserted). */
  rejected: ImportRejection[];
  /** Count of names upserted into the vault this call. */
  imported: number;
  /** Count of names whose values were already pseudokeys and were left alone. */
  skipped: number;
}

/** Minimal vault surface the pipeline needs. Lets tests inject fakes. */
export interface VaultLike {
  set(name: string, value: string): { pseudokey: string; created: boolean };
}

/**
 * Parse `.env` text and upsert each entry into the given vault.
 *
 * - Names that fail the identifier regex are collected in `rejected` and
 *   NOT upserted.
 * - Values that are already pseudokeys (`envault-[0-9a-f]{8,12}`) are
 *   recorded in `mappings` with `skipped: true` and NOT re-upserted.
 * - Everything else is upserted via `vault.set(name, value)`.
 */
export function parseAndImport(envText: string, vault: VaultLike): ImportResult {
  const parsed = dotenv.parse(envText);
  const names = Object.keys(parsed);
  const mappings: ImportMapping[] = [];
  const rejected: ImportRejection[] = [];

  for (const name of names) {
    if (!NAME_RE.test(name)) {
      rejected.push({
        name,
        reason: 'invalid name: use letters, digits, underscore; must not start with a digit',
      });
      continue;
    }
    const value = parsed[name];
    if (isPseudokey(value)) {
      mappings.push({ name, pseudokey: value, skipped: true });
      continue;
    }
    const { pseudokey } = vault.set(name, value);
    mappings.push({ name, pseudokey, skipped: false });
  }

  const imported = mappings.filter((m) => !m.skipped).length;
  const skipped = mappings.length - imported;
  return { mappings, rejected, imported, skipped };
}

/** Count parseable entries without upserting. Used for size/sanity checks. */
export function countEntries(envText: string): number {
  return Object.keys(dotenv.parse(envText)).length;
}
