import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { createRouter, type Handler } from '../src/ui/router.ts';

function makeReq(opts: {
  method: string;
  url: string;
  headers?: Record<string, string>;
}): IncomingMessage {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.method = opts.method;
  req.url = opts.url;
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    req.headers[k.toLowerCase()] = v;
  }
  return req;
}

const TOKEN = 'a'.repeat(64);

function dummyHandler(label: string): Handler {
  return async (_req, _body, params) => ({
    status: 200,
    json: { label, params },
  });
}

test('router matches GET /api/identity', async () => {
  const router = createRouter({
    token: TOKEN,
    routes: [
      { method: 'GET', path: '/api/identity', handler: dummyHandler('identity') },
    ],
  });
  const req = makeReq({
    method: 'GET',
    url: '/api/identity',
    headers: {
      'x-envault-token': TOKEN,
      host: '127.0.0.1:12345',
    },
  });
  const res = await router.dispatch(req, undefined);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { label: 'identity', params: {} });
});

test('router returns 404 on method mismatch', async () => {
  const router = createRouter({
    token: TOKEN,
    routes: [
      { method: 'GET', path: '/api/identity', handler: dummyHandler('identity') },
    ],
  });
  const req = makeReq({
    method: 'POST',
    url: '/api/identity',
    headers: {
      'x-envault-token': TOKEN,
      host: '127.0.0.1:12345',
    },
  });
  const res = await router.dispatch(req, undefined);
  assert.equal(res.status, 404);
});

test('router extracts path parameters', async () => {
  const router = createRouter({
    token: TOKEN,
    routes: [
      { method: 'GET', path: '/api/secrets/:name', handler: dummyHandler('secret') },
    ],
  });
  const req = makeReq({
    method: 'GET',
    url: '/api/secrets/DATABASE_URL',
    headers: {
      'x-envault-token': TOKEN,
      host: '127.0.0.1:12345',
    },
  });
  const res = await router.dispatch(req, undefined);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { label: 'secret', params: { name: 'DATABASE_URL' } });
});

test('router returns 401 when x-envault-token header is missing', async () => {
  const router = createRouter({
    token: TOKEN,
    routes: [
      { method: 'GET', path: '/api/identity', handler: dummyHandler('identity') },
    ],
  });
  const req = makeReq({
    method: 'GET',
    url: '/api/identity',
    headers: {
      host: '127.0.0.1:12345',
    },
  });
  const res = await router.dispatch(req, undefined);
  assert.equal(res.status, 401);
});

test('router returns 401 when token is wrong', async () => {
  const router = createRouter({
    token: TOKEN,
    routes: [
      { method: 'GET', path: '/api/identity', handler: dummyHandler('identity') },
    ],
  });
  const req = makeReq({
    method: 'GET',
    url: '/api/identity',
    headers: {
      'x-envault-token': 'b'.repeat(64),
      host: '127.0.0.1:12345',
    },
  });
  const res = await router.dispatch(req, undefined);
  assert.equal(res.status, 401);
});

test('router returns 403 when host is not localhost', async () => {
  const router = createRouter({
    token: TOKEN,
    routes: [
      { method: 'GET', path: '/api/identity', handler: dummyHandler('identity') },
    ],
  });
  const req = makeReq({
    method: 'GET',
    url: '/api/identity',
    headers: {
      'x-envault-token': TOKEN,
      host: 'evil.com',
    },
  });
  const res = await router.dispatch(req, undefined);
  assert.equal(res.status, 403);
});

test('router returns 404 for unknown route', async () => {
  const router = createRouter({
    token: TOKEN,
    routes: [
      { method: 'GET', path: '/api/identity', handler: dummyHandler('identity') },
    ],
  });
  const req = makeReq({
    method: 'GET',
    url: '/api/nope',
    headers: {
      'x-envault-token': TOKEN,
      host: '127.0.0.1:12345',
    },
  });
  const res = await router.dispatch(req, undefined);
  assert.equal(res.status, 404);
});
