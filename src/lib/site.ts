/** Site-wide constants. */
export const SITE = {
  name: 'Voltaire',
  tagline:
    'From the double layer to capacity fade. A multiphysics solver for ion transport, interfacial kinetics, degradation, and thermal behaviour in electrochemical cells — with autodiff Jacobians shared across Newton, impedance, and inverse design.',
  description:
    'A multiphysics solver for ion transport, interfacial kinetics, degradation, and thermal behaviour in electrochemical cells.',
  author: 'Ashrith Repaka',
  email: 'repaka.ashrith@gmail.com',
  github: 'https://github.com/godtier812/Electrochemical-Cell-Simulator',
  repoName: 'Electrochemical-Cell-Simulator',
  license: 'MIT',
} as const;

export interface NavEntry {
  label: string;
  href: string;
}

export const NAV: NavEntry[] = [
  { label: 'physics', href: '/physics/' },
  { label: 'numerics', href: '/numerics/' },
  { label: 'demos', href: '/demos/' },
  { label: 'validation', href: '/validation/' },
  { label: 'docs', href: '/docs/' },
  { label: 'gallery', href: '/gallery/' },
  { label: 'roadmap', href: '/roadmap/' },
];

/** Sidebar structure for docs-style layouts. */
export const PHYSICS_PAGES = [
  { label: 'Overview', href: '/physics/' },
  { label: 'Transport', href: '/physics/transport/' },
  { label: 'Kinetics', href: '/physics/kinetics/' },
  { label: 'Degradation', href: '/physics/degradation/' },
  { label: 'Dendrites', href: '/physics/dendrites/' },
  { label: 'Thermal', href: '/physics/thermal/' },
  { label: 'Impedance', href: '/physics/impedance/' },
  { label: 'Numerics', href: '/numerics/' },
];

export const DOCS_PAGES = [
  { label: 'Install', href: '/docs/' },
  { label: 'Quickstart', href: '/docs/quickstart/' },
  { label: 'Configuration', href: '/docs/configuration/' },
  { label: 'Examples', href: '/docs/examples/' },
  { label: 'API reference', href: '/docs/api/' },
];
