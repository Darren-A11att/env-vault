import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { promises as fs } from 'node:fs';
import { dirname, extname, join, normalize, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fingerprintFromPublicKey,
  loadCachedScalar,
} from '../identity-cache.js';
import { loadPublicIdentity } from '../identity.js';
import { getEnvaultKeyPath } from '../paths.js';
import { generateToken } from './auth.js';
import { createRouter, type Route, type Router, type Handler } from './router.js';
import { wave2Routes } from './routes.js';

export interface StartServerOptions {
  /** Port to bind. Omit or pass 0 to let the OS pick a free port. */
  port?: number;
  /** Idle timeout before auto-shutdown (ms). Defaults to 15 minutes. */
  idleTimeoutMs?: number;
}

export interface RunningServer {
  /** Base URL: `http://127.0.0.1:<port>` (no trailing slash, no fragment). */
  url: string;
  /** Browser entry URL with the token in the fragment: `<url>/#t=<token>`. */
  browserUrl: string;
  token: string;
  port: number;
  stop(): Promise<void>;
}

const DEFAULT_IDLE_MS = 15 * 60 * 1000;

// Resolve `dist/ui/public` relative to this compiled file. In dev (running
// from src/ui/server.ts via test runner) the dir may not exist — serving
// static assets then 404s, which is fine for the API-only tests.
function resolvePublicDir(): string {
  // In both src and dist, public assets live in `../ui/public` relative to
  // the compiled module. For src/ui/server.ts the path resolves to src/ui/public;
  // for dist/ui/server.js it resolves to dist/ui/public.
  const here = dirname(fileURLToPath(import.meta.url));
  return resolvePath(here, 'public');
}

function extToContentType(ext: string): string {
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.ico':
      return 'image/x-icon';
    default:
      return 'application/octet-stream';
  }
}

const identityHandler: Handler = async () => {
  const keyPath = getEnvaultKeyPath();
  const { ed25519Pub } = loadPublicIdentity();
  const fingerprint = fingerprintFromPublicKey(ed25519Pub);
  const cached = loadCachedScalar(fingerprint);
  return {
    status: 200,
    json: {
      fingerprint,
      keyPath,
      cache: cached ? 'present' : 'absent',
    },
  };
};

const ROUTES: Route[] = [
  { method: 'GET', path: '/api/identity', handler: identityHandler },
  ...wave2Routes,
];

function setSecurityHeaders(res: ServerResponse, contentType: string): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', contentType);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const ct = (req.headers['content-type'] ?? '').toLowerCase();
  if (!ct.includes('application/json')) return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
    // cap payload at 1MB
    if (chunks.reduce((n, c) => n + c.length, 0) > 1_000_000) {
      throw new Error('payload too large');
    }
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.length === 0) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('invalid JSON body');
  }
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, publicDir: string): Promise<boolean> {
  let urlPath = (req.url ?? '/').split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  // normalize + prevent path traversal
  const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(publicDir, safe);
  if (!filePath.startsWith(publicDir)) return false;
  try {
    const data = await fs.readFile(filePath);
    const contentType = extToContentType(extname(filePath));
    setSecurityHeaders(res, contentType);
    res.statusCode = 200;
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

export async function startServer(opts: StartServerOptions = {}): Promise<RunningServer> {
  const token = generateToken();
  const router: Router = createRouter({ token, routes: ROUTES });
  const publicDir = resolvePublicDir();
  const idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_MS;

  let idleTimer: NodeJS.Timeout | undefined;
  let stopped = false;

  function scheduleIdleShutdown(stopFn: () => Promise<void>): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      void stopFn();
    }, idleTimeoutMs);
    // don't keep the event loop alive on this alone
    idleTimer.unref?.();
  }

  const server: Server = createServer(async (req, res) => {
    try {
      const isApi = (req.url ?? '').startsWith('/api/');

      if (isApi) {
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch (err) {
          setSecurityHeaders(res, 'application/json; charset=utf-8');
          res.statusCode = 400;
          res.end(JSON.stringify({ error: (err as Error).message }));
          return;
        }
        const result = await router.dispatch(req, body);
        const contentType =
          result.contentType ??
          (result.text !== undefined ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8');
        setSecurityHeaders(res, contentType);
        res.statusCode = result.status;
        if (result.text !== undefined) {
          res.end(result.text);
        } else {
          res.end(JSON.stringify(result.json ?? null));
        }
        return;
      }

      // Static assets: host-check here too so we don't leak index.html to
      // DNS-rebinding victims. But the token is NOT required for static files —
      // the browser needs to load index.html before it has the token from the
      // URL fragment.
      const hostHeader = req.headers.host;
      if (!isLocalHostHeader(hostHeader)) {
        setSecurityHeaders(res, 'application/json; charset=utf-8');
        res.statusCode = 403;
        res.end(JSON.stringify({ error: 'forbidden host' }));
        return;
      }

      const served = await serveStatic(req, res, publicDir);
      if (!served) {
        setSecurityHeaders(res, 'application/json; charset=utf-8');
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'not found' }));
      }
    } catch (err) {
      setSecurityHeaders(res, 'application/json; charset=utf-8');
      res.statusCode = 500;
      res.end(JSON.stringify({ error: (err as Error).message }));
    } finally {
      scheduleIdleShutdown(stop);
    }
  });

  // Bind to loopback only.
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to bind server');
  }
  const port = address.port;

  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    if (idleTimer) clearTimeout(idleTimer);
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // Close any keep-alive sockets so tests don't hang.
      server.closeAllConnections?.();
    });
  }

  scheduleIdleShutdown(stop);

  const url = `http://127.0.0.1:${port}`;
  return {
    url,
    browserUrl: `${url}/#t=${token}`,
    token,
    port,
    stop,
  };
}

function isLocalHostHeader(hostHeader: string | undefined): boolean {
  if (typeof hostHeader !== 'string' || hostHeader.length === 0) return false;
  const m = hostHeader.match(/^([^:]+)(?::(\d+))?$/);
  if (!m) return false;
  const h = m[1];
  return h === '127.0.0.1' || h === 'localhost';
}
