// CRUD handlers for /api/secrets. B1, Wave 2.
//
// Security invariants:
//   - GET  /api/secrets          → list (name + pseudokey + timestamps, NO values)
//   - POST /api/secrets          → add-or-update; returns { name, pseudokey, created }
//   - PUT  /api/secrets/:name    → update-only; 404 if name unknown; returns { pseudokey, created: false }
//   - DELETE /api/secrets/:name  → remove; returns { removed: true } or 404
//
// NEVER return decrypted values here. Reveal is B2's slice.

import type { Handler, HandlerResult, Route } from '../router.js';
import { Vault } from '../../vault.js';

// Mirrors src/commands/set.ts. Letters, digits, underscore; must not start with a digit.
const NAME_RE = /^[A-Z_][A-Z0-9_]*$/i;

// 1 MiB. Value cap for POST/PUT bodies (pre-JSON-overhead). The server-level
// body cap in src/ui/server.ts is 1 MB (decimal); anything above that is
// rejected before we get here. We still guard here for the unit-test path
// where handlers are invoked directly.
const MAX_VALUE_BYTES = 1024 * 1024;

// Defensive: limit name length to something sane so we don't DoS sqlite.
const MAX_NAME_LEN = 256;

function bad(message: string): HandlerResult {
  return { status: 400, json: { error: message } };
}

function notFound(message = 'not found'): HandlerResult {
  return { status: 404, json: { error: message } };
}

function validateName(raw: unknown): { ok: true; name: string } | { ok: false; err: HandlerResult } {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, err: bad('missing field: name') };
  }
  if (raw.length > MAX_NAME_LEN) {
    return { ok: false, err: bad('name too long') };
  }
  if (!NAME_RE.test(raw)) {
    return { ok: false, err: bad('invalid name: use letters, digits, underscore; must not start with a digit') };
  }
  return { ok: true, name: raw };
}

function validateValue(raw: unknown): { ok: true; value: string } | { ok: false; err: HandlerResult } {
  if (typeof raw !== 'string') {
    return { ok: false, err: bad('missing field: value') };
  }
  if (raw.length === 0) {
    return { ok: false, err: bad('value must be non-empty') };
  }
  // Byte length (utf8) — string.length counts code units, not bytes.
  const bytes = Buffer.byteLength(raw, 'utf8');
  if (bytes > MAX_VALUE_BYTES) {
    return { ok: false, err: bad('value too large') };
  }
  return { ok: true, value: raw };
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export const listHandler: Handler = async () => {
  const vault = Vault.open();
  try {
    const rows = vault.list();
    const listing = rows.map((r) => ({
      name: r.name,
      pseudokey: r.pseudokey,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
    return { status: 200, json: listing };
  } finally {
    vault.close();
  }
};

export const createHandler: Handler = async (_req, body) => {
  if (!isPlainObject(body)) {
    return bad('missing JSON body');
  }
  const nameCheck = validateName(body.name);
  if (!nameCheck.ok) return nameCheck.err;
  const valueCheck = validateValue(body.value);
  if (!valueCheck.ok) return valueCheck.err;

  const vault = Vault.open();
  try {
    const { pseudokey, created } = vault.set(nameCheck.name, valueCheck.value);
    return {
      status: created ? 201 : 200,
      json: { name: nameCheck.name, pseudokey, created },
    };
  } finally {
    vault.close();
  }
};

export const updateHandler: Handler = async (_req, body, params) => {
  const nameCheck = validateName(params.name);
  if (!nameCheck.ok) return nameCheck.err;
  if (!isPlainObject(body)) {
    return bad('missing JSON body');
  }
  const valueCheck = validateValue(body.value);
  if (!valueCheck.ok) return valueCheck.err;

  const vault = Vault.open();
  try {
    if (vault.getPseudokey(nameCheck.name) === undefined) {
      return notFound(`secret not found: ${nameCheck.name}`);
    }
    const { pseudokey, created } = vault.set(nameCheck.name, valueCheck.value);
    // `created` should be false on the update path. If it somehow flipped true
    // (race: secret removed between check and set), still surface truthfully.
    return {
      status: 200,
      json: { pseudokey, created },
    };
  } finally {
    vault.close();
  }
};

export const deleteHandler: Handler = async (_req, _body, params) => {
  const nameCheck = validateName(params.name);
  if (!nameCheck.ok) return nameCheck.err;

  const vault = Vault.open();
  try {
    const removed = vault.remove(nameCheck.name);
    if (!removed) {
      return notFound(`secret not found: ${nameCheck.name}`);
    }
    return { status: 200, json: { removed: true } };
  } finally {
    vault.close();
  }
};

export const secretsRoutes: Route[] = [
  { method: 'GET',    path: '/api/secrets',       handler: listHandler },
  { method: 'POST',   path: '/api/secrets',       handler: createHandler },
  { method: 'PUT',    path: '/api/secrets/:name', handler: updateHandler },
  { method: 'DELETE', path: '/api/secrets/:name', handler: deleteHandler },
];
