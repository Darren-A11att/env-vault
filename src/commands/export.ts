import { Vault } from '../vault.js';

function quoteValue(v: string): string {
  if (!/[\s"'$`\\#=]/.test(v)) return v;
  const escaped = v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  return `"${escaped}"`;
}

export async function exportCmd(opts: { toEnv?: boolean } = {}): Promise<void> {
  if (!opts.toEnv) {
    console.error('exportCmd requires --to-env (the only supported output today)');
    process.exit(1);
  }
  const vault = Vault.open();
  try {
    const rows = vault.list();
    for (const r of rows) {
      const value = await vault.get(r.name);
      process.stdout.write(`${r.name}=${quoteValue(value)}\n`);
    }
  } finally {
    vault.close();
  }
}
