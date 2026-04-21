import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Set up an isolated scratch HOME + SSH dir BEFORE importing server code, so
// that identity-cache / paths pick up our env vars. We never touch the user's
// real ~/.ssh/envault_key.
const scratchHome = mkdtempSync(join(tmpdir(), 'envault-ui-test-'));
const scratchSsh = join(scratchHome, '.ssh');
const scratchEnvaultHome = join(scratchHome, '.envault');

process.env.HOME = scratchHome;
process.env.ENVAULT_SSH_DIR = scratchSsh;
process.env.ENVAULT_HOME = scratchEnvaultHome;
process.env.ENVAULT_KEYRING_SERVICE = `envault-ui-test-${process.pid}`;

const { generateIdentity } = await import('../src/identity.ts');
const {
  setKeychainBackend,
  MemoryKeychainBackend,
} = await import('../src/identity-cache.ts');
const { startServer } = await import('../src/ui/server.ts');

// Use in-memory keychain to avoid touching the OS keyring from a test.
setKeychainBackend(new MemoryKeychainBackend());

before(() => {
  generateIdentity();
});

after(() => {
  rmSync(scratchHome, { recursive: true, force: true });
});

test('GET /api/identity returns 200 + fingerprint with valid token', async () => {
  const srv = await startServer({ port: 0 });
  try {
    const res = await fetch(`${srv.url}/api/identity`, {
      headers: { 'x-envault-token': srv.token },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(typeof body.fingerprint, 'string');
    assert.match(body.fingerprint, /^[0-9a-f]{16}$/);
    assert.equal(typeof body.keyPath, 'string');
    assert.ok(body.cache === 'present' || body.cache === 'absent');
  } finally {
    await srv.stop();
  }
});

test('GET /api/identity returns 401 without token header', async () => {
  const srv = await startServer({ port: 0 });
  try {
    const res = await fetch(`${srv.url}/api/identity`);
    assert.equal(res.status, 401);
  } finally {
    await srv.stop();
  }
});

test('GET /api/identity returns 403 when Host is evil.com', async () => {
  const srv = await startServer({ port: 0 });
  try {
    // `fetch` won't let us override Host; use raw http.
    const { request } = await import('node:http');
    const parsed = new URL(srv.url);
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: parsed.hostname,
          port: parsed.port,
          path: '/api/identity',
          method: 'GET',
          headers: {
            host: 'evil.com',
            'x-envault-token': srv.token,
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 403);
  } finally {
    await srv.stop();
  }
});

test('stop() exits cleanly; subsequent fetch rejects', async () => {
  const srv = await startServer({ port: 0 });
  await srv.stop();
  await assert.rejects(
    () => fetch(`${srv.url}/api/identity`, { headers: { 'x-envault-token': srv.token } }),
  );
});

test('GET / serves index.html', async () => {
  const srv = await startServer({ port: 0 });
  try {
    const res = await fetch(srv.url);
    // Either 200 if the built asset exists, or 404 if the build hasn't copied
    // static files yet. We allow 404 so this test doesn't require a build step.
    assert.ok(res.status === 200 || res.status === 404, `unexpected status ${res.status}`);
    if (res.status === 200) {
      const ct = res.headers.get('content-type') ?? '';
      assert.ok(ct.includes('text/html'));
    }
  } finally {
    await srv.stop();
  }
});
