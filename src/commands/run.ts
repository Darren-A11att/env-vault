import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';
import { Vault } from '../vault.js';
import { resolveEnv } from '../resolve.js';

function isNodeBinary(cmd: string): boolean {
  const base = path.basename(cmd);
  return base === 'node' || base === 'node.exe';
}

function registerFileUrl(): string {
  // Resolve the compiled register.js sibling to this file's compiled location.
  // At runtime this file lives at dist/commands/run.js and the register entry
  // at dist/interceptor/register.js.
  return new URL('../interceptor/register.js', import.meta.url).toString();
}

function injectNodeOptions(env: Record<string, string | undefined>): void {
  const registerUrl = registerFileUrl();
  const addition = `--import ${registerUrl}`;
  const existing = env.NODE_OPTIONS;
  if (existing && existing.includes(registerUrl)) return; // idempotent
  env.NODE_OPTIONS = existing && existing.length > 0
    ? `${existing} ${addition}`
    : addition;
}

export async function runCmd(
  argv: string[],
  opts: { envFile?: string; loadEnv?: boolean; intercept?: boolean } = {},
): Promise<void> {
  if (argv.length === 0) {
    console.error('Usage: envault run -- <command> [args...]');
    process.exit(1);
  }

  const env: Record<string, string | undefined> = { ...process.env };

  const envFileCandidates = opts.envFile
    ? [path.resolve(opts.envFile)]
    : opts.loadEnv === false
      ? []
      : [path.resolve(process.cwd(), '.env')];

  for (const file of envFileCandidates) {
    if (fs.existsSync(file)) {
      const parsed = dotenv.parse(fs.readFileSync(file));
      for (const [k, v] of Object.entries(parsed)) {
        if (env[k] === undefined) env[k] = v;
      }
    } else if (opts.envFile) {
      console.error(`env file not found: ${file}`);
      process.exit(1);
    }
  }

  const vault = Vault.open();
  try {
    await resolveEnv(env, vault);
  } finally {
    vault.close();
  }

  const [cmd, ...args] = argv;

  // Auto-inject the fetch interceptor for Node child processes (opt-out via --no-intercept).
  if (opts.intercept !== false && isNodeBinary(cmd)) {
    injectNodeOptions(env);
  }

  const child = spawn(cmd, args, {
    stdio: 'inherit',
    env: env as NodeJS.ProcessEnv,
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });
  child.on('error', (err) => {
    console.error(`envault: failed to spawn '${cmd}': ${err.message}`);
    process.exit(127);
  });
}
