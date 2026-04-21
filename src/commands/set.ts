import { Vault } from '../vault.js';

export function setCmd(name: string, value: string): void {
  if (!/^[A-Z_][A-Z0-9_]*$/i.test(name)) {
    console.error(`invalid secret name: ${name}. Use letters, digits, underscore; must not start with a digit.`);
    process.exit(1);
  }
  const vault = Vault.open();
  try {
    const { pseudokey, created } = vault.set(name, value);
    console.log(`${created ? 'added' : 'updated'}: ${name} → ${pseudokey}`);
  } finally {
    vault.close();
  }
}
