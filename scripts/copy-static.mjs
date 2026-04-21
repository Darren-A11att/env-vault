// Copy static UI assets from src/ui/public → dist/ui/public.
// Runs after `tsc` as part of `npm run build`.
import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const src = resolve(projectRoot, 'src/ui/public');
const dest = resolve(projectRoot, 'dist/ui/public');

await mkdir(dirname(dest), { recursive: true });
await cp(src, dest, { recursive: true, force: true });
console.log(`[copy-static] ${src} → ${dest}`);
