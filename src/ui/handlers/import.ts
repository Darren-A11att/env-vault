// Import handler for /api/import. B3, Wave 2.
//
// Accepts `{ envText, replace? }`, parses as .env, and upserts each entry
// into the vault. Returns the generated pseudokeys plus counts of skipped
// (already-pseudokey) and rejected (invalid name) entries.
//
// Security invariants:
//   - NEVER echo decrypted values in the response. Only pseudokeys.
//   - Cap envText at 512 KiB and 500 entries.
//   - `replace` flag is accepted but ignored server-side — the HTTP server
//     cannot rewrite a file on the user's disk. The UI uses it as a hint to
//     present the copy-pseudokey workflow.

import type { Handler, HandlerResult, Route } from '../router.js';
import { Vault } from '../../vault.js';
import { parseAndImport, countEntries } from '../../lib/importEnv.js';

// 512 KiB envText cap (binary-kilo, i.e. 512 * 1024 bytes of utf-8).
const MAX_ENV_BYTES = 512 * 1024;
// Sanity cap on number of parsed entries.
const MAX_ENTRIES = 500;

function bad(message: string): HandlerResult {
  return { status: 400, json: { error: message } };
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export const importHandler: Handler = async (_req, body) => {
  if (!isPlainObject(body)) {
    return bad('missing JSON body');
  }
  const { envText } = body;
  if (typeof envText !== 'string') {
    return bad('missing field: envText');
  }
  if (envText.length === 0) {
    return bad('envText is empty');
  }
  const bytes = Buffer.byteLength(envText, 'utf8');
  if (bytes > MAX_ENV_BYTES) {
    return bad('envText too large (max 512 KiB)');
  }

  // Count-cap check before touching the vault. `parseAndImport` will parse
  // a second time — cheap compared to the I/O cost of per-entry upserts.
  let entryCount: number;
  try {
    entryCount = countEntries(envText);
  } catch {
    return bad('could not parse .env file');
  }
  if (entryCount > MAX_ENTRIES) {
    return bad(`too many entries (max ${MAX_ENTRIES})`);
  }
  if (entryCount === 0) {
    return bad('could not parse .env file');
  }

  const vault = Vault.open();
  try {
    const result = parseAndImport(envText, vault);
    const pseudokeys: Record<string, string> = {};
    for (const m of result.mappings) {
      // Include both imported and already-pseudokey entries so the UI can
      // render the final pseudokey per name in either case.
      pseudokeys[m.name] = m.pseudokey;
    }
    return {
      status: 200,
      json: {
        imported: result.imported,
        skipped: result.skipped,
        rejected: result.rejected,
        pseudokeys,
      },
    };
  } finally {
    vault.close();
  }
};

export const importRoutes: Route[] = [
  { method: 'POST', path: '/api/import', handler: importHandler },
];
