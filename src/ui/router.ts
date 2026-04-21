import type { IncomingMessage } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

export type Method = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export interface HandlerResult {
  status: number;
  json?: unknown;
  text?: string;
  contentType?: string;
}

export type Handler = (
  req: IncomingMessage,
  body: unknown,
  params: Record<string, string>,
) => Promise<HandlerResult>;

export interface Route {
  method: Method;
  path: string; // supports `:name` segments
  handler: Handler;
}

export interface RouterOptions {
  token: string;
  routes: Route[];
}

export interface CompiledRoute {
  method: Method;
  regex: RegExp;
  keys: string[];
  handler: Handler;
}

export interface Router {
  dispatch(req: IncomingMessage, body: unknown): Promise<HandlerResult>;
}

// ---- Local helpers (kept in-module so the router has no intra-src imports,
//      which keeps node --test --experimental-strip-types happy without a
//      custom loader; the canonical implementations also live in auth.ts) ----

function isLocalHost(hostHeader: string | undefined): boolean {
  if (typeof hostHeader !== 'string' || hostHeader.length === 0) return false;
  const m = hostHeader.match(/^([^:]+)(?::(\d+))?$/);
  if (!m) return false;
  const h = m[1];
  return h === '127.0.0.1' || h === 'localhost';
}

function tokensMatch(expected: string, actual: string | undefined): boolean {
  if (typeof actual !== 'string' || actual.length === 0) return false;
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
 * Compile `/api/secrets/:name` into a regex + ordered key list.
 */
export function compilePath(path: string): { regex: RegExp; keys: string[] } {
  const keys: string[] = [];
  const parts = path.split('/').map((seg) => {
    if (seg.startsWith(':')) {
      keys.push(seg.slice(1));
      return '([^/]+)';
    }
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  const regex = new RegExp(`^${parts.join('/')}$`);
  return { regex, keys };
}

export function createRouter(opts: RouterOptions): Router {
  const compiled: CompiledRoute[] = opts.routes.map((r) => {
    const { regex, keys } = compilePath(r.path);
    return { method: r.method, regex, keys, handler: r.handler };
  });

  return {
    async dispatch(req: IncomingMessage, body: unknown): Promise<HandlerResult> {
      // Host check first — DNS-rebinding guard applies to all routes.
      if (!isLocalHost(req.headers.host)) {
        return { status: 403, json: { error: 'forbidden host' } };
      }

      // Auth: constant-time token check.
      const tokenHeader = req.headers['x-envault-token'];
      const tokenVal = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
      if (!tokensMatch(opts.token, tokenVal)) {
        return { status: 401, json: { error: 'unauthorized' } };
      }

      const url = req.url ?? '/';
      const pathOnly = url.split('?')[0];
      const method = (req.method ?? 'GET').toUpperCase() as Method;

      for (const route of compiled) {
        const m = pathOnly.match(route.regex);
        if (!m) continue;
        if (route.method !== method) continue;
        const params: Record<string, string> = {};
        route.keys.forEach((key, i) => {
          params[key] = decodeURIComponent(m[i + 1]);
        });
        try {
          return await route.handler(req, body, params);
        } catch (err) {
          const msg = (err as Error).message ?? 'internal error';
          return { status: 500, json: { error: msg } };
        }
      }

      return { status: 404, json: { error: 'not found' } };
    },
  };
}
