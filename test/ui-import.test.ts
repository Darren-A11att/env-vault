// Tests for B3 (Import) — unit tests exercise the handler as a pure function
// against a scratch vault; the integration suite spins up a real server and
// round-trips through fetch.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';

// Isolate HOME + keyring before loading any vault / identity code.
const scratchHome = mkdtempSync(join(tmpdir(), `envault-b3-${process.pid}-`));
const scratchSsh = join(scratchHome, '.ssh');
const scratchEnvaultHome = join(scratchHome, '.envault');

process.env.HOME = scratchHome;
process.env.ENVAULT_SSH_DIR = scratchSsh;
process.env.ENVAULT_HOME = scratchEnvaultHome;
process.env.ENVAULT_KEYRING_SERVICE = `envault-b3-${process.pid}`;

const { generateIdentity } = await import('../src/identity.ts');
const { setKeychainBackend, MemoryKeychainBackend } = await import('../src/identity-cache.ts');
const { Vault } = await import('../src/vault.ts');
const { importHandler } = await import('../src/ui/handlers/import.ts');
const { startServer } = await import('../src/ui/server.ts');

setKeychainBackend(new MemoryKeychainBackend());

before(() => {
  generateIdentity();
});

after(() => {
  rmSync(scratchHome, { recursive: true, force: true });
});

beforeEach(() => {
  // Fresh state per test.
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

// ---- Gate 1: handler unit tests ----

test('POST /api/import with 3 valid entries imports all three', async () => {
  const envText = 'FOO=one\nBAR=two\nBAZ=three\n';
  const res = await importHandler(makeReq('POST', '/api/import'), { envText }, {});
  assert.equal(res.status, 200);
  const body = res.json as {
    imported: number;
    skipped: number;
    rejected: Array<{ name: string; reason: string }>;
    pseudokeys: Record<string, string>;
  };
  assert.equal(body.imported, 3);
  assert.equal(body.skipped, 0);
  assert.deepEqual(body.rejected, []);
  assert.equal(Object.keys(body.pseudokeys).length, 3);
  for (const name of ['FOO', 'BAR', 'BAZ']) {
    assert.match(body.pseudokeys[name], /^envault-[0-9a-f]{8}$/);
  }
});

test('POST /api/import NEVER leaks decrypted values in the response', async () => {
  const envText = 'SECRET_ONE=supersecretA\nSECRET_TWO=supersecretB\n';
  const res = await importHandler(makeReq('POST', '/api/import'), { envText }, {});
  assert.equal(res.status, 200);
  const serialized = JSON.stringify(res.json);
  assert.ok(!serialized.includes('supersecretA'), 'leaked value A');
  assert.ok(!serialized.includes('supersecretB'), 'leaked value B');
});

test('POST /api/import with empty envText → 400', async () => {
  const res = await importHandler(makeReq('POST', '/api/import'), { envText: '' }, {});
  assert.equal(res.status, 400);
});

test('POST /api/import with missing envText field → 400', async () => {
  const res = await importHandler(makeReq('POST', '/api/import'), {}, {});
  assert.equal(res.status, 400);
});

test('POST /api/import with missing body → 400', async () => {
  const res = await importHandler(makeReq('POST', '/api/import'), undefined, {});
  assert.equal(res.status, 400);
});

test('POST /api/import rejects envText > 512 KiB', async () => {
  // 512 KiB + 1 byte. We build it as a single valid-ish line so it's still
  // parseable up to the size check.
  const big = 'FOO=' + 'a'.repeat(512 * 1024);
  assert.ok(Buffer.byteLength(big, 'utf8') > 512 * 1024);
  const res = await importHandler(makeReq('POST', '/api/import'), { envText: big }, {});
  assert.equal(res.status, 400);
  const body = res.json as { error: string };
  assert.match(body.error, /too large|512/i);
});

test('POST /api/import rejects > 500 entries', async () => {
  // Build 501 short assignments — each line keeps the total under 512 KiB.
  const lines: string[] = [];
  for (let i = 0; i < 501; i++) {
    lines.push(`K${i}=v`);
  }
  const envText = lines.join('\n');
  assert.ok(Buffer.byteLength(envText, 'utf8') < 512 * 1024);
  const res = await importHandler(makeReq('POST', '/api/import'), { envText }, {});
  assert.equal(res.status, 400);
  const body = res.json as { error: string };
  assert.match(body.error, /too many|500/i);
});

test('POST /api/import skips entries whose value is already a pseudokey', async () => {
  // Pre-seed vault with a secret so we have a known pseudokey to reference.
  const v = Vault.open();
  const { pseudokey } = v.set('ALREADY', 'original');
  v.close();

  const envText = `NEW_ONE=fresh\nALREADY=${pseudokey}\nNEW_TWO=also\n`;
  const res = await importHandler(makeReq('POST', '/api/import'), { envText }, {});
  assert.equal(res.status, 200);
  const body = res.json as {
    imported: number;
    skipped: number;
    rejected: Array<unknown>;
    pseudokeys: Record<string, string>;
  };
  assert.equal(body.imported, 2);
  assert.equal(body.skipped, 1);
  assert.equal(body.rejected.length, 0);
  // Already-pseudokey entry passes through unchanged.
  assert.equal(body.pseudokeys.ALREADY, pseudokey);
  assert.match(body.pseudokeys.NEW_ONE, /^envault-[0-9a-f]{8}$/);
  assert.match(body.pseudokeys.NEW_TWO, /^envault-[0-9a-f]{8}$/);
});

test('POST /api/import rejects invalid names but imports the rest', async () => {
  const envText = '1BAD=x\nGOOD=y\n';
  const res = await importHandler(makeReq('POST', '/api/import'), { envText }, {});
  assert.equal(res.status, 200);
  const body = res.json as {
    imported: number;
    skipped: number;
    rejected: Array<{ name: string; reason: string }>;
    pseudokeys: Record<string, string>;
  };
  assert.equal(body.imported, 1);
  assert.equal(body.skipped, 0);
  assert.equal(body.rejected.length, 1);
  assert.equal(body.rejected[0].name, '1BAD');
  assert.match(body.rejected[0].reason, /invalid name/i);
  assert.match(body.pseudokeys.GOOD, /^envault-[0-9a-f]{8}$/);
  assert.ok(!('1BAD' in body.pseudokeys));
});

test('POST /api/import with unparseable garbage → 400 (no entries found)', async () => {
  // dotenv.parse is lenient and silently yields {} for binary/garbage. We
  // treat zero-entry parse results as "could not parse .env file" and return
  // 400. Documented behavior: stricter than dotenv's "empty-result" default.
  const garbage = '\x00\x01\x02\x03not really an env file';
  const res = await importHandler(makeReq('POST', '/api/import'), { envText: garbage }, {});
  assert.equal(res.status, 400);
  const body = res.json as { error: string };
  assert.match(body.error, /could not parse|parse/i);
});

test('POST /api/import actually upserts into the vault', async () => {
  const envText = 'CHECK_ME=the-real-value\n';
  const res = await importHandler(makeReq('POST', '/api/import'), { envText }, {});
  assert.equal(res.status, 200);
  const v = Vault.open();
  try {
    const stored = await v.get('CHECK_ME');
    assert.equal(stored, 'the-real-value');
  } finally {
    v.close();
  }
});

// ---- Gate 3: live server round-trip ----

async function withServer<T>(fn: (srv: { url: string; token: string }) => Promise<T>): Promise<T> {
  const srv = await startServer({ port: 0 });
  try {
    return await fn(srv);
  } finally {
    await srv.stop();
  }
}

test('integration: POST /api/import + GET /api/secrets round-trip', async () => {
  await withServer(async (srv) => {
    const envText = 'ALPHA=first-value\nBETA=second-value\n';
    const importRes = await fetch(`${srv.url}/api/import`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-envault-token': srv.token,
      },
      body: JSON.stringify({ envText }),
    });
    assert.equal(importRes.status, 200);
    const importBody = (await importRes.json()) as {
      imported: number;
      skipped: number;
      rejected: unknown[];
      pseudokeys: Record<string, string>;
    };
    assert.equal(importBody.imported, 2);
    assert.equal(importBody.skipped, 0);
    assert.equal(importBody.rejected.length, 0);
    assert.match(importBody.pseudokeys.ALPHA, /^envault-[0-9a-f]{8}$/);
    assert.match(importBody.pseudokeys.BETA, /^envault-[0-9a-f]{8}$/);

    // Response must not contain the plaintext values.
    const raw = JSON.stringify(importBody);
    assert.ok(!raw.includes('first-value'), 'leaked ALPHA value');
    assert.ok(!raw.includes('second-value'), 'leaked BETA value');

    // GET /api/secrets should now show both entries.
    const listRes = await fetch(`${srv.url}/api/secrets`, {
      headers: { 'x-envault-token': srv.token },
    });
    assert.equal(listRes.status, 200);
    const listBody = (await listRes.json()) as Array<{ name: string; pseudokey: string }>;
    const names = listBody.map((r) => r.name).sort();
    assert.deepEqual(names, ['ALPHA', 'BETA']);
    // The listing pseudokeys should match the import response.
    const byName = new Map(listBody.map((r) => [r.name, r.pseudokey]));
    assert.equal(byName.get('ALPHA'), importBody.pseudokeys.ALPHA);
    assert.equal(byName.get('BETA'), importBody.pseudokeys.BETA);
  });
});

test('integration: POST /api/import requires x-envault-token', async () => {
  await withServer(async (srv) => {
    const res = await fetch(`${srv.url}/api/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ envText: 'X=y' }),
    });
    assert.equal(res.status, 401);
  });
});
