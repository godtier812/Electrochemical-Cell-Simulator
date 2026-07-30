/** Site-wide constants. */
export const SITE = {
  name: 'Voltaire',
  tagline:
    'From the double layer to capacity fade. A multiphysics solver for ion transport, interfacial kinetics, degradation, and thermal behaviour in electrochemical cells — with autodiff Jacobians shared across Newton, impedance, and inverse design.',
  description:
    'A multiphysics solver for ion transport, interfacial kinetics, degradation, and thermal behaviour in electrochemical cells.',
  author: 'Ashrith Repaka',
  email: 'repaka.ashrith@gmail.com',
  /**
   * The canonical public address of the project. While the repository is
   * private this is the only thing a visitor can actually open, so it is what
   * citations and structured data point at.
   */
  url: 'https://godtier812.github.io/Electrochemical-Cell-Simulator/',
  github: 'https://github.com/godtier812/Electrochemical-Cell-Simulator',
  repoName: 'Electrochemical-Cell-Simulator',
  license: 'MIT',
} as const;

/**
 * The repository is private while the solver is in development, so every link
 * to SITE.github would be a 404 for a visitor. Gate repository affordances —
 * the header icon, the footer links, the docs edit link, JSON-LD
 * codeRepository — on this flag rather than hard-coding the URL. Flip to true
 * when the repo is published and they all come back at once.
 */
export const REPO_PUBLIC: boolean = false;

/**
 * The contact address, split so it is never emitted into the served HTML as one
 * string. Markup must render it through ObfuscatedEmail rather than using
 * SITE.email, which stays for build-time metadata only (citation files and the
 * like) where no page ever prints it.
 */
export const EMAIL_PARTS = {
  user: 'repaka.ashrith',
  host: 'gmail',
  tld: 'com',
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
  { label: 'about', href: '/about/' },
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
