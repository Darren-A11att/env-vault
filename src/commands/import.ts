import * as fs from 'node:fs';
import * as path from 'node:path';
import dotenv from 'dotenv';
import { Vault } from '../vault.js';
import { isPseudokey } from '../pseudokey.js';

export function importCmd(envFile: string, opts: { replace?: boolean } = {}): void {
  const resolved = path.resolve(envFile);
  if (!fs.existsSync(resolved)) {
    console.error(`file not found: ${resolved}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(resolved, 'utf8');
  const parsed = dotenv.parse(raw);
  const names = Object.keys(parsed);
  if (names.length === 0) {
    console.error(`no key=value pairs parsed from ${resolved}`);
    process.exit(1);
  }

  const vault = Vault.open();
  const mappings: Array<{ name: string; pseudokey: string; skipped: boolean }> = [];
  try {
    for (const name of names) {
      const value = parsed[name];
      if (isPseudokey(value)) {
        mappings.push({ name, pseudokey: value, skipped: true });
        continue;
      }
      const { pseudokey } = vault.set(name, value);
      mappings.push({ name, pseudokey, skipped: false });
    }
  } finally {
    vault.close();
  }

  const imported = mappings.filter((m) => !m.skipped).length;
  const skipped = mappings.length - imported;
  console.log(`imported ${imported} secrets${skipped > 0 ? ` (${skipped} already pseudokeys, skipped)` : ''}.`);

  if (opts.replace) {
    const rewritten = rewriteEnvFile(raw, mappings);
    fs.writeFileSync(resolved, rewritten);
    console.log(`rewrote ${resolved} with pseudokeys. Real values are now only in the vault.`);
  } else {
    console.log('Pseudokey mapping:');
    for (const m of mappings) {
      console.log(`  ${m.name}=${m.pseudokey}${m.skipped ? ' (already pseudokey)' : ''}`);
    }
    console.log('');
    console.log(`Pass --replace to rewrite ${resolved} in place.`);
  }
}

function rewriteEnvFile(raw: string, mappings: Array<{ name: string; pseudokey: string }>): string {
  const lookup = new Map(mappings.map((m) => [m.name, m.pseudokey]));
  const lines = raw.split(/\r?\n/);
  const out: string[] = [];
  const assignRe = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith('#')) {
      out.push(line);
      continue;
    }
    const m = line.match(assignRe);
    if (!m) {
      out.push(line);
      continue;
    }
    const [, prefix, name] = m;
    if (lookup.has(name)) {
      out.push(`${prefix}${name}=${lookup.get(name)}`);
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
}
