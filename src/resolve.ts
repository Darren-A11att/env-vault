import { scanPseudokeys, isPseudokey, replacePseudokeys } from './pseudokey.js';
import { Vault } from './vault.js';

async function resolveAll(pseudokeys: string[], vault: Vault): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const pk of pseudokeys) {
    const value = await vault.getByPseudokey(pk);
    if (value !== undefined) {
      map.set(pk, value);
    }
  }
  return map;
}

export async function resolveString(input: string, vault?: Vault): Promise<string> {
  const pks = scanPseudokeys(input);
  if (pks.length === 0) return input;
  const v = vault ?? Vault.open();
  const map = await resolveAll(pks, v);
  return replacePseudokeys(input, (pk) => map.get(pk));
}

export async function resolveEnv(
  env: Record<string, string | undefined>,
  vault?: Vault,
): Promise<{ resolved: number }> {
  const pending: string[] = [];
  const keysByPk = new Map<string, string[]>();

  for (const [envKey, envVal] of Object.entries(env)) {
    if (typeof envVal !== 'string') continue;
    if (isPseudokey(envVal)) {
      pending.push(envVal);
      const arr = keysByPk.get(envVal) ?? [];
      arr.push(envKey);
      keysByPk.set(envVal, arr);
    }
  }

  if (pending.length === 0) return { resolved: 0 };

  const v = vault ?? Vault.open();
  const map = await resolveAll(pending, v);

  let resolved = 0;
  for (const [pk, envKeys] of keysByPk) {
    const value = map.get(pk);
    if (value === undefined) continue;
    for (const k of envKeys) {
      env[k] = value;
      resolved++;
    }
  }
  return { resolved };
}
