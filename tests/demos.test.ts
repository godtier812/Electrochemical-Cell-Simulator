import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEMOS, DEMO_COUNT } from '../src/lib/demos';

/**
 * The registry in src/lib/demos.ts is what the prose counts and the docs list
 * are built from, so it is only trustworthy if it cannot drift from the demos
 * that actually ship. These tests read the demo components and the demos page
 * off disk and compare.
 */
const DEMO_DIR = join(import.meta.dirname, '..', 'src', 'components', 'demos');

/** Every D<n>*.astro component, with the DemoShell id it declares. */
function shippedDemos(): { file: string; id: string }[] {
  return readdirSync(DEMO_DIR)
    .filter((f) => /^D\d.*\.astro$/.test(f))
    .sort()
    .map((file) => {
      const src = readFileSync(join(DEMO_DIR, file), 'utf8');
      const m = src.match(/\bid="([^"]+)"/);
      if (!m) throw new Error(`${file} has no DemoShell id`);
      return { file, id: m[1] };
    });
}

describe('demo registry', () => {
  it('lists exactly the demo components that exist, in page order', () => {
    const shipped = shippedDemos();
    expect(shipped.map((d) => d.id)).toEqual(DEMOS.map((d) => d.id));
    expect(DEMO_COUNT).toBe(shipped.length);
  });

  it('matches each component to its declared code', () => {
    // D3Dendrite.astro -> D3, so a renumbered or renamed file is caught too
    for (const { file, id } of shippedDemos()) {
      const entry = DEMOS.find((d) => d.id === id)!;
      expect(file.startsWith(entry.code), `${file} vs code ${entry.code}`).toBe(true);
    }
  });

  it('is actually rendered on the demos page', () => {
    const page = readFileSync(
      join(import.meta.dirname, '..', 'src', 'pages', 'demos.astro'),
      'utf8'
    );
    for (const { file } of shippedDemos()) {
      const component = file.replace(/\.astro$/, '');
      expect(page.includes(`<${component} />`), `${component} missing from demos.astro`).toBe(true);
    }
  });

  it('has unique ids and codes, and no empty prose', () => {
    expect(new Set(DEMOS.map((d) => d.id)).size).toBe(DEMO_COUNT);
    expect(new Set(DEMOS.map((d) => d.code)).size).toBe(DEMO_COUNT);
    for (const d of DEMOS) {
      expect(d.name.length, d.id).toBeGreaterThan(0);
      expect(d.blurb.length, d.id).toBeGreaterThan(0);
    }
  });
});
