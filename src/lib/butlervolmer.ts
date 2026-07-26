import { F, R } from './constants';

/**
 * Butler–Volmer interfacial current density.
 *   j = j0 [ exp(αa F η / RT) − exp(−αc F η / RT) ]
 * j0 in A/cm² (whatever unit j0 carries, j carries), η in volts.
 */
export function butlerVolmer(eta: number, j0: number, alphaA: number, alphaC: number, T: number): number {
  const f = F / (R * T);
  return j0 * (Math.exp(alphaA * f * eta) - Math.exp(-alphaC * f * eta));
}

/** Linearised (micro-polarisation) limit: j ≈ j0 (αa+αc) F η / RT. */
export function butlerVolmerLinear(eta: number, j0: number, alphaA: number, alphaC: number, T: number): number {
  return (j0 * (alphaA + alphaC) * F * eta) / (R * T);
}

/** Anodic/cathodic Tafel branches: |j| = j0 exp(α F |η| / RT). */
export function tafel(eta: number, j0: number, alpha: number, T: number): number {
  return j0 * Math.exp((alpha * F * Math.abs(eta)) / (R * T));
}

/** Tafel slope b = 2.303 RT / (α F), in mV per decade. */
export function tafelSlopeMV(alpha: number, T: number): number {
  return (2.302585 * R * T * 1000) / (alpha * F);
}

/**
 * Half-width of the linear-response region, |η| ≲ RT/F·(1/2)/max(αa,αc)?
 * Convention used on this site: the overpotential at which the linearised
 * current deviates from full Butler–Volmer by 5%.
 */
export function linearRegionMV(j0: number, alphaA: number, alphaC: number, T: number): number {
  let lo = 0;
  let hi = 0.3;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const full = butlerVolmer(mid, j0, alphaA, alphaC, T);
    const lin = butlerVolmerLinear(mid, j0, alphaA, alphaC, T);
    const dev = Math.abs(full - lin) / Math.max(Math.abs(full), 1e-30);
    if (dev > 0.05) hi = mid;
    else lo = mid;
  }
  return lo * 1000;
}
