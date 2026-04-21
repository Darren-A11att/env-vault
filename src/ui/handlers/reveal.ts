// B2 (reveal slice) — secure single-use-nonce-gated reveal of decrypted values.
//
// Contract (per src/ui/README.md, frozen):
//   POST /api/reveal/nonce  → { nonce, expiresAt }
//   POST /api/reveal        ← { name, nonce } → { value }
//
// Security properties enforced here:
//   - Single-use nonces (via src/ui/auth.ts mintNonce/consumeNonce).
//   - 10-second TTL (set by auth.ts).
//   - Per-token rate limit: at most 10 nonces per 60 seconds.
//   - The reveal handler DOES NOT consume the nonce on 404 (missing secret),
//     so a probe for a nonexistent name cannot exhaust nonces.
//   - Identity locked (passphrase-protected key, no TTY) → 503 with guidance.
//
// The README says consume() failure → 401; we honour that so the frozen
// transport contract holds. Other validation errors (malformed body, missing
// fields) return 400 per the router conventions.
import type { Handler, Route } from '../router.js';
import { mintNonce, consumeNonce } from '../auth.js';
import { Vault } from '../../vault.js';

export interface RevealDeps {
  now?: () => number;
}

const NONCE_RATE_WINDOW_MS = 60_000;
const NONCE_RATE_MAX = 10;

// per-token sliding window of nonce-mint timestamps.
const mintHistory = new Map<string, number[]>();

function tokenFromReq(headers: Record<string, string | string[] | undefined>): string {
  const raw = headers['x-envault-token'];
  const val = Array.isArray(raw) ? raw[0] : raw;
  return typeof val === 'string' ? val : '';
}

export function __resetRateLimiter(): void {
  mintHistory.clear();
}

/**
 * Check (and record) a nonce-mint event under the sliding window rate limit.
 * Returns true when the request is permitted.
 */
function admitMint(token: string, now: number): boolean {
  const arr = mintHistory.get(token) ?? [];
  // prune timestamps outside the window
  const cutoff = now - NONCE_RATE_WINDOW_MS;
  let i = 0;
  while (i < arr.length && arr[i] <= cutoff) i++;
  const pruned = i === 0 ? arr : arr.slice(i);
  if (pruned.length >= NONCE_RATE_MAX) {
    mintHistory.set(token, pruned);
    return false;
  }
  pruned.push(now);
  mintHistory.set(token, pruned);
  return true;
}

export function createMintNonceHandler(deps: RevealDeps = {}): Handler {
  const now = deps.now ?? (() => Date.now());
  return async (req) => {
    const token = tokenFromReq(req.headers as Record<string, string | string[] | undefined>);
    const t = now();
    if (!admitMint(token, t)) {
      return { status: 429, json: { error: 'rate limited' } };
    }
    const nonce = mintNonce();
    // auth.ts's default nonce store has a 10s TTL; we report the same.
    const expiresAt = t + 10_000;
    return { status: 200, json: { nonce, expiresAt } };
  };
}

/**
 * Detect "identity locked" style errors coming out of Vault.get().
 * The underlying identity loader throws a message containing "passphrase"
 * or "encrypted" when the key is passphrase-protected and no TTY is
 * available to prompt. We translate those to 503.
 */
function isIdentityLockedError(err: unknown): boolean {
  const msg = (err as { message?: string } | undefined)?.message ?? '';
  return /passphrase|encrypted/i.test(msg);
}

function isMissingSecretError(err: unknown, name: string): boolean {
  const msg = (err as { message?: string } | undefined)?.message ?? '';
  return msg.includes(`secret not found: ${name}`);
}

export const mintNonceHandler: Handler = createMintNonceHandler();

export const revealHandler: Handler = async (_req, body) => {
  if (body === undefined || body === null || typeof body !== 'object') {
    return { status: 400, json: { error: 'expected JSON body' } };
  }
  const b = body as { name?: unknown; nonce?: unknown };
  if (typeof b.nonce !== 'string' || b.nonce.length === 0) {
    return { status: 400, json: { error: 'missing nonce' } };
  }
  if (typeof b.name !== 'string' || b.name.length === 0) {
    return { status: 400, json: { error: 'missing name' } };
  }
  const name = b.name;
  const nonce = b.nonce;

  // Open the vault FIRST so a missing-secret lookup doesn't consume the nonce.
  // (Decision: don't burn a nonce on 404 — the user didn't get a value, let
  //  them retry. Rate-limiting already protects against probe abuse.)
  let vault: Vault;
  try {
    vault = Vault.open();
  } catch (err) {
    return { status: 500, json: { error: (err as Error).message } };
  }

  try {
    // Check existence without touching the identity / without consuming the nonce.
    const pseudokey = vault.getPseudokey(name);
    if (!pseudokey) {
      return { status: 404, json: { error: `secret not found: ${name}` } };
    }

    // Existence confirmed — now consume the nonce. If it fails, we return 401
    // per the README's frozen contract ("if false, return 401").
    if (!consumeNonce(nonce)) {
      return { status: 401, json: { error: 'invalid or expired nonce' } };
    }

    const value = await vault.get(name);
    return { status: 200, json: { value } };
  } catch (err) {
    if (isMissingSecretError(err, name)) {
      return { status: 404, json: { error: `secret not found: ${name}` } };
    }
    if (isIdentityLockedError(err)) {
      return {
        status: 503,
        json: {
          error: 'identity locked; run envault identity unlock in a terminal',
        },
      };
    }
    return { status: 500, json: { error: (err as Error).message } };
  } finally {
    try {
      vault.close();
    } catch {
      // best-effort close
    }
  }
};

// Route wiring — consumed by src/ui/routes.ts aggregator.
export const revealRoutes: Route[] = [
  { method: 'POST', path: '/api/reveal/nonce', handler: mintNonceHandler },
  { method: 'POST', path: '/api/reveal',       handler: revealHandler },
];
