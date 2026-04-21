/**
 * ESM preload entrypoint. Loaded via:
 *   node --import @darrenallatt/env-vault/register app.mjs
 * or (with a resolved file URL, recommended for global installs):
 *   node --import "file:///path/to/dist/interceptor/register.js" app.mjs
 *
 * Uses top-level await (supported in Node 20+). After this module finishes
 * loading, `globalThis.fetch` is patched and any subsequent `fetch` call in
 * the host app will have pseudokeys substituted in its URL query + headers.
 */
import { installInterceptor } from './fetch.js';
import { buildSyncResolver } from './sync-resolver.js';

const resolver = await buildSyncResolver();
installInterceptor(resolver);
