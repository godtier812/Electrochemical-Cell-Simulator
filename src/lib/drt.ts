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
