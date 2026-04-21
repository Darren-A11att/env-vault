// Minimal resolve hook: rewrite relative `.js` specifiers to `.ts` when the
// .ts sibling exists. Used only by the test runner so that source files which
// follow the ESM NodeNext convention (`import './foo.js'`) can be loaded
// directly from .ts without a prior `tsc` step.
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    specifier.endsWith('.js')
  ) {
    const tsSpecifier = `${specifier.slice(0, -3)}.ts`;
    try {
      const candidate = await nextResolve(tsSpecifier, context);
      const p = fileURLToPath(candidate.url);
      await stat(p);
      return candidate;
    } catch {
      // fall through to default
    }
  }
  return nextResolve(specifier, context);
}
