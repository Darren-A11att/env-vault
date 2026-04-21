// Route aggregator for Wave-2 handler modules.
//
// Each handler module exports its own `Route[]`. This file concatenates them
// so `src/ui/server.ts` has a single import to register. B2 (reveal) and B3
// (import) will append their own spreads here.

import type { Route } from './router.js';
import { secretsRoutes } from './handlers/secrets.js';
import { revealRoutes } from './handlers/reveal.js';
import { importRoutes } from './handlers/import.js';

export const wave2Routes: Route[] = [
  ...secretsRoutes,
  ...revealRoutes,
  ...importRoutes,
];
