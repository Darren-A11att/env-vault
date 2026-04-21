# env-vault

OS-native SQLite secrets vault with an SSH-key master. Replace plaintext API keys in `.env` (and other config files) with **pseudokeys** like `envault-71918db9`; resolve them to real values at the child-process boundary at runtime.

Solves two problems with one tool:

1. **Coding project secrets** — `.env` files on disk or in git containing plaintext API keys.
2. **Agentic coding harness secrets** — pi / Claude Code / Cursor / etc. reading credential files that expose keys to any model call they make.

## Install

```bash
npm install -g @darrenallatt/env-vault
```

## Quick start

```bash
# One-time setup. Generates ~/.ssh/envault_key (Ed25519, OpenSSH format).
envault init

# Import an existing .env in place — rewrites values with pseudokeys.
envault import .env --replace

# Run any command with pseudokeys resolved to real values in its env.
envault run -- node app.js
envault run -- pi
envault run -- python train.py
envault run -- docker compose up
```

## How it works

`envault init` generates an Ed25519 keypair stored using the same conventions as SSH keys: `~/.ssh/envault_key` (`0600`) and `~/.ssh/envault_key.pub` (`0644`). The vault database lives at `~/.envault/vault.db` and only ever holds ciphertexts.

Secrets are encrypted with an ECIES-style scheme: for each value, an ephemeral X25519 keypair is generated, ECDH-combined with the vault's X25519 public key (derived from the Ed25519 identity), HKDF-SHA256 expands the shared secret, and the value is encrypted with XChaCha20-Poly1305. The secret's name is bound as associated data so a ciphertext for `FOO` will not decrypt under the name `BAR`.

Pseudokeys (e.g. `envault-71918db9`) are short tokens stored alongside each secret. They are safe to commit — they dereference nothing without the local vault database. When `envault run` spawns a child process, every env var whose value is a pseudokey is replaced with the real decrypted value *in the child's environment only*.

## CLI reference

```
envault init [--reuse <path>] [--force]
envault set <NAME> <VALUE>
envault get <NAME> [--pseudokey]
envault list [--json]
envault rm <NAME>
envault import <.env> [--replace]
envault export --to-env
envault run [--env-file <path>] [--no-load-env] [--no-intercept] -- <cmd> [args...]
envault identity unlock         # cache the derived X25519 scalar after a passphrase prompt
envault identity forget         # delete the cached scalar
envault identity show           # fingerprint + cache status
```

## Cross-machine sync

Copy `~/.ssh/envault_key` + `~/.ssh/envault_key.pub` to the other machine (same way you'd copy any SSH key). The vault database `~/.envault/vault.db` contains only ciphertexts, so sync it however you like — git, iCloud Drive, Syncthing.

## Passphrase-protected keys

If `~/.ssh/envault_key` is passphrase-protected (`ssh-keygen -p -f ~/.ssh/envault_key`), envault prompts for the passphrase on the first command that needs to decrypt. On success, the derived X25519 scalar is cached in the OS keychain (macOS Keychain / Linux Secret Service / Windows Credential Manager) via `@napi-rs/keyring`. Subsequent runs are silent until the cache is cleared or the key is rotated.

- `envault identity unlock` — pre-warm the cache at login time (useful after reboot).
- `envault identity forget` — delete the cached scalar for the current key.
- `envault identity show` — print the key fingerprint and cache status.

The cache stores only the 32-byte X25519 scalar (base64-encoded), never the passphrase itself. The scalar is only useful for decrypting this vault, so a leaked keychain entry does not compromise SSH login to servers.

## Node fetch interceptor (`envault/register`)

Some harnesses read API keys from their own config files (not env vars) and build HTTP headers in-process — pi's `~/.pi/agent/auth.json`, Claude Code's credentials, etc. `envault run --` can't help there because the key never hit an env var. The fetch interceptor solves this by monkey-patching `globalThis.fetch` at Node startup to scan outgoing request URLs and headers for `envault-XXXXXXXX` tokens and substitute in-memory before the request goes on the wire.

```bash
# Manual preload — works with any Node 20+ app that uses fetch:
node --import @darrenallatt/env-vault/register app.js

# Or automatic — envault run auto-injects --import when the child is Node:
envault run -- node app.js
envault run -- pi                  # (no effect; pi is not Node directly)
envault run --no-intercept -- ...  # opt out
```

Scope in v0.2:
- Scans URL query strings and request headers.
- Does NOT scan request bodies (deferred to v0.3 behind an opt-in flag).
- Patches `globalThis.fetch` only (not `http.request` / `https.request`).
- Fail-open: any interceptor error falls through to the original fetch.

Security tradeoff: the interceptor pre-loads all decrypted secrets into the Node process memory at install time (fast fetch path, no per-call keystore round-trip). This is strictly worse than plain `envault run --` for memory exposure. Use the interceptor for harnesses you trust in-process but can't rewrite the config of. Paranoid workloads stick with the env-var model.

## Library API

```ts
import { Vault, resolveEnv, resolveString } from '@darrenallatt/env-vault';

// In-process resolution for Node apps
await resolveEnv(process.env);
// process.env.OPENAI_API_KEY was "envault-xxxxxxxx" — now the real value.

const resolved = await resolveString('Bearer envault-71918db9');
// → "Bearer sk-ant-..."

const vault = Vault.open();
const { pseudokey } = vault.set('MY_KEY', 'secret-value');
const back = await vault.get('MY_KEY');
vault.close();
```

## Security notes

- The identity file is an Ed25519 SSH private key. If unencrypted on disk, anyone with read access to `~/.ssh/envault_key` can decrypt the entire vault. This matches the security model of most developers' `~/.ssh/id_ed25519`.
- Pseudokeys are not secret — they can be committed and shared. They're pointers with no meaning outside a local vault.
- The ciphertext format includes a 4-byte magic (`ENV1`) and a version byte; future format changes will bump the version and stay backwards-readable.
- `envault export --to-env` dumps plaintext to stdout; use only for migration or debugging, never redirect to a file unless you plan to delete it.

## Roadmap

**Shipped in 0.2:** OS-keychain caching of the derived scalar (silent unlock), Node fetch interceptor via `envault/register`.

**Planned:**
- **Request body scanning** — opt-in `--scan-body` for the interceptor (JSON + form-urlencoded bodies).
- **CJS `register.cjs`** — preload entrypoint for `--require` (ESM via `--import` is current).
- **`http.request` / `https.request` wrapping** — for SDKs that don't use fetch.
- **Config-file resolver** — `envault resolve settings.json` for arbitrary JSON/YAML/TOML.
- **HTTPS proxy** — `envault proxy` for non-Node tools.
- **Key rotation** — `envault rotate` to re-encrypt all secrets under a new identity.

## License

MIT
