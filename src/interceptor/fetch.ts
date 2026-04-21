/**
 * Fetch interceptor.
 *
 * Monkey-patches `globalThis.fetch` to scan outgoing request URLs (query strings)
 * and request headers for `envault-XXXXXXXX` pseudokeys and substitute them
 * in-memory using a synchronous resolver.
 *
 * Hard scope:
 *  - URL query string + headers only. Bodies are NOT scanned (deferred to v0.3).
 *  - Monkey-patches `globalThis.fetch` only. Does NOT patch `http.request` / `https.request`.
 *  - Fail-open: any error in the interceptor falls through to the original fetch.
 */

export type Resolver = (pseudokey: string) => string | undefined;

const PSEUDOKEY_RE = /envault-[0-9a-f]{8,12}/g;

function substitute(value: string, resolve: Resolver): string {
  if (!value.includes('envault-')) return value;
  return value.replace(PSEUDOKEY_RE, (tok) => resolve(tok) ?? tok);
}

/**
 * Pure function: given a Request, return a (possibly new) Request with
 * pseudokeys substituted in the URL query string and headers.
 *
 * If nothing changed, returns the original Request instance.
 */
export function rewriteRequest(req: Request, resolve: Resolver): Request {
  let changed = false;

  // --- URL query string ---
  let newUrl = req.url;
  try {
    const parsed = new URL(req.url);
    let qChanged = false;
    // Collect entries first so we don't mutate while iterating.
    const entries: Array<[string, string]> = [];
    parsed.searchParams.forEach((v, k) => {
      entries.push([k, v]);
    });
    for (const [k, v] of entries) {
      const sub = substitute(v, resolve);
      if (sub !== v) {
        parsed.searchParams.set(k, sub);
        qChanged = true;
      }
    }
    if (qChanged) {
      newUrl = parsed.toString();
      changed = true;
    }
  } catch {
    // Non-URL-parseable input: leave URL untouched.
  }

  // --- Headers ---
  const newHeaders = new Headers();
  let hChanged = false;
  req.headers.forEach((v, k) => {
    const sub = substitute(v, resolve);
    if (sub !== v) hChanged = true;
    newHeaders.set(k, sub);
  });
  if (hChanged) changed = true;

  if (!changed) return req;

  // Build a new Request preserving relevant properties. Body is passed through
  // as-is (not scanned, per scope limits).
  const method = req.method;
  const hasBody = method !== 'GET' && method !== 'HEAD';

  const init: RequestInit & { duplex?: 'half' } = {
    method,
    headers: newHeaders,
    redirect: req.redirect,
    signal: req.signal,
    credentials: req.credentials,
    referrer: req.referrer,
    referrerPolicy: req.referrerPolicy,
    integrity: req.integrity,
    keepalive: req.keepalive,
  };
  if (hasBody) {
    init.body = req.body;
    // undici requires `duplex: 'half'` when body is a ReadableStream.
    // TS's lib.dom doesn't know about this yet, so we cast in the type above.
    init.duplex = 'half';
  }

  return new Request(newUrl, init as RequestInit);
}

let originalFetch: typeof fetch | undefined;

export function installInterceptor(resolve: Resolver): void {
  if (originalFetch) return; // already installed — idempotent
  if (typeof globalThis.fetch !== 'function') return; // old Node
  originalFetch = globalThis.fetch;

  const wrapped: typeof fetch = async (input, init) => {
    try {
      const req = new Request(input as Parameters<typeof fetch>[0], init);
      const rewritten = rewriteRequest(req, resolve);
      return originalFetch!(rewritten);
    } catch {
      // Fail-open: any error falls through to the original fetch.
      return originalFetch!(input as Parameters<typeof fetch>[0], init);
    }
  };
  try {
    Object.defineProperty(wrapped, 'name', { value: 'fetch' });
  } catch {
    // ignore — non-critical
  }
  globalThis.fetch = wrapped;
}

export function uninstallInterceptor(): void {
  if (!originalFetch) return;
  globalThis.fetch = originalFetch;
  originalFetch = undefined;
}
