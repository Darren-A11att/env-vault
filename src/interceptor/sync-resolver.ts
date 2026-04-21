/**
 * Synchronous resolver for the fetch interceptor.
 *
 * The interceptor runs inside a synchronous code path (fetch wrappers cannot
 * await a per-call keystore round-trip without serious performance cost), so
 * we pre-load all secrets at install time into an in-memory Map<pseudokey, value>.
 *
 * This trades memory safety for speed: all decrypted values live in process
 * memory until the process exits. That's acceptable because the interceptor's
 * purpose is to transparently substitute pseudokeys inside a process that
 * _already_ has the unlocked identity — by design, such a process is trusted
 * with in-process memory.
 */

import type { Resolver } from './fetch.js';

export function buildStaticResolver(entries: Record<string, string>): Resolver {
  const map = new Map<string, string>(Object.entries(entries));
  return (pk: string) => map.get(pk);
}

/**
 * Open the vault, list all secrets, decrypt each, and return a synchronous resolver.
 * Closes the vault after preload.
 *
 * Failure modes:
 *  - If the vault is not initialized (no SSH key, no db), returns a resolver
 *    that always returns `undefined` (interceptor becomes a no-op).
 *  - If an individual secret fails to decrypt, logs a warning to stderr and
 *    skips it. Other secrets still resolve.
 */
export async function buildSyncResolver(): Promise<Resolver> {
  // Dynamic imports so this module can be loaded even if better-sqlite3 /
  // @napi-rs/keyring fail to initialize in unusual preload environments.
  let Vault: typeof import('../vault.js').Vault;
  try {
    ({ Vault } = await import('../vault.js'));
  } catch (err) {
    process.stderr.write(
      `envault: interceptor disabled (vault module unavailable: ${(err as Error).message})\n`,
    );
    return () => undefined;
  }

  let vault: ReturnType<typeof Vault.open>;
  try {
    vault = Vault.open();
  } catch {
    // Vault not initialized — silently no-op. Typical case: preload ran in a
    // process with no envault setup; we must not crash the host app.
    return () => undefined;
  }

  const map = new Map<string, string>();
  try {
    const rows = vault.list();
    for (const row of rows) {
      try {
        const value = await vault.getByPseudokey(row.pseudokey);
        if (value !== undefined) {
          map.set(row.pseudokey, value);
        }
      } catch (err) {
        process.stderr.write(
          `envault: skipping '${row.name}' (${row.pseudokey}): ${(err as Error).message}\n`,
        );
      }
    }
  } catch (err) {
    process.stderr.write(
      `envault: interceptor preload failed: ${(err as Error).message}\n`,
    );
  } finally {
    try {
      vault.close();
    } catch {
      // ignore
    }
  }

  return (pk: string) => map.get(pk);
}
