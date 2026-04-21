import { randomBytes } from 'node:crypto';

const PREFIX = 'envault-';
const RE = /envault-[0-9a-f]{8,12}/g;
const SINGLE = /^envault-[0-9a-f]{8,12}$/;

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = c ^ data[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function generatePseudokey(name: string, existing: (pk: string) => boolean): string {
  const nameBytes = new TextEncoder().encode(name);
  for (let attempt = 0; attempt < 256; attempt++) {
    const salt = new Uint8Array(randomBytes(4));
    const combined = new Uint8Array(nameBytes.length + salt.length);
    combined.set(nameBytes);
    combined.set(salt, nameBytes.length);
    const hex = crc32(combined).toString(16).padStart(8, '0');
    const pk = `${PREFIX}${hex}`;
    if (!existing(pk)) {
      return pk;
    }
  }
  throw new Error('pseudokey collision: exhausted 256 attempts (this should never happen)');
}

export function isPseudokey(value: string): boolean {
  return SINGLE.test(value);
}

export function scanPseudokeys(text: string): string[] {
  const matches = text.match(RE);
  return matches ? Array.from(new Set(matches)) : [];
}

export function replacePseudokeys(text: string, resolver: (pk: string) => string | undefined): string {
  return text.replace(RE, (match) => resolver(match) ?? match);
}
