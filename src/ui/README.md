# envault UI — frozen contract (Wave 1, A2)

This document freezes the server/router/auth contract that Wave 2 agents
(B1 CRUD, B2 reveal, B3 import) MUST build against. If you need to change
anything here, flag it in your hand-off — do not silently drift.

## Transport

- Server: pure Node `http`, no external deps.
- Bind: `127.0.0.1` only. Never expose on `0.0.0.0` or a LAN interface.
- Port: `startServer({ port })`; omit (or pass `0`) to let the OS pick.
- Auto-shutdown: 15 minute idle timer; resets on every request. `stop()` is
  always safe to call — idempotent.

## Authentication

- **Header**: `x-envault-token: <hex>`
- Token is 32 random bytes, rendered as 64 hex chars, minted once per
  `startServer()` call and embedded in the URL fragment (`#t=<token>`) that
  `envault ui` opens in the browser.
- Constant-time verification via `node:crypto.timingSafeEqual`.
- The token is required on **every `/api/*` request**. Static assets
  (`index.html`, `app.js`, `styles.css`, …) do NOT require the token — the
  browser needs to load them before it can read the fragment.
- The browser side is expected to call `window.envault.apiFetch(path, init)`
  (defined in `public/app.js`), which injects the header automatically.

## Host check (DNS-rebinding guard)

- `Host` header MUST be `127.0.0.1[:<port>]` or `localhost[:<port>]`.
- Anything else (including `0.0.0.0`, LAN IPs, hostnames that happen to
  resolve to loopback) returns **403** with `{error: 'forbidden host'}`.
- Applies to BOTH static and API routes.

## Response envelope

- API routes return a plain JSON body — a data object or array — directly.
  No `{data, error}` wrapper.
- Errors return `{error: string}` with the HTTP status encoding the kind:
  - `400` — bad request / body validation
  - `401` — missing or invalid `x-envault-token`
  - `403` — bad `Host` header
  - `404` — unknown route or missing named resource
  - `500` — unhandled server error
- On every response the server sets:
  - `Cache-Control: no-store`
  - `X-Content-Type-Options: nosniff`
  - `Content-Type: application/json; charset=utf-8` (API) or
    `text/html; charset=utf-8` (index) or the right mime for other static.

## Handler signature

```ts
type Handler = (
  req: IncomingMessage,
  body: unknown,                         // parsed JSON, or undefined
  params: Record<string, string>,        // from `/api/secrets/:name` etc.
) => Promise<{
  status: number;
  json?: unknown;                        // preferred
  text?: string;                         // if you must
  contentType?: string;                  // override default JSON CT
}>;
```

The router:

- Parses the body when `Content-Type: application/json` and the method is
  not GET/HEAD. Malformed JSON → 400 before the handler runs.
- Extracts `:param` segments from the registered path.
- Runs host-check, then token-check, then dispatches.
- Catches thrown errors from handlers and returns 500 with the error message.

## Adding a route (Wave 2 pattern)

In `src/ui/server.ts` the `ROUTES` array is the wiring point. B1/B2/B3
add entries there:

```ts
const ROUTES: Route[] = [
  { method: 'GET',    path: '/api/identity',          handler: identityHandler },
  // B1 (CRUD):
  { method: 'GET',    path: '/api/secrets',           handler: listHandler },
  { method: 'POST',   path: '/api/secrets',           handler: createHandler },
  { method: 'DELETE', path: '/api/secrets/:name',     handler: deleteHandler },
  // B2 (reveal) — MUST use the nonce helpers from auth.ts:
  { method: 'POST',   path: '/api/reveal/nonce',      handler: mintRevealNonce },
  { method: 'POST',   path: '/api/reveal',            handler: revealHandler },
  // B3 (import):
  { method: 'POST',   path: '/api/import',            handler: importHandler },
];
```

## Nonce helpers (for B2)

`src/ui/auth.ts` exports:

- `mintNonce(): string` — opaque hex string, 10-sec TTL.
- `consumeNonce(nonce: string): boolean` — single-use; returns false on
  miss, expired, or second consumption.

Reveal flow B2 is expected to implement:

1. Client POSTs to `/api/reveal/nonce`. Server returns `{nonce}`.
2. Client POSTs to `/api/reveal` with `{name, nonce}` in the body.
3. Server calls `consumeNonce(nonce)` — if false, return 401.
4. Otherwise decrypt and return the secret.

## Static assets

- Live on disk at `dist/ui/public/` after `npm run build`.
- Source is `src/ui/public/`; `scripts/copy-static.mjs` mirrors src→dist.
- The browser bootstraps from `index.html`, which:
  - Reads `#t=<token>` from `location.hash`.
  - Calls `history.replaceState` to strip the fragment from the address bar.
  - Exposes `window.envault.apiFetch(path, init)` for Wave 2 UI code to use.
- Wave 2 agents may add more HTML/JS/CSS files under `src/ui/public/`.

## What Wave 1 (this slice) ships

- `GET /api/identity` — `{fingerprint, keyPath, cache: 'present'|'absent'}`.
- The index page renders fingerprint + cache status in a top bar.
- Nothing else. No secrets, no reveal, no import.
