import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Generate a fresh session token. 32 bytes of entropy, rendered as 64 hex chars.
 * This is the value the CLI puts in the URL fragment; the browser then sends it
 * back as the `x-envault-token` header on every request.
 */
export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Constant-time comparison of an expected token against an incoming value.
 * Returns false for undefined, empty, or length-mismatched input without
 * performing a timing-leaking byte compare.
 */
export function verifyToken(expected: string, actual: string | undefined): boolean {
  if (typeof actual !== 'string') return false;
  if (actual.length === 0) return false;
  if (actual.length !== expected.length) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Guard against DNS-rebinding attacks: only accept Host headers that point at
 * this process's loopback interface. Anything else (an external hostname that
 * happens to resolve to 127.0.0.1, a LAN IP, 0.0.0.0, etc.) is rejected.
 */
export function verifyHost(hostHeader: string | undefined): boolean {
  if (typeof hostHeader !== 'string' || hostHeader.length === 0) return false;
  // Host header is `<host>` or `<host>:<port>`. IPv6 would be `[::1]:port` — not
  // accepted here since we bind to 127.0.0.1 only.
  const m = hostHeader.match(/^([^:]+)(?::(\d+))?$/);
  if (!m) return false;
  const host = m[1];
  if (host !== '127.0.0.1' && host !== 'localhost') return false;
  return true;
}

// ---- Nonce store (for wave-2 reveal flows) ----

export interface NonceStore {
  mint(): string;
  consume(nonce: string): boolean;
}

export interface NonceStoreOptions {
  now?: () => number;
  ttlMs?: number;
}

/**
 * Create an isolated nonce store. The default (`mintNonce` / `consumeNonce`)
 * uses a singleton; tests can inject a clock via `__createNonceStore`.
 *
 * Semantics:
 *  - `mint()` returns a fresh opaque hex string.
 *  - `consume(n)` returns true on first call if the nonce is known and unexpired;
 *    subsequent calls with the same nonce return false (single-use).
 */
export function __createNonceStore(opts: NonceStoreOptions = {}): NonceStore {
  const now = opts.now ?? (() => Date.now());
  const ttlMs = opts.ttlMs ?? 10_000;
  const store = new Map<string, number>();

  function gc(): void {
    const t = now();
    for (const [k, expires] of store) {
      if (expires <= t) store.delete(k);
    }
  }

  return {
    mint(): string {
      gc();
      const n = randomBytes(24).toString('hex');
      store.set(n, now() + ttlMs);
      return n;
    },
    consume(nonce: string): boolean {
      gc();
      const expires = store.get(nonce);
      if (expires === undefined) return false;
      store.delete(nonce);
      if (expires <= now()) return false;
      return true;
    },
  };
}

const defaultNonceStore = __createNonceStore();

export function mintNonce(): string {
  return defaultNonceStore.mint();
}

export function consumeNonce(nonce: string): boolean {
  return defaultNonceStore.consume(nonce);
}
