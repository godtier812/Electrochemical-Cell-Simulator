/**
 * The one list of demos that exist.
 *
 * Prose used to hardcode "five", which went stale the moment a sixth demo
 * landed. Anything that needs to enumerate or count the demos reads this
 * instead, and tests/demos.test.ts checks the registry against the demo
 * components actually present in src/components/demos/, so the two cannot
 * drift apart without failing the build.
 */
export interface DemoEntry {
  /** Anchor id on /demos/, matching the DemoShell id in D*.astro. */
  id: string;
  /** Panel code as shown in the demo heading. */
  code: string;
  /** Short name for prose and link text. */
  name: string;
  /** What it computes, as a sentence fragment following an em dash. */
  blurb: string;
}

export const DEMOS: DemoEntry[] = [
  {
    id: 'demo-butler-volmer',
    code: 'D1',
    name: 'Butler–Volmer kinetics',
    blurb: 'interfacial current against overpotential, with the Tafel limits.',
  },
  {
    id: 'demo-double-layer',
    code: 'D2',
    name: 'Double layer',
    blurb:
      'Poisson–Nernst–Planck solved with Scharfetter–Gummel fluxes and damped Newton iteration.',
  },
  {
    id: 'demo-dendrite',
    code: 'D3',
    name: 'Dendrite growth',
    blurb: 'explicit phase-field electrodeposition with crystalline anisotropy.',
  },
  {
    id: 'demo-impedance',
    code: 'D4',
    name: 'Impedance',
    blurb:
      'equivalent-circuit spectra, inverted to a distribution of relaxation times by Tikhonov-regularised NNLS.',
  },
  {
    id: 'demo-microstructure',
    code: 'D5',
    name: 'Microstructure',
    blurb: 'random sequential adsorption packing and tortuosity from a Laplace solve.',
  },
  {
    id: 'demo-discharge',
    code: 'D6',
    name: 'Discharge curve',
    blurb: 'single-particle galvanostatic discharge, cell voltage against capacity.',
  },
];

export const DEMO_COUNT = DEMOS.length;
