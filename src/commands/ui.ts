import { spawn } from 'node:child_process';
import { startServer } from '../ui/server.js';

export interface UiCmdOptions {
  port?: number | string;
  open?: boolean;
}

function openBrowser(url: string): void {
  const platform = process.platform;
  let cmd: string;
  let args: string[];
  if (platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '""', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', () => {
      // ignore; user can copy the URL manually
    });
    child.unref();
  } catch {
    // ignore; user can copy the URL manually
  }
}

export async function uiCmd(opts: UiCmdOptions = {}): Promise<void> {
  const portRaw = opts.port;
  const port = portRaw === undefined ? undefined : Number(portRaw);
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
    throw new Error(`invalid --port: ${portRaw}`);
  }

  const server = await startServer({ port });
  console.error(`envault ui listening at ${server.browserUrl}`);

  if (opts.open !== false) {
    openBrowser(server.browserUrl);
  }

  const shutdown = async (): Promise<void> => {
    await server.stop();
    process.exit(0);
  };

  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });

  // Keep the event loop alive; startServer's idle timer is unref'd.
  // A no-op interval gives us a clean SIGINT path.
  const keepalive = setInterval(() => {}, 1 << 30);
  // Store a ref so we can clear it if needed (currently not exposed).
  void keepalive;
}
