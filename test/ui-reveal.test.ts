// B2 (reveal slice) — integration + unit tests for the reveal flow.
//
// Contract (frozen, per src/ui/README.md):
//   POST /api/reveal/nonce  → { nonce, expiresAt }
//   POST /api/reveal        ← { name, nonce } → { value }
//
// Note: the freelance-spec for B2 references `POST /api/reveal-nonce` and
// `POST /api/secrets/:name/reveal` — but the frozen README wins. These tests
// drive the README paths.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Scratch HOME sandbox. MUST happen before any src/* import that reads paths.
const scratchHome = mkdtempSync(join(tmpdir(), 'envault-ui-reveal-test-'));
const scratchSsh = join(scratchHome, '.ssh');
const scratchEnvaultHome = join(scratchHome, '.envault');

process.env.HOME = scratchHome;
process.env.ENVAULT_SSH_DIR = scratchSsh;
process.env.ENVAULT_HOME = scratchEnvaultHome;
process.env.ENVAULT_KEYRING_SERVICE = `envault-ui-reveal-test-${process.pid}`;

const { generateIdentity } = await import('../src/identity.ts');
const { setKeychainBackend, MemoryKeychainBackend } = await import(
  '../src/identity-cache.ts'
);
const { Vault } = await import('../src/vault.ts');
const { startServer } = await import('../src/ui/server.ts');
const { __resetRateLimiter, revealHandler, createMintNonceHandler } =
  await import('../src/ui/handlers/reveal.ts');
const { mintNonce, __createNonceStore } = await import('../src/ui/auth.ts');

setKeychainBackend(new MemoryKeychainBackend());

before(() => {
  generateIdentity();
  const v = Vault.open();
  try {
    v.set('FOO', 'real-value');
    v.set('BAR', 'bar-value');
  } finally {
    v.close();
  }
});

after(() => {
  rmSync(scratchHome, { recursive: true, force: true });
});

// --- helpers ---

async function startSrv() {
  __resetRateLimiter();
  return startServer({ port: 0 });
}

async function mintNonceApi(
  srv: { url: string; token: string },
): Promise<{ status: number; body: { nonce?: string; expiresAt?: number; error?: string } }> {
  const res = await fetch(`${srv.url}/api/reveal/nonce`, {
    method: 'POST',
    headers: {
      'x-envault-token': srv.token,
      'content-type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function revealApi(
  srv: { url: string; token: string },
  payload: unknown,
  opts: { contentType?: string; rawBody?: string } = {},
): Promise<{ status: number; body: { value?: string; error?: string } }> {
  const res = await fetch(`${srv.url}/api/reveal`, {
    method: 'POST',
    headers: {
      'x-envault-token': srv.token,
      'content-type': opts.contentType ?? 'application/json',
    },
    body: opts.rawBody ?? JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// --- tests ---

test('POST /api/reveal/nonce returns nonce + expiresAt >= now+9s', async () => {
  const srv = await startSrv();
  try {
    const t0 = Date.now();
    const { status, body } = await mintNonceApi(srv);
    assert.equal(status, 200);
    assert.equal(typeof body.nonce, 'string');
    assert.match(body.nonce!, /^[0-9a-f]+$/);
    assert.equal(typeof body.expiresAt, 'number');
    assert.ok(
      body.expiresAt! >= t0 + 9_000,
      `expiresAt ${body.expiresAt} should be >= ${t0 + 9_000}`,
    );
  } finally {
    await srv.stop();
  }
});

test('POST /api/reveal with fresh nonce returns the plaintext value', async () => {
  const srv = await startSrv();
  try {
    const { body: n } = await mintNonceApi(srv);
    const { status, body } = await revealApi(srv, {
      name: 'FOO',
      nonce: n.nonce,
    });
    assert.equal(status, 200);
    assert.equal(body.value, 'real-value');
  } finally {
    await srv.stop();
  }
});

test('same nonce used twice → second reveal is 401 (single-use)', async () => {
  const srv = await startSrv();
  try {
    const { body: n } = await mintNonceApi(srv);
    const a = await revealApi(srv, { name: 'FOO', nonce: n.nonce });
    assert.equal(a.status, 200);
    const b = await revealApi(srv, { name: 'FOO', nonce: n.nonce });
    assert.equal(b.status, 401);
    assert.match(b.body.error ?? '', /invalid|expired/i);
  } finally {
    await srv.stop();
  }
});

test('invalid / unknown nonce → 401', async () => {
  const srv = await startSrv();
  try {
    const { status, body } = await revealApi(srv, {
      name: 'FOO',
      nonce: 'deadbeef'.repeat(6),
    });
    assert.equal(status, 401);
    assert.match(body.error ?? '', /invalid|expired/i);
  } finally {
    await srv.stop();
  }
});

test('missing nonce field → 400', async () => {
  const srv = await startSrv();
  try {
    const { status, body } = await revealApi(srv, { name: 'FOO' });
    assert.equal(status, 400);
    assert.match(body.error ?? '', /nonce/i);
  } finally {
    await srv.stop();
  }
});

test('missing name field → 400', async () => {
  const srv = await startSrv();
  try {
    const { body: n } = await mintNonceApi(srv);
    const { status, body } = await revealApi(srv, { nonce: n.nonce });
    assert.equal(status, 400);
    assert.match(body.error ?? '', /name/i);
  } finally {
    await srv.stop();
  }
});

test('invalid (non-JSON) body → 400', async () => {
  const srv = await startSrv();
  try {
    // Send text/plain so the server tries to treat it as unparsed; or send
    // broken JSON under application/json so readJsonBody throws.
    const res = await fetch(`${srv.url}/api/reveal`, {
      method: 'POST',
      headers: {
        'x-envault-token': srv.token,
        'content-type': 'application/json',
      },
      body: 'not-valid-json{',
    });
    assert.equal(res.status, 400);
  } finally {
    await srv.stop();
  }
});

test('nonexistent secret + valid nonce → 404 AND nonce is NOT consumed', async () => {
  const srv = await startSrv();
  try {
    const { body: n } = await mintNonceApi(srv);
    const a = await revealApi(srv, { name: 'DOES_NOT_EXIST', nonce: n.nonce });
    assert.equal(a.status, 404);
    // The nonce should still be valid — the user didn't receive a value,
    // so a 404 probe cannot exhaust their nonces.
    const b = await revealApi(srv, { name: 'FOO', nonce: n.nonce });
    assert.equal(b.status, 200);
    assert.equal(b.body.value, 'real-value');
  } finally {
    await srv.stop();
  }
});

test('rate limit: 11th nonce request within a minute → 429', async () => {
  const srv = await startSrv();
  try {
    for (let i = 0; i < 10; i++) {
      const { status } = await mintNonceApi(srv);
      assert.equal(status, 200, `call ${i + 1}/10 should succeed`);
    }
    const { status, body } = await mintNonceApi(srv);
    assert.equal(status, 429);
    assert.match(body.error ?? '', /rate limit/i);
  } finally {
    await srv.stop();
  }
});

test('rate-limit window slides: injected clock allows 11th after 60s', async () => {
  // Use the handler factory directly with an injected clock so we don't have
  // to wait a real minute in tests. Exercises the sliding-window prune path.
  let now = 1_000_000;
  const mint = createMintNonceHandler({ now: () => now });
  __resetRateLimiter();
  // token string is arbitrary — the handler reads it from req.headers.
  const fakeReq = {
    headers: { 'x-envault-token': 'TESTTOKEN' },
  } as unknown as Parameters<typeof mint>[0];
  for (let i = 0; i < 10; i++) {
    const r = await mint(fakeReq, undefined, {});
    assert.equal(r.status, 200);
    now += 1; // advance 1ms between mints
  }
  const blocked = await mint(fakeReq, undefined, {});
  assert.equal(blocked.status, 429);
  now += 60_001;
  const ok = await mint(fakeReq, undefined, {});
  assert.equal(ok.status, 200);
});

test('__createNonceStore with injected clock: expired nonce is rejected', () => {
  // Defence in depth: the auth-layer store rejects expired nonces. This is
  // already covered by test/ui-auth.test.ts, but we assert it again here to
  // pin the reveal flow's security invariant.
  let now = 1_000_000;
  const store = __createNonceStore({ now: () => now, ttlMs: 10_000 });
  const n = store.mint();
  now += 10_001;
  assert.equal(store.consume(n), false);
});

test('reveal handler unit: passphrase-locked identity → 503', async () => {
  // We can't easily mint a real encrypted key in-test, so drive the handler's
  // error-translation path through a monkey-patched Vault. Keeps coverage of
  // the catch-branch without leaking a fake vault beyond this test.
  const { revealHandler: _rh } = await import('../src/ui/handlers/reveal.ts');
  // Mint a fresh, valid nonce in the default store so the handler sees it.
  const validNonce = mintNonce();
  // A secret named 'EXISTS_PASSPHRASE_TEST' exists (we set it here) so the
  // pre-consume existence check passes; the thrown decrypt error then drives
  // the 503 translation.
  const v = Vault.open();
  try {
    v.set('PW_PROBE', 'never-revealed');
  } finally {
    v.close();
  }
  // Force vault.get to throw a "passphrase" error by temporarily monkey
  // patching Vault.prototype.get.
  const orig = Vault.prototype.get;
  (Vault.prototype as unknown as { get: (n: string) => Promise<string> }).get =
    async function () {
      throw new Error('SSH key is passphrase-protected and no TTY is available');
    };
  try {
    const req = {
      headers: { 'x-envault-token': 'T' },
    } as unknown as Parameters<typeof _rh>[0];
    const res = await _rh(req, { name: 'PW_PROBE', nonce: validNonce }, {});
    assert.equal(res.status, 503);
    const j = res.json as { error: string };
    assert.match(j.error, /identity locked|passphrase|unlock/i);
  } finally {
    (Vault.prototype as unknown as { get: typeof orig }).get = orig;
  }
});
