/** Site-wide constants. */
export const SITE = {
  name: 'Voltaire',
  tagline:
    'From the double layer to capacity fade. A multiphysics solver for ion transport, interfacial kinetics, degradation, and thermal behaviour in electrochemical cells, with interactive demos that compute in your browser.',
  description:
    'A multiphysics solver for ion transport, interfacial kinetics, degradation, and thermal behaviour in electrochemical cells.',
  author: 'Ashrith Repaka',
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
 * Whether the GitHub repository is publicly readable.
 *
 * The repository is private while the project is being built, so every link to
 * SITE.github would be a 404 for a visitor, and any sentence promising source
 * to read would be false. Both are gated on this flag: the repository
 * affordances (header icon, footer links, docs edit link, JSON-LD
 * codeRepository) and every sentence whose truth depends on visibility, which
 * lives in components/RepoNote.astro with both variants side by side.
 *
 * GOING PUBLIC — the whole checklist:
 *   1. Flip this to true.
 *   2. Uncomment `repository-code` in CITATION.cff. It is static YAML that no
 *      build step templates, so it is the one thing this flag cannot reach.
 *   3. Change the repository's visibility on GitHub.
 * Nothing else. `npm run build` then `python3 scripts/check-links.py` will
 * confirm; the prose flips with the flag and needs no editing.
 *
 * GitHub Pages already serves this site publicly from the private repository
 * (Pro and above), so going public changes nothing about deployment.
 */
export const REPO_PUBLIC: boolean = false;

/**
 * The contact address, split so it never appears as one string — not in the
 * served HTML, and not in this file either, which becomes readable when the
 * repository goes public.
 *
 * It stays as the real mailbox on purpose: this is the address that receives
 * mail, and the GitHub noreply address used for commit metadata does not.
 * Markup must render it through ObfuscatedEmail, which reassembles it in the
 * browser; nothing should join these parts at build time.
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

/**
 * Top navigation. Numerics sits in the physics sidebar and the roadmap in the
 * project sidebar and the footer, so neither needs a slot of its own up here.
 */
export const NAV: NavEntry[] = [
  { label: 'physics', href: '/physics/' },
  { label: 'demos', href: '/demos/' },
  { label: 'tools', href: '/tools/' },
  { label: 'validation', href: '/validation/' },
  { label: 'docs', href: '/docs/' },
  { label: 'gallery', href: '/gallery/' },
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
  { label: 'Overview', href: '/docs/' },
  { label: 'Using the demos and tools', href: '/docs/using/' },
  { label: 'Kernel reference', href: '/docs/kernels/' },
  { label: 'Run it locally', href: '/docs/local/' },
  { label: 'Python package: design', href: '/docs/python/' },
];

/** Pages about the project rather than the physics. */
export const PROJECT_PAGES = [
  { label: 'About', href: '/about/' },
  { label: 'Roadmap', href: '/roadmap/' },
  { label: 'Cite', href: '/cite/' },
];
