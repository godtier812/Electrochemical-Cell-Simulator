/**
 * Build-time provenance for the footer.
 *
 * "In development" projects go stale silently: a visitor six months from now
 * cannot tell whether the site is alive without a date on it. This reads the
 * last commit at build time — `actions/checkout@v4` clones at depth 1, which is
 * enough for `git log -1` — and falls back to the build date wherever git is
 * unavailable (a tarball, a sandbox, a fresh clone with no history).
 *
 * Node-only: this module is imported from .astro frontmatter, which runs during
 * the build and never ships to the browser.
 */
import { execFileSync } from 'node:child_process';

function lastCommitDate(): Date {
  try {
    const iso = execFileSync('git', ['log', '-1', '--format=%cI'], {
      cwd: import.meta.dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d;
  } catch {
    // no git, no repository, or a build from an exported archive
  }
  return new Date();
}

const updated = lastCommitDate();

export const BUILD = {
  /** Machine-readable, for <time datetime>. */
  iso: updated.toISOString(),
  /** e.g. "28 July 2026". */
  label: updated.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }),
} as const;
