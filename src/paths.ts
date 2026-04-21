import * as os from 'node:os';
import * as path from 'node:path';

export function getSshDir(): string {
  return process.env.ENVAULT_SSH_DIR ?? path.join(os.homedir(), '.ssh');
}

export function getEnvaultKeyPath(): string {
  return process.env.ENVAULT_KEY_PATH ?? path.join(getSshDir(), 'envault_key');
}

export function getEnvaultPubPath(): string {
  return process.env.ENVAULT_PUB_PATH ?? `${getEnvaultKeyPath()}.pub`;
}

export function getEnvaultDir(): string {
  return process.env.ENVAULT_HOME ?? path.join(os.homedir(), '.envault');
}

export function getVaultDbPath(): string {
  return path.join(getEnvaultDir(), 'vault.db');
}
