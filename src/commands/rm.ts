import { Vault } from '../vault.js';

export function rmCmd(name: string): void {
  const vault = Vault.open();
  try {
    const removed = vault.remove(name);
    if (!removed) {
      console.error(`not found: ${name}`);
      process.exit(1);
    }
    console.log(`removed: ${name}`);
  } finally {
    vault.close();
  }
}
