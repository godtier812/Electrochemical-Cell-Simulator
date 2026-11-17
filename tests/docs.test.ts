import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KERNELS } from '../src/lib/kernel-docs';

const LIB = join(import.meta.dirname, '..', 'src', 'lib');

/**
 * The kernel reference is data (src/lib/kernel-docs.ts) so that it can be
 * held to the code. A reference that names a function the code no longer has
 * is worse than no reference: it sends a reader looking for something that is
 * not there.
 */
describe('kernel reference', () => {
  it('lists only modules that exist, each once', () => {
    const files = new Set(readdirSync(LIB));
    for (const m of KERNELS) expect(files.has(m.file), m.file).toBe(true);
    expect(new Set(KERNELS.map((m) => m.file)).size).toBe(KERNELS.length);
  });

  it('every documented value is exported by its module', async () => {
    for (const m of KERNELS) {
      const mod = (await import(`../src/lib/${m.file.replace(/\.ts$/, '')}`)) as Record<string, unknown>;
      for (const e of m.exports) {
        if (e.kind === 'type') continue;
        expect(e.name in mod, `${m.file} does not export ${e.name}`).toBe(true);
        if (e.kind === 'function' || e.kind === undefined || e.kind === 'class') {
          expect(typeof mod[e.name], `${m.file}: ${e.name} is not callable`).toBe('function');
        }
      }
    }
  });

  it('every documented type is declared and exported by its module', () => {
    for (const m of KERNELS) {
      const src = readFileSync(join(LIB, m.file), 'utf8');
      for (const e of m.exports.filter((x) => x.kind === 'type')) {
        const declared = new RegExp(`export (interface|type) ${e.name}\\b`).test(src);
        expect(declared, `${m.file} does not export type ${e.name}`).toBe(true);
      }
    }
  });

  it('names each export once per module, with a signature and a summary', () => {
    for (const m of KERNELS) {
      expect(new Set(m.exports.map((e) => e.name)).size, m.file).toBe(m.exports.length);
      for (const e of m.exports) {
        expect(e.signature.length, `${m.file}: ${e.name}`).toBeGreaterThan(0);
        expect(e.summary.length, `${m.file}: ${e.name}`).toBeGreaterThan(0);
      }
    }
  });
});
