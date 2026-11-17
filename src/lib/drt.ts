import { nnls } from './linalg';
import type { C } from './complex';

/**
 * Distribution of relaxation times by Tikhonov-regularised non-negative
 * least squares.
 *
 * Model:  Z(ω) ≈ R_∞ + Σ_k g_k / (1 + iωτ_k),  fitted for residues g_k
 *
 * The returned `gamma` is g_k / dlnTau — a density in ln τ, not the residues.
 * Anything reconstructing Z from it must put the measure back: multiply by
 * `dlnTau` before summing.
 * Fit:    minimise ‖A x − b‖² + λ²‖L γ‖²  subject to x ≥ 0,
 * where x = [R_∞, γ_1 … γ_n], b stacks Re and Im of the measured spectrum,
 * and L is a second-difference operator (smoothness prior on γ only).
 *
 * The Warburg diffusion tail has no single relaxation time; the DRT renders
 * it as a broad band of τ. That is expected behaviour, not an artefact.
 */
export interface DRTResult {
  tau: Float64Array;
  /**
   * Distribution of relaxation times as a **density in ln τ**, in the same
   * units as Z. Integrate it to get a resistance:
   *
   *   R = ∫ γ(τ) dlnτ  ≈  Σ_k γ_k · dlnTau
   *
   * The fit itself produces one residue per τ bin. Those are divided by dlnTau
   * before being returned, which is the standard DRT convention: it makes the
   * area under the plotted curve the resistance the peak represents, and makes
   * that area independent of the grid. Refining nTau from 30 to 240 moves the
   * integral from 25.14 to 25.02 against a true 25.
   *
   * Peak *height* is a different matter and is not grid-independent either way.
   * The true distribution for a single RC arc is a delta, so its density is
   * unbounded and a finer grid simply resolves a taller, narrower spike — the
   * density peak grows 3.2x over that same nTau range while the area holds.
   * Read areas, not heights.
   */
  gamma: Float64Array;
  /** Spacing of the log-spaced τ grid, ln τ_{k+1} − ln τ_k. Constant by construction. */
  dlnTau: number;
  Rinf: number;
  /** relative rms misfit of the reconstruction */
  misfit: number;
}

export function computeDRT(
  omega: Float64Array,
  Z: C[],
  opts: { nTau?: number; lambda?: number } = {}
): DRTResult {
  const nF = omega.length;
  const nTau = opts.nTau ?? 60;
  const lambda = opts.lambda ?? 1e-2;

  // τ grid: one decade beyond the measured window at each end
  const tauLo = 0.1 / Math.max(...omega);
  const tauHi = 10 / Math.min(...omega);
  const tau = new Float64Array(nTau);
  for (let k = 0; k < nTau; k++) {
    tau[k] = Math.pow(10, Math.log10(tauLo) + ((Math.log10(tauHi) - Math.log10(tauLo)) * k) / (nTau - 1));
  }

  const nCols = nTau + 1; // [R_inf, γ...]
  const nRowsData = 2 * nF;
  const nRowsReg = nTau; // second differences (interior) + endpoints damped
  const m = nRowsData + nRowsReg;
  const A = new Float64Array(m * nCols);
  const b = new Float64Array(m);

  // scale: normalise by |Z| spread so λ is dimensionless-ish
  let zScale = 0;
  for (const z of Z) zScale = Math.max(zScale, Math.hypot(z.re, z.im));
  if (zScale === 0) zScale = 1;

  for (let i = 0; i < nF; i++) {
    const w = omega[i];
    const rowRe = i * nCols;
    const rowIm = (nF + i) * nCols;
    A[rowRe] = 1 / zScale; // R_inf contributes to Re only
    for (let k = 0; k < nTau; k++) {
      const wt = w * tau[k];
      const d = 1 + wt * wt;
      A[rowRe + 1 + k] = 1 / d / zScale;
      A[rowIm + 1 + k] = -wt / d / zScale;
    }
    b[i] = Z[i].re / zScale;
    b[nF + i] = Z[i].im / zScale;
  }

  // Tikhonov rows: λ · second difference on γ
  for (let k = 0; k < nTau; k++) {
    const row = (nRowsData + k) * nCols;
    if (k === 0 || k === nTau - 1) {
      A[row + 1 + k] = lambda * 0.5; // light damping at the ends
    } else {
      A[row + 1 + (k - 1)] = lambda;
      A[row + 1 + k] = -2 * lambda;
      A[row + 1 + (k + 1)] = lambda;
    }
  }

  const x = nnls(A, b, m, nCols);
  const Rinf = x[0]; // zScale cancels between A and b, so x is in Ω units
  const gamma = new Float64Array(nTau);
  for (let k = 0; k < nTau; k++) gamma[k] = x[1 + k];

  // reconstruction misfit
  let err = 0;
  let ref = 0;
  for (let i = 0; i < nF; i++) {
    const w = omega[i];
    let re = Rinf;
    let im = 0;
    for (let k = 0; k < nTau; k++) {
      const wt = w * tau[k];
      const d = 1 + wt * wt;
      re += gamma[k] / d;
      im += (-gamma[k] * wt) / d;
    }
    err += (re - Z[i].re) ** 2 + (im - Z[i].im) ** 2;
    ref += Z[i].re ** 2 + Z[i].im ** 2;
  }

  // The fit is in residues, and so is the misfit loop above — the model at the
  // top of this file sums γ_k/(1+iωτ_k) with no measure. Convert to a density
  // in ln τ only now, on the way out. The grid is log-spaced, so the spacing is
  // a single constant and this is one division.
  const dlnTau = nTau > 1 ? Math.log(tauHi / tauLo) / (nTau - 1) : 1;
  for (let k = 0; k < nTau; k++) gamma[k] /= dlnTau;

  return { tau, gamma, dlnTau, Rinf, misfit: Math.sqrt(err / (ref || 1)) };
}

/* ---------------- reading a DRT: peaks, and the choice of λ ---------------- */

export interface DRTPeak {
  /** Relaxation time at the maximum, s. */
  tau: number;
  /** Characteristic frequency 1/(2πτ), Hz. */
  freq: number;
  /**
   * Resistance of the process: the area under the peak in ln τ, between the
   * minima on either side. Same units as Z. This is the grid-independent
   * quantity; the height is not.
   */
  resistance: number;
  /** Effective capacitance τ/R of an RC element with this τ and R, in F (or F/cm² if Z is area-specific). */
  capacitance: number;
  /**
   * True when the maximum lies outside the measured window (τ < 1/ω_max or
   * τ > 1/ω_min). The τ grid extends a decade past the data at each end, and a
   * peak out there is extrapolation, not measurement.
   */
  outsideWindow: boolean;
}

/**
 * Split a DRT into its peaks. A peak is a local maximum of γ that reaches at
 * least `minFraction` of the tallest one; each takes the area between the
 * minima that bound it, so the resistances add up to the area under the whole
 * curve and nothing is counted twice.
 */
export function drtPeaks(drt: DRTResult, omega: ArrayLike<number>, minFraction = 0.03): DRTPeak[] {
  const { tau, gamma, dlnTau } = drt;
  const n = gamma.length;
  let gMax = 0;
  for (let k = 0; k < n; k++) gMax = Math.max(gMax, gamma[k]);
  if (!(gMax > 0)) return [];

  const maxima: number[] = [];
  for (let k = 0; k < n; k++) {
    const left = k > 0 ? gamma[k - 1] : -Infinity;
    const right = k < n - 1 ? gamma[k + 1] : -Infinity;
    if (gamma[k] >= minFraction * gMax && gamma[k] > left && gamma[k] >= right) maxima.push(k);
  }
  if (maxima.length === 0) return [];

  // boundaries: the lowest bin between each pair of neighbouring maxima
  const cuts: number[] = [0];
  for (let m = 0; m < maxima.length - 1; m++) {
    let lo = maxima[m];
    for (let k = maxima[m]; k <= maxima[m + 1]; k++) if (gamma[k] < gamma[lo]) lo = k;
    cuts.push(lo);
  }
  cuts.push(n - 1);

  let wMin = Infinity;
  let wMax = 0;
  for (let i = 0; i < omega.length; i++) {
    wMin = Math.min(wMin, omega[i]);
    wMax = Math.max(wMax, omega[i]);
  }

  return maxima.map((k, m) => {
    const a = cuts[m];
    const b = cuts[m + 1];
    let area = 0;
    for (let i = a; i <= b; i++) {
      // a bin on an interior boundary is shared between the two peaks it separates
      const shared = (i === a && m > 0) || (i === b && m < maxima.length - 1);
      area += gamma[i] * dlnTau * (shared ? 0.5 : 1);
    }
    return {
      tau: tau[k],
      freq: 1 / (2 * Math.PI * tau[k]),
      resistance: area,
      capacitance: area > 0 ? tau[k] / area : Infinity,
      outsideWindow: tau[k] < 1 / wMax || tau[k] > 1 / wMin,
    };
  });
}

export interface LambdaSweepRow {
  lambda: number;
  /** Relative rms misfit of the reconstruction at this λ. */
  misfit: number;
  /** Number of peaks the inversion reports at this λ. */
  peaks: number;
}

/**
 * The inversion repeated over a range of regularisation strengths. There is no
 * neutral λ: too small and noise turns into spikes that look like processes,
 * too large and distinct processes fuse. What can be checked is stability —
 * the same peaks over a decade or more of λ — and this is the data for that
 * check.
 */
export function lambdaSweep(
  omega: Float64Array,
  Z: C[],
  lambdas: number[],
  opts: { nTau?: number } = {}
): LambdaSweepRow[] {
  return lambdas.map((lambda) => {
    const drt = computeDRT(omega, Z, { nTau: opts.nTau, lambda });
    return { lambda, misfit: drt.misfit, peaks: drtPeaks(drt, omega).length };
  });
}

/**
 * A starting value for λ, by the stability criterion: the middle of the
 * longest run of consecutive λ values that all give the same number of peaks.
 * Ties go to the run with the smaller misfit. It is a heuristic for where to
 * start looking, not a claim that this λ is correct.
 */
export function suggestLambda(sweep: LambdaSweepRow[]): number | null {
  if (sweep.length === 0) return null;
  let best: { start: number; len: number; misfit: number } | null = null;
  let start = 0;
  for (let i = 1; i <= sweep.length; i++) {
    if (i === sweep.length || sweep[i].peaks !== sweep[start].peaks) {
      const len = i - start;
      let misfit = 0;
      for (let k = start; k < i; k++) misfit += sweep[k].misfit / len;
      if (sweep[start].peaks > 0 && (!best || len > best.len || (len === best.len && misfit < best.misfit))) {
        best = { start, len, misfit };
      }
      start = i;
    }
  }
  if (!best) return null;
  const a = sweep[best.start].lambda;
  const b = sweep[best.start + best.len - 1].lambda;
  return Math.sqrt(a * b);
}
