import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  installInterceptor,
  uninstallInterceptor,
  rewriteRequest,
  type Resolver,
} from '../src/interceptor/fetch.ts';
import { buildStaticResolver } from '../src/interceptor/sync-resolver.ts';

const TOKEN = 'envault-abcd1234';
const REAL = 'sk-real-value';

const resolver: Resolver = buildStaticResolver({ [TOKEN]: REAL });

test('rewriteRequest substitutes pseudokey in URL query string (GET)', () => {
  const req = new Request(`https://example.com/path?token=${TOKEN}&other=plain`);
  const rewritten = rewriteRequest(req, resolver);
  const url = new URL(rewritten.url);
  assert.equal(url.searchParams.get('token'), REAL);
  assert.equal(url.searchParams.get('other'), 'plain');
  assert.notEqual(rewritten, req); // new instance because URL changed
});

test('rewriteRequest substitutes pseudokey in headers', () => {
  const req = new Request('https://example.com/', {
    headers: { 'x-api-key': TOKEN, 'user-agent': 'tester' },
  });
  const rewritten = rewriteRequest(req, resolver);
  assert.equal(rewritten.headers.get('x-api-key'), REAL);
  assert.equal(rewritten.headers.get('user-agent'), 'tester');
});

test('rewriteRequest substitutes embedded pseudokey in a header value', () => {
  const req = new Request('https://example.com/', {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  const rewritten = rewriteRequest(req, resolver);
  assert.equal(rewritten.headers.get('authorization'), `Bearer ${REAL}`);
});

test('rewriteRequest returns same instance when nothing matches', () => {
  const req = new Request('https://example.com/?foo=bar', {
    headers: { 'x-api-key': 'plain-key' },
  });
  const rewritten = rewriteRequest(req, resolver);
  assert.equal(rewritten, req);
});

test('rewriteRequest leaves unknown pseudokeys untouched', () => {
  const unknown = 'envault-deadbeef';
  const req = new Request('https://example.com/', {
    headers: { 'x-api-key': unknown },
  });
  const rewritten = rewriteRequest(req, resolver);
  // Same instance because substitute() maps unresolvable → self (no change).
  assert.equal(rewritten, req);
  assert.equal(rewritten.headers.get('x-api-key'), unknown);
});

test('rewriteRequest preserves method, redirect, signal on rewritten request', async () => {
  const controller = new AbortController();
  const req = new Request('https://example.com/', {
    method: 'POST',
    headers: { 'x-api-key': TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({ hello: 'world' }),
    redirect: 'error',
    signal: controller.signal,
  });
  const rewritten = rewriteRequest(req, resolver);
  assert.equal(rewritten.method, 'POST');
  assert.equal(rewritten.redirect, 'error');
  // Signal carries through (same controller aborts the rewritten request).
  assert.equal(rewritten.signal.aborted, false);
  controller.abort();
  assert.equal(rewritten.signal.aborted, true);
  // Body is preserved (not scanned, just passed through).
  const bodyText = await rewritten.text();
  assert.equal(bodyText, '{"hello":"world"}');
});

test('installInterceptor patches globalThis.fetch and substitutes header values', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Request[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request && !init ? input : new Request(input as RequestInfo, init);
    calls.push(req);
    return new Response('ok');
  }) as typeof fetch;

  try {
    installInterceptor(resolver);
    await globalThis.fetch('https://example.com/', {
      headers: { 'x-api-key': TOKEN },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers.get('x-api-key'), REAL);
  } finally {
    uninstallInterceptor();
    globalThis.fetch = originalFetch;
  }
});

test('installInterceptor is idempotent', async () => {
  const originalFetch = globalThis.fetch;
  const stub = (async () => new Response('stub')) as typeof fetch;
  globalThis.fetch = stub;

  try {
    installInterceptor(resolver);
    const firstWrap = globalThis.fetch;
    assert.notEqual(firstWrap, stub);
    installInterceptor(resolver); // second call should be a no-op
    assert.equal(globalThis.fetch, firstWrap);
  } finally {
    uninstallInterceptor();
    globalThis.fetch = originalFetch;
  }
});

test('uninstallInterceptor restores the original fetch', async () => {
  const originalFetch = globalThis.fetch;
  const stub = (async () => new Response('stub')) as typeof fetch;
  globalThis.fetch = stub;

  try {
    installInterceptor(resolver);
    assert.notEqual(globalThis.fetch, stub);
    uninstallInterceptor();
    assert.equal(globalThis.fetch, stub);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fail-open: resolver that throws falls through to original fetch', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<RequestInfo | URL> = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(input);
    return new Response('ok');
  }) as typeof fetch;

  const throwingResolver: Resolver = () => {
    throw new Error('resolver boom');
  };

  try {
    installInterceptor(throwingResolver);
    // Must not throw — must still reach the original fetch.
    const res = await globalThis.fetch('https://example.com/', {
      headers: { 'x-api-key': TOKEN },
    });
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
  } finally {
    uninstallInterceptor();
    globalThis.fetch = originalFetch;
  }
});

test('buildStaticResolver returns undefined for unknown keys', () => {
  const r = buildStaticResolver({ [TOKEN]: REAL });
  assert.equal(r(TOKEN), REAL);
  assert.equal(r('envault-unknown1'), undefined);
});
