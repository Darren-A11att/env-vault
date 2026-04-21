import * as fs from 'node:fs';
import { createInterface } from 'node:readline';
import sshpk from 'sshpk';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  getSshDir,
  getEnvaultKeyPath,
  getEnvaultPubPath,
} from './paths.js';
import {
  fingerprintFromPublicKey,
  cacheScalar,
  loadCachedScalar,
} from './identity-cache.js';

export interface Identity {
  ed25519Seed?: Uint8Array;
  ed25519Pub: Uint8Array;
  x25519Priv: Uint8Array;
  x25519Pub: Uint8Array;
}

export interface LoadIdentityOpts {
  forceUncached?: boolean;
}

export function identityExists(): boolean {
  return fs.existsSync(getEnvaultKeyPath());
}

export function generateIdentity(opts: { force?: boolean } = {}): { privPath: string; pubPath: string } {
  const sshDir = getSshDir();
  if (!fs.existsSync(sshDir)) {
    fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });
  }
  const privPath = getEnvaultKeyPath();
  const pubPath = getEnvaultPubPath();
  if (fs.existsSync(privPath) && !opts.force) {
    throw new Error(`${privPath} already exists. Remove it first, or use --reuse to point at a different key.`);
  }
  const key = sshpk.generatePrivateKey('ed25519');
  const pemPriv = key.toBuffer('ssh-private');
  const pubStr = key.toPublic().toString('ssh') + ' envault_key\n';
  fs.writeFileSync(privPath, pemPriv, { mode: 0o600 });
  fs.writeFileSync(pubPath, pubStr, { mode: 0o644 });
  return { privPath, pubPath };
}

export function writeReusedIdentity(sourcePrivPath: string): { privPath: string; pubPath: string } {
  if (!fs.existsSync(sourcePrivPath)) {
    throw new Error(`Source key not found: ${sourcePrivPath}`);
  }
  const sshDir = getSshDir();
  if (!fs.existsSync(sshDir)) {
    fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });
  }
  const privPath = getEnvaultKeyPath();
  const pubPath = getEnvaultPubPath();
  if (fs.existsSync(privPath)) {
    throw new Error(`${privPath} already exists. Remove it first.`);
  }
  fs.copyFileSync(sourcePrivPath, privPath);
  fs.chmodSync(privPath, 0o600);
  const sourcePubPath = `${sourcePrivPath}.pub`;
  if (fs.existsSync(sourcePubPath)) {
    fs.copyFileSync(sourcePubPath, pubPath);
    fs.chmodSync(pubPath, 0o644);
  } else {
    const parsed = parsePrivateKeyOrThrow(fs.readFileSync(privPath));
    const pubStr = parsed.toPublic().toString('ssh') + ' envault_key\n';
    fs.writeFileSync(pubPath, pubStr, { mode: 0o644 });
  }
  return { privPath, pubPath };
}

function parsePrivateKeyOrThrow(buf: Buffer, passphrase?: string): sshpk.PrivateKey {
  try {
    return sshpk.parsePrivateKey(buf, 'auto', passphrase ? { passphrase } : undefined);
  } catch (err) {
    const e = err as Error & { name?: string };
    if (
      e.name === 'KeyEncryptedError' ||
      /encrypted|passphrase/i.test(e.message ?? '')
    ) {
      const err2 = new Error('KEY_ENCRYPTED');
      (err2 as Error & { code?: string }).code = 'KEY_ENCRYPTED';
      throw err2;
    }
    throw err;
  }
}

async function promptPassphrase(keyPath: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error(
      `SSH key ${keyPath} is passphrase-protected and no TTY is available to prompt. ` +
      `Run interactively, or remove the passphrase: ssh-keygen -p -N "" -f ${keyPath}`,
    );
  }
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: true,
  });
  const promptStr = `Enter passphrase for ${keyPath}: `;
  return new Promise<string>((resolve, reject) => {
    // biome-ignore lint: cast for muted prompt hack
    const rlAny = rl as unknown as { _writeToOutput: (s: string) => void };
    const originalWrite = rlAny._writeToOutput.bind(rl);
    let answered = false;
    rlAny._writeToOutput = (str: string) => {
      if (answered) {
        return originalWrite(str);
      }
      if (str.startsWith(promptStr) || str === promptStr) {
        originalWrite(promptStr);
      }
      // suppress echo of the typed passphrase
    };
    rl.question(promptStr, (answer) => {
      answered = true;
      process.stderr.write('\n');
      rl.close();
      resolve(answer);
    });
    rl.on('error', reject);
  });
}

/**
 * Read the `.pub` sibling file for a private-key path. Returns the parsed
 * Ed25519 public key bytes, or `undefined` if the file doesn't exist.
 */
function readEd25519PubFromFile(privPath: string): Uint8Array | undefined {
  const pubPath = `${privPath}.pub`;
  if (!fs.existsSync(pubPath)) return undefined;
  try {
    const parsed = sshpk.parseKey(fs.readFileSync(pubPath, 'utf8'), 'ssh');
    if (parsed.type !== 'ed25519') return undefined;
    const parts = parsed.part as unknown as Record<string, { data: Buffer }>;
    return new Uint8Array(parts.A.data);
  } catch {
    return undefined;
  }
}

function healPubFile(privPath: string, parsed: sshpk.PrivateKey): void {
  const pubPath = `${privPath}.pub`;
  if (fs.existsSync(pubPath)) return;
  try {
    const pubStr = parsed.toPublic().toString('ssh') + ' envault_key\n';
    fs.writeFileSync(pubPath, pubStr, { mode: 0o644 });
  } catch {
    // best-effort: if we can't write, just carry on
  }
}

export async function loadIdentity(
  keyPathOrOpts?: string | LoadIdentityOpts,
  maybeOpts?: LoadIdentityOpts,
): Promise<Identity> {
  let keyPath: string | undefined;
  let opts: LoadIdentityOpts = {};
  if (typeof keyPathOrOpts === 'string') {
    keyPath = keyPathOrOpts;
    opts = maybeOpts ?? {};
  } else if (keyPathOrOpts) {
    opts = keyPathOrOpts;
  }

  const resolvedPath = keyPath ?? getEnvaultKeyPath();
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`SSH key not found at ${resolvedPath}. Run: envault init`);
  }

  // Fast path: if .pub is readable, compute fingerprint and consult the keychain.
  if (!opts.forceUncached) {
    const ed25519PubFromFile = readEd25519PubFromFile(resolvedPath);
    if (ed25519PubFromFile) {
      const fingerprint = fingerprintFromPublicKey(ed25519PubFromFile);
      const cached = loadCachedScalar(fingerprint);
      if (cached) {
        const x25519Pub = ed25519.utils.toMontgomery(ed25519PubFromFile);
        return { ed25519Pub: ed25519PubFromFile, x25519Priv: cached, x25519Pub };
      }
    }
  }

  // Slow path: parse the private key file (prompting for a passphrase if needed).
  const buf = fs.readFileSync(resolvedPath);

  let parsed: sshpk.PrivateKey;
  try {
    parsed = parsePrivateKeyOrThrow(buf);
  } catch (err) {
    if ((err as Error & { code?: string }).code === 'KEY_ENCRYPTED') {
      const passphrase = await promptPassphrase(resolvedPath);
      parsed = parsePrivateKeyOrThrow(buf, passphrase);
    } else {
      throw err;
    }
  }

  if (parsed.type !== 'ed25519') {
    throw new Error(
      `envault requires an Ed25519 key; found ${parsed.type} at ${resolvedPath}. ` +
      `Generate one with: envault init (or reuse a different key via --reuse <path>)`,
    );
  }

  const parts = parsed.part as unknown as Record<string, { data: Buffer }>;
  const ed25519Seed = new Uint8Array(parts.k.data);
  const ed25519Pub = new Uint8Array(parts.A.data);
  const x25519Priv = ed25519.utils.toMontgomerySecret(ed25519Seed);
  const x25519Pub = ed25519.utils.toMontgomery(ed25519Pub);

  // If the .pub sidecar was missing, heal the install so subsequent runs can hit the cache path.
  healPubFile(resolvedPath, parsed);

  // Cache the derived scalar. Best-effort — keychain errors must not block vault access.
  try {
    const fingerprint = fingerprintFromPublicKey(ed25519Pub);
    cacheScalar(fingerprint, x25519Priv);
  } catch {
    // ignore; caller still gets a working identity
  }

  return { ed25519Seed, ed25519Pub, x25519Priv, x25519Pub };
}

export function loadPublicIdentity(keyPath?: string): { ed25519Pub: Uint8Array; x25519Pub: Uint8Array } {
  const pubPath = keyPath ?? getEnvaultPubPath();
  if (!fs.existsSync(pubPath)) {
    throw new Error(`Public key not found at ${pubPath}. Run: envault init`);
  }
  const parsed = sshpk.parseKey(fs.readFileSync(pubPath, 'utf8'), 'ssh');
  if (parsed.type !== 'ed25519') {
    throw new Error(`envault requires an Ed25519 key; found ${parsed.type}`);
  }
  const parts = parsed.part as unknown as Record<string, { data: Buffer }>;
  const ed25519Pub = new Uint8Array(parts.A.data);
  const x25519Pub = ed25519.utils.toMontgomery(ed25519Pub);
  return { ed25519Pub, x25519Pub };
}
