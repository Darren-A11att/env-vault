// Unit tests for B1 (CRUD) handlers — exercises each handler as a pure
// function against a scratch vault. No server, no router.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';

// Isolate HOME + keyring before loading any vault / identity code.
const scratchHome = mkdtempSync(join(tmpdir(), `envault-b1-${process.pid}-`));
const scratchSsh = join(scratchHome, '.ssh');
const scratchEnvaultHome = join(scratchHome, '.envault');

process.env.HOME = scratchHome;
process.env.ENVAULT_SSH_DIR = scratchSsh;
process.env.ENVAULT_HOME = scratchEnvaultHome;
process.env.ENVAULT_KEYRING_SERVICE = `envault-b1-${process.pid}`;

const { generateIdentity } = await import('../src/identity.ts');
const { setKeychainBackend, MemoryKeychainBackend } = await import('../src/identity-cache.ts');
const { Vault } = await import('../src/vault.ts');
const {
  listHandler,
  createHandler,
  updateHandler,
  deleteHandler,
} = await import('../src/ui/handlers/secrets.ts');

setKeychainBackend(new MemoryKeychainBackend());

before(() => {
  generateIdentity();
});

after(() => {
  rmSync(scratchHome, { recursive: true, force: true });
});

beforeEach(() => {
  // Wipe any secrets between tests so each assertion starts from empty state.
  const v = Vault.open();
  try {
    for (const row of v.list()) v.remove(row.name);
  } finally {
    v.close();
  }
});

function makeReq(method: string, url: string): IncomingMessage {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.method = method;
  req.url = url;
  return req;
}

test('GET /api/secrets returns empty array on fresh vault', async () => {
  const res = await listHandler(makeReq('GET', '/api/secrets'), undefined, {});
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, []);
});

test('POST /api/secrets creates a new secret', async () => {
  const res = await createHandler(
    makeReq('POST', '/api/secrets'),
    { name: 'FOO', value: 'bar' },
    {},
  );
  assert.ok(res.status === 200 || res.status === 201, `status was ${res.status}`);
  const body = res.json as { name: string; pseudokey: string; created: boolean };
  assert.equal(body.name, 'FOO');
  assert.match(body.pseudokey, /^envault-[0-9a-f]{8}$/);
  assert.equal(body.created, true);
});

test('POST /api/secrets on existing name returns created: false', async () => {
  await createHandler(makeReq('POST', '/api/secrets'), { name: 'FOO', value: 'one' }, {});
  const res = await createHandler(
    makeReq('POST', '/api/secrets'),
    { name: 'FOO', value: 'two' },
    {},
  );
  const body = res.json as { name: string; pseudokey: string; created: boolean };
  assert.equal(body.created, false);
  assert.equal(body.name, 'FOO');
  assert.match(body.pseudokey, /^envault-[0-9a-f]{8}$/);
});

test('POST /api/secrets rejects invalid name (starts with digit)', async () => {
  const res = await createHandler(
    makeReq('POST', '/api/secrets'),
    { name: '1FOO', value: 'bar' },
    {},
  );
  assert.equal(res.status, 400);
  const body = res.json as { error: string };
  assert.match(body.error, /invalid name/);
});

test('POST /api/secrets rejects empty value', async () => {
  const res = await createHandler(
    makeReq('POST', '/api/secrets'),
    { name: 'FOO', value: '' },
    {},
  );
  assert.equal(res.status, 400);
  const body = res.json as { error: string };
  assert.match(body.error, /value/i);
});

test('POST /api/secrets rejects missing value', async () => {
  const res = await createHandler(
    makeReq('POST', '/api/secrets'),
    { name: 'FOO' },
    {},
  );
  assert.equal(res.status, 400);
});

test('POST /api/secrets rejects missing name', async () => {
  const res = await createHandler(
    makeReq('POST', '/api/secrets'),
    { value: 'bar' },
    {},
  );
  assert.equal(res.status, 400);
});

test('POST /api/secrets rejects value > 1 MiB', async () => {
  const oversized = 'a'.repeat(1024 * 1024 + 1);
  const res = await createHandler(
    makeReq('POST', '/api/secrets'),
    { name: 'FOO', value: oversized },
    {},
  );
  assert.equal(res.status, 400);
  const body = res.json as { error: string };
  assert.match(body.error, /too large/);
});

test('POST /api/secrets accepts value of exactly 1 MiB', async () => {
  const exact = 'a'.repeat(1024 * 1024);
  const res = await createHandler(
    makeReq('POST', '/api/secrets'),
    { name: 'BIG_OK', value: exact },
    {},
  );
  assert.ok(res.status === 200 || res.status === 201, `expected 2xx, got ${res.status}`);
});

test('POST /api/secrets rejects missing body', async () => {
  const res = await createHandler(makeReq('POST', '/api/secrets'), undefined, {});
  assert.equal(res.status, 400);
});

test('GET /api/secrets after POST returns the added secret (no value)', async () => {
  await createHandler(
    makeReq('POST', '/api/secrets'),
    { name: 'GREETING', value: 'hello' },
    {},
  );
  const res = await listHandler(makeReq('GET', '/api/secrets'), undefined, {});
  assert.equal(res.status, 200);
  const body = res.json as Array<Record<string, unknown>>;
  assert.equal(body.length, 1);
  const row = body[0];
  assert.equal(row.name, 'GREETING');
  assert.match(row.pseudokey as string, /^envault-[0-9a-f]{8}$/);
  assert.equal(typeof row.created_at, 'number');
  assert.equal(typeof row.updated_at, 'number');
  // CRITICAL: no decrypted value may leak.
  assert.equal('value' in row, false);
  assert.equal('ciphertext' in row, false);
});

test('PUT /api/secrets/:name updates existing secret', async () => {
  await createHandler(
    makeReq('POST', '/api/secrets'),
    { name: 'FOO', value: 'original' },
    {},
  );
  const res = await updateHandler(
    makeReq('PUT', '/api/secrets/FOO'),
    { value: 'new' },
    { name: 'FOO' },
  );
  assert.equal(res.status, 200);
  const body = res.json as { pseudokey: string; created: boolean };
  assert.match(body.pseudokey, /^envault-[0-9a-f]{8}$/);
  assert.equal(body.created, false);
});

test('PUT /api/secrets/:name returns 404 for unknown name', async () => {
  const res = await updateHandler(
    makeReq('PUT', '/api/secrets/DOES_NOT_EXIST'),
    { value: 'new' },
    { name: 'DOES_NOT_EXIST' },
  );
  assert.equal(res.status, 404);
});

test('PUT /api/secrets/:name rejects invalid param name', async () => {
  const res = await updateHandler(
    makeReq('PUT', '/api/secrets/1BAD'),
    { value: 'x' },
    { name: '1BAD' },
  );
  assert.equal(res.status, 400);
});

test('PUT /api/secrets/:name rejects empty value', async () => {
  await createHandler(makeReq('POST', '/api/secrets'), { name: 'FOO', value: 'x' }, {});
  const res = await updateHandler(
    makeReq('PUT', '/api/secrets/FOO'),
    { value: '' },
    { name: 'FOO' },
  );
  assert.equal(res.status, 400);
});

test('DELETE /api/secrets/:name removes secret', async () => {
  await createHandler(makeReq('POST', '/api/secrets'), { name: 'FOO', value: 'x' }, {});
  const res = await deleteHandler(
    makeReq('DELETE', '/api/secrets/FOO'),
    undefined,
    { name: 'FOO' },
  );
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { removed: true });
  // Confirm it's gone.
  const after = await listHandler(makeReq('GET', '/api/secrets'), undefined, {});
  assert.deepEqual(after.json, []);
});

test('DELETE /api/secrets/:name returns 404 when missing', async () => {
  const res = await deleteHandler(
    makeReq('DELETE', '/api/secrets/GONE'),
    undefined,
    { name: 'GONE' },
  );
  assert.equal(res.status, 404);
});

test('DELETE /api/secrets/:name rejects invalid param name', async () => {
  const res = await deleteHandler(
    makeReq('DELETE', '/api/secrets/9NOPE'),
    undefined,
    { name: '9NOPE' },
  );
  assert.equal(res.status, 400);
});
