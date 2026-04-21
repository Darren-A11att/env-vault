import { Vault } from '../vault.js';

export function listCmd(opts: { json?: boolean } = {}): void {
  const vault = Vault.open();
  try {
    const rows = vault.list();
    if (opts.json) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    if (rows.length === 0) {
      console.log('(vault is empty)');
      return;
    }
    const maxName = Math.max(...rows.map((r) => r.name.length), 4);
    const header = `${'NAME'.padEnd(maxName)}  PSEUDOKEY             UPDATED`;
    console.log(header);
    for (const r of rows) {
      const when = new Date(r.updated_at * 1000).toISOString().slice(0, 19).replace('T', ' ');
      console.log(`${r.name.padEnd(maxName)}  ${r.pseudokey}     ${when}`);
    }
  } finally {
    vault.close();
  }
}
