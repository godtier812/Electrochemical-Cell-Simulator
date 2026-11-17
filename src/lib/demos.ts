/**
 * The one list of demos that exist.
 *
 * Prose used to hardcode "five", which went stale the moment a sixth demo
 * landed. Anything that needs to enumerate or count the demos reads this
 * instead, and tests/demos.test.ts checks the registry against the demo
 * components actually present in src/components/demos/, so the two cannot
 * drift apart without failing the build.
 */
import { sample } from './colormaps';

export interface DemoEntry {
  /** Anchor id on /demos/, matching the DemoShell id in D*.astro. */
  id: string;
  /** Panel code as shown in the demo heading. */
  code: string;
  /** Short name for prose and link text. */
  name: string;
  /** What it computes, as a sentence fragment following an em dash. */
  blurb: string;
  /** Precomputed frame under public/posters/, used as the demo's thumbnail. */
  poster: string;
}

export const DEMOS: DemoEntry[] = [
  {
    id: 'demo-butler-volmer',
    code: 'D1',
    name: 'Butler–Volmer kinetics',
    blurb: 'interfacial current against overpotential, with the Tafel limits.',
    poster: 'd1-butler-volmer.svg',
  },
  {
    id: 'demo-double-layer',
    code: 'D2',
    name: 'Double layer',
    blurb:
      'Poisson–Nernst–Planck solved with Scharfetter–Gummel fluxes and damped Newton iteration.',
    poster: 'd2-double-layer.svg',
  },
  {
    id: 'demo-dendrite',
    code: 'D3',
    name: 'Dendrite growth',
    blurb: 'explicit phase-field electrodeposition with crystalline anisotropy.',
    poster: 'd3-dendrite.png',
  },
  {
    id: 'demo-impedance',
    code: 'D4',
    name: 'Impedance',
    blurb:
      'equivalent-circuit spectra, inverted to a distribution of relaxation times by Tikhonov-regularised NNLS.',
    poster: 'd4-impedance.svg',
  },
  {
    id: 'demo-microstructure',
    code: 'D5',
    name: 'Microstructure',
    blurb: 'random sequential adsorption packing and tortuosity from a Laplace solve.',
    poster: 'd5-microstructure.png',
  },
  {
    id: 'demo-discharge',
    code: 'D6',
    name: 'Discharge curve',
    blurb: 'single-particle galvanostatic discharge, cell voltage against capacity.',
    poster: 'd6-discharge.svg',
  },
];

export const DEMO_COUNT = DEMOS.length;

/**
 * Each demo owns one stop on the viridis ramp, so the ramp doubles as the
 * index: the same colour marks a demo in the demos index, on its own toolbar,
 * and wherever it is embedded in a physics page. Stops are spread over
 * 0.12–0.92 rather than 0–1 so the first is not lost against the dark theme
 * and the last is not lost against the light one.
 */
export function demoRampStop(code: string): number {
  const i = Math.max(0, DEMOS.findIndex((d) => d.code === code));
  return DEMOS.length > 1 ? 0.12 + (0.8 * i) / (DEMOS.length - 1) : 0.5;
}

/** The demo's ramp colour, and whichever of ink or paper reads on top of it. */
export function demoAccent(code: string): { bg: string; fg: string } {
  // not a demo (the tools reuse the shell): the theme accent, not a ramp stop
  if (!DEMOS.some((d) => d.code === code)) return { bg: 'var(--accent)', fg: 'var(--bg)' };
  const [r, g, b] = sample('viridis', demoRampStop(code)).map(Math.round);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  // tokens, not hex: tokens.css stays the only place a neutral is spelled out
  return { bg: `rgb(${r} ${g} ${b})`, fg: luminance > 0.3 ? 'var(--carbon)' : 'var(--paper)' };
}
