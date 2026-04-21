import { Vault } from '../vault.js';

export async function getCmd(name: string, opts: { pseudokey?: boolean } = {}): Promise<void> {
  const vault = Vault.open();
  try {
    if (opts.pseudokey) {
      const pk = vault.getPseudokey(name);
      if (!pk) {
        console.error(`not found: ${name}`);
        process.exit(1);
      }
      process.stdout.write(pk + '\n');
      return;
    }
    const value = await vault.get(name);
    process.stdout.write(value + '\n');
  } finally {
    vault.close();
  }
}
