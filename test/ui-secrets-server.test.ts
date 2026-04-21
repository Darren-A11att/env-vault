// Integration tests for B1 CRUD — spins up a real server, exercises the
// endpoints with `fetch`, verifies contract and no-value-leak invariants.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate HOME + keyring before loading any server code.
const scratchHome = mkdtempSync(join(tmpdir(), `envault-b1-srv-${process.pid}-`));
const scratchSsh = join(scratchHome, '.ssh');
const scratchEnvaultHome = join(scratchHome, '.envault');

process.env.HOME = scratchHome;
process.env.ENVAULT_SSH_DIR = scratchSsh;
process.env.ENVAULT_HOME = scratchEnvaultHome;
process.env.ENVAULT_KEYRING_SERVICE = `envault-b1-srv-${process.pid}`;

const { generateIdentity } = await import('../src/identity.ts');
const { setKeychainBackend, MemoryKeychainBackend } = await import('../src/identity-cache.ts');
const { Vault } = await import('../src/vault.ts');
const { startServer } = await import('../src/ui/server.ts');

setKeychainBackend(new MemoryKeychainBackend());

before(() => {
  generateIdentity();
});

after(() => {
  rmSync(scratchHome, { recursive: true, force: true });
});

beforeEach(() => {
  const v = Vault.open();
  try {
    for (const row of v.list()) v.remove(row.name);
  } finally {
    v.close();
  }
});

async function withServer<T>(fn: (srv: { url: string; token: string }) => Promise<T>): Promise<T> {
  const srv = await startServer({ port: 0 });
  try {
    return await fn(srv);
  } finally {
    await srv.stop();
  }
}

test('GET /api/secrets returns [] on fresh vault', async () => {
  await withServer(async (srv) => {
    const res = await fetch(`${srv.url}/api/secrets`, {
      headers: { 'x-envault-token': srv.token },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, []);
  });
});

test('GET /api/secrets requires token', async () => {
  await withServer(async (srv) => {
    const res = await fetch(`${srv.url}/api/secrets`);
    assert.equal(res.status, 401);
  });
});

test('POST /api/secrets creates then round-trips via GET (no value leaked)', async () => {
  await withServer(async (srv) => {
    const post = await fetch(`${srv.url}/api/secrets`, {
      method: 'POST',
      headers: {
        'x-envault-token': srv.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'API_KEY', value: 'sk-test-42' }),
    });
    assert.ok(post.status === 200 || post.status === 201, `POST status ${post.status}`);
    const postBody = await post.json();
    assert.equal(postBody.name, 'API_KEY');
    assert.match(postBody.pseudokey, /^envault-[0-9a-f]{8}$/);
    assert.equal(postBody.created, true);

    const list = await fetch(`${srv.url}/api/secrets`, {
      headers: { 'x-envault-token': srv.token },
    });
    assert.equal(list.status, 200);
    const rows = await list.json();
    assert.equal(Array.isArray(rows), true);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.name, 'API_KEY');
    assert.match(row.pseudokey, /^envault-[0-9a-f]{8}$/);
    // CRITICAL: value must never be echoed.
    assert.equal('value' in row, false);
    assert.equal('ciphertext' in row, false);
  });
});

test('POST /api/secrets with invalid name returns 400', async () => {
  await withServer(async (srv) => {
    const res = await fetch(`${srv.url}/api/secrets`, {
      method: 'POST',
      headers: {
        'x-envault-token': srv.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: '1BAD', value: 'x' }),
    });
    assert.equal(res.status, 400);
  });
});

test('POST /api/secrets with 2 MiB body is rejected with 400', async () => {
  await withServer(async (srv) => {
    const huge = 'a'.repeat(2 * 1024 * 1024);
    const res = await fetch(`${srv.url}/api/secrets`, {
      method: 'POST',
      headers: {
        'x-envault-token': srv.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'BIG', value: huge }),
    });
    assert.equal(res.status, 400);
  });
});

test('PUT /api/secrets/:name updates existing', async () => {
  await withServer(async (srv) => {
    await fetch(`${srv.url}/api/secrets`, {
      method: 'POST',
      headers: { 'x-envault-token': srv.token, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'FOO', value: 'one' }),
    });
    const put = await fetch(`${srv.url}/api/secrets/FOO`, {
      method: 'PUT',
      headers: { 'x-envault-token': srv.token, 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'two' }),
    });
    assert.equal(put.status, 200);
    const body = await put.json();
    assert.match(body.pseudokey, /^envault-[0-9a-f]{8}$/);
    assert.equal(body.created, false);
  });
});

test('PUT /api/secrets/:name on unknown returns 404', async () => {
  await withServer(async (srv) => {
    const res = await fetch(`${srv.url}/api/secrets/NOPE`, {
      method: 'PUT',
      headers: { 'x-envault-token': srv.token, 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'x' }),
    });
    assert.equal(res.status, 404);
  });
});

test('DELETE /api/secrets/:name removes, second DELETE is 404', async () => {
  await withServer(async (srv) => {
    await fetch(`${srv.url}/api/secrets`, {
      method: 'POST',
      headers: { 'x-envault-token': srv.token, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'GONE_SOON', value: 'bye' }),
    });
    const first = await fetch(`${srv.url}/api/secrets/GONE_SOON`, {
      method: 'DELETE',
      headers: { 'x-envault-token': srv.token },
    });
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { removed: true });

    const second = await fetch(`${srv.url}/api/secrets/GONE_SOON`, {
      method: 'DELETE',
      headers: { 'x-envault-token': srv.token },
    });
    assert.equal(second.status, 404);
  });
});
