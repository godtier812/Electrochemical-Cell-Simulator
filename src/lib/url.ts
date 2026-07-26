/**
 * Prefix a site-internal path with the configured base path.
 * GitHub Pages serves the site from /Electrochemical-Cell-Simulator/, so every
 * internal link, asset and fetch must go through this helper.
 */
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/${path.replace(/^\//, '')}`;
}
