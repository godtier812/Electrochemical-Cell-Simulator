/**
 * Demo state in the query string, so a link reproduces what its sender saw.
 *
 *   /demos/?d4-rct=40&d4-lambda=0.001#demo-impedance
 *
 * Keys are control ids (or a radio group's name), which are already unique
 * across the site, so one query string can carry several demos' state and each
 * demo reads only its own keys. Pure and DOM-free; the DOM side lives in
 * components/demos/runtime.ts.
 */

export type DemoState = Record<string, string>;

/** Compact number text that survives a round trip: 0.001, 2e-5, 298. */
export function formatStateNumber(v: number): string {
  if (!Number.isFinite(v)) return '';
  return String(Number(v.toPrecision(6)));
}

export function encodeState(state: DemoState): string {
  const q = new URLSearchParams();
  for (const key of Object.keys(state).sort()) {
    if (state[key] !== '') q.set(key, state[key]);
  }
  return q.toString();
}

export function decodeState(search: string): DemoState {
  const out: DemoState = {};
  new URLSearchParams(search.replace(/^\?/, '')).forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/**
 * A number from the query string, or null when it is absent or unusable. Out
 * of range values are clamped rather than rejected: a link made before a
 * control's range was narrowed should still open, at the nearest legal value.
 */
export function readStateNumber(state: DemoState, key: string, min: number, max: number): number | null {
  const raw = state[key];
  if (raw === undefined || raw.trim() === '') return null;
  const v = Number(raw);
  if (!Number.isFinite(v)) return null;
  return Math.min(max, Math.max(min, v));
}
