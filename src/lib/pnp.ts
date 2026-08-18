import { solveBlockTridiagonal } from './linalg';
import { debyeLength, thermalVoltage } from './constants';

/**
 * 1D steady Poisson–Nernst–Planck for a binary 1:1 electrolyte between a
 * blocking electrode (x = 0, applied potential, zero ionic flux) and a bulk
 * reservoir (x = L, c± = c0, φ = 0).
 *
 * Numerics — deliberately the same treatment the full solver uses:
 *  - nondimensionalised first (ψ = Fφ/RT, ĉ = C/c0, x̂ = x/L); the
 *    dimensional system has condition numbers near 1e15
 *  - Scharfetter–Gummel exponentially fitted fluxes, so the scheme stays
 *    monotone when the cell Péclet number z·Δψ exceeds 2
 *  - fully coupled damped Newton on [c+, c−, ψ] with an analytic
 *    block-tridiagonal Jacobian (Gauss–Seidel between Poisson and transport
 *    diverges at high applied potential)
 *  - graded mesh with ≥10 points inside the Debye length
 *
 * At steady state with a blocking electrode the exact solution of this
 * problem is the nonlinear Poisson–Boltzmann profile, which for a
 * semi-infinite gap is the Gouy–Chapman solution — the analytic overlay the
 * demo draws on top of the numerics.
 */

export interface PNPParams {
  /** gap length, m */
  L: number;
  /** bulk concentration, mol/m³ (1 M = 1000) */
  c0: number;
  /** relative permittivity */
  epsR: number;
  /** temperature, K */
  T: number;
  /** applied electrode potential vs bulk, V */
  Vapp: number;
  /** number of mesh nodes */
  N: number;
}

export interface PNPSolution {
  /** node positions, nondimensional x/L */
  xHat: Float64Array;
  /** ĉ+ = C+/c0 */
  cPlus: Float64Array;
  cMinus: Float64Array;
  /** ψ = Fφ/RT */
  psi: Float64Array;
  /** Debye length, m */
  lambdaD: number;
  converged: boolean;
  newtonIterations: number;
  residualNorm: number;
}

/** Bernoulli function B(x) = x/(eˣ−1), series-expanded near 0. */
export function bernoulli(x: number): number {
  if (Math.abs(x) < 1e-4) return 1 - x / 2 + (x * x) / 12;
  if (x > 500) return 0;
  if (x < -500) return -x;
  return x / (Math.exp(x) - 1);
}

/** dB/dx, series-expanded near 0. */
export function bernoulliPrime(x: number): number {
  if (Math.abs(x) < 1e-4) return -0.5 + x / 6 - (x * x * x) / 180;
  if (x > 500) return 0;
  if (x < -500) return -1;
  const e = Math.exp(x);
  const d = e - 1;
  return (d - x * e) / (d * d);
}

/** Graded mesh on [0,1]: geometric cells, first cell ≈ refined/10 of λ̂. */
export function gradedMesh(N: number, lamHat: number): Float64Array {
  const n = N - 1; // cells
  const hUniform = 1 / n;
  const h0 = Math.min(hUniform, Math.max(lamHat / 10, 1e-6));
  const x = new Float64Array(N);
  if (h0 >= hUniform * 0.999) {
    for (let i = 0; i < N; i++) x[i] = i / n;
    return x;
  }
  // find ratio r with h0 (r^n − 1)/(r − 1) = 1
  let lo = 1.000001;
  let hi = 2;
  const total = (r: number) => (h0 * (Math.pow(r, n) - 1)) / (r - 1);
  while (total(hi) < 1) hi *= 1.5;
  for (let it = 0; it < 80; it++) {
    const mid = (lo + hi) / 2;
    if (total(mid) < 1) lo = mid;
    else hi = mid;
  }
  const r = (lo + hi) / 2;
  let h = h0;
  x[0] = 0;
  for (let i = 1; i < N; i++) {
    x[i] = x[i - 1] + h;
    h *= r;
  }
  // normalise the accumulated rounding so the last node is exactly 1
  const scale = 1 / x[N - 1];
  for (let i = 0; i < N; i++) x[i] *= scale;
  return x;
}

type SourceFn = (x: number) => number;

interface MMSSources {
  fPlus: SourceFn;
  fMinus: SourceFn;
  g: SourceFn;
  /** Dirichlet values from the manufactured solution */
  cPlusExact: SourceFn;
  cMinusExact: SourceFn;
  psiExact: SourceFn;
}

interface NewtonResult {
  cPlus: Float64Array<ArrayBuffer>;
  cMinus: Float64Array<ArrayBuffer>;
  psi: Float64Array<ArrayBuffer>;
  converged: boolean;
  iterations: number;
  residualNorm: number;
}

/**
 * Core Newton solve on the nondimensional system.
 * epsHat = (λD/L)², psiA = applied nondimensional potential at x̂=0.
 * With `mms` present, all boundaries become Dirichlet from the manufactured
 * solution and the given volumetric sources are added.
 */
function newtonSolve(
  xHat: Float64Array,
  epsHat: number,
  psiA: number,
  init: { cPlus: Float64Array; cMinus: Float64Array; psi: Float64Array },
  mms?: MMSSources,
  trace?: (iter: number, rnorm: number, t: number) => void
): NewtonResult {
  const N = xHat.length;
  const m = 3; // unknowns per node: [c+, c−, ψ]
  const h = new Float64Array(N - 1);
  for (let i = 0; i < N - 1; i++) h[i] = xHat[i + 1] - xHat[i];

  const cP = init.cPlus.slice();
  const cM = init.cMinus.slice();
  const psi = init.psi.slice();

  const residual = (cp: Float64Array, cm: Float64Array, ps: Float64Array): Float64Array => {
    const Rr = new Float64Array(N * m);
    const flux = (z: number, cArr: Float64Array, i: number): number => {
      const x = z * (ps[i + 1] - ps[i]);
      return (bernoulli(x) * cArr[i] - bernoulli(-x) * cArr[i + 1]) / h[i];
    };
    for (let i = 0; i < N; i++) {
      const row = i * m;
      if (i === 0) {
        if (mms) {
          Rr[row] = cp[0] - mms.cPlusExact(xHat[0]);
          Rr[row + 1] = cm[0] - mms.cMinusExact(xHat[0]);
          Rr[row + 2] = ps[0] - mms.psiExact(xHat[0]);
        } else {
          Rr[row] = flux(1, cp, 0); // zero-flux electrode
          Rr[row + 1] = flux(-1, cm, 0);
          Rr[row + 2] = ps[0] - psiA;
        }
      } else if (i === N - 1) {
        if (mms) {
          Rr[row] = cp[i] - mms.cPlusExact(xHat[i]);
          Rr[row + 1] = cm[i] - mms.cMinusExact(xHat[i]);
          Rr[row + 2] = ps[i] - mms.psiExact(xHat[i]);
        } else {
          Rr[row] = cp[i] - 1;
          Rr[row + 1] = cm[i] - 1;
          Rr[row + 2] = ps[i];
        }
      } else {
        const hbar = (h[i] + h[i - 1]) / 2;
        Rr[row] = flux(1, cp, i) - flux(1, cp, i - 1);
        Rr[row + 1] = flux(-1, cm, i) - flux(-1, cm, i - 1);
        Rr[row + 2] =
          epsHat * ((ps[i + 1] - ps[i]) / h[i] - (ps[i] - ps[i - 1]) / h[i - 1]) +
          (hbar / 2) * (cp[i] - cm[i]);
        if (mms) {
          Rr[row] -= hbar * mms.fPlus(xHat[i]);
          Rr[row + 1] -= hbar * mms.fMinus(xHat[i]);
          Rr[row + 2] -= hbar * mms.g(xHat[i]);
        }
      }
    }
    return Rr;
  };

  const norm = (v: Float64Array): number => {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[i] * v[i];
    return Math.sqrt(s / v.length);
  };

  let R = residual(cP, cM, psi);
  let rnorm = norm(R);
  let iterations = 0;
  const tol = 1e-11;

  for (let iter = 0; iter < 150 && rnorm > tol; iter++) {
    iterations = iter + 1;
    // assemble block tridiagonal Jacobian
    const A: Float64Array[] = [];
    const B: Float64Array[] = [];
    const Cb: Float64Array[] = [];
    for (let i = 0; i < N; i++) {
      A.push(new Float64Array(m * m));
      B.push(new Float64Array(m * m));
      Cb.push(new Float64Array(m * m));
    }
    // helpers for flux derivatives at interface i (between nodes i and i+1)
    // J = [B(x) c_i − B(−x) c_{i+1}]/h,  x = z (ψ_{i+1} − ψ_i)
    const dFlux = (z: number, cArr: Float64Array, i: number) => {
      const x = z * (psi[i + 1] - psi[i]);
      const Bx = bernoulli(x);
      const Bmx = bernoulli(-x);
      const dBx = bernoulliPrime(x);
      const dBmx = bernoulliPrime(-x);
      return {
        dc_i: Bx / h[i],
        dc_ip: -Bmx / h[i],
        dpsi_i: (-z * (dBx * cArr[i] + dBmx * cArr[i + 1])) / h[i],
        dpsi_ip: (z * (dBx * cArr[i] + dBmx * cArr[i + 1])) / h[i],
      };
    };

    for (let i = 0; i < N; i++) {
      const Bi = B[i];
      const Ai = A[i];
      const Ci = Cb[i];
      const dirichlet = i === N - 1 || (mms && i === 0);
      if (dirichlet) {
        Bi[0] = 1;
        Bi[4] = 1;
        Bi[8] = 1;
        continue;
      }
      if (i === 0) {
        // zero-flux rows for both species + Dirichlet ψ
        const dp = dFlux(1, cP, 0);
        Bi[0] = dp.dc_i;
        Ci[0] = dp.dc_ip;
        Bi[2] = dp.dpsi_i;
        Ci[2] = dp.dpsi_ip;
        const dm = dFlux(-1, cM, 0);
        Bi[4] = dm.dc_i;
        Ci[4] = dm.dc_ip;
        Bi[5] = dm.dpsi_i;
        Ci[5] = dm.dpsi_ip;
        Bi[8] = 1;
        continue;
      }
      const hbar = (h[i] + h[i - 1]) / 2;
      // species +: R = J_i − J_{i−1}
      const pR = dFlux(1, cP, i);
      const pL = dFlux(1, cP, i - 1);
      Bi[0] = pR.dc_i - pL.dc_ip;
      Ci[0] = pR.dc_ip;
      Ai[0] = -pL.dc_i;
      Bi[2] = pR.dpsi_i - pL.dpsi_ip;
      Ci[2] = pR.dpsi_ip;
      Ai[2] = -pL.dpsi_i;
      // species −
      const mR = dFlux(-1, cM, i);
      const mL = dFlux(-1, cM, i - 1);
      Bi[4] = mR.dc_i - mL.dc_ip;
      Ci[4] = mR.dc_ip;
      Ai[4] = -mL.dc_i;
      Bi[5] = mR.dpsi_i - mL.dpsi_ip;
      Ci[5] = mR.dpsi_ip;
      Ai[5] = -mL.dpsi_i;
      // Poisson row
      Bi[6] = hbar / 2;
      Bi[7] = -hbar / 2;
      Bi[8] = -epsHat * (1 / h[i] + 1 / h[i - 1]);
      Ci[8] = epsHat / h[i];
      Ai[8] = epsHat / h[i - 1];
    }

    const negR = new Float64Array(R.length);
    for (let i = 0; i < R.length; i++) negR[i] = -R[i];
    let du: Float64Array;
    try {
      du = solveBlockTridiagonal(A, B, Cb, negR, m);
    } catch {
      return { cPlus: cP, cMinus: cM, psi, converged: false, iterations, residualNorm: rnorm };
    }

    // Damped update. Concentrations move multiplicatively — c·exp(t·δc/c) —
    // which equals the additive Newton step to first order but preserves
    // positivity across the double layer's ~e^12 dynamic range, where an
    // additive line search stalls.
    let t = 1;
    let accepted = false;
    const expClamp = (v: number) => Math.exp(Math.max(-3, Math.min(3, v)));
    for (let ls = 0; ls < 35; ls++) {
      const cpT = new Float64Array(N);
      const cmT = new Float64Array(N);
      const psT = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        cpT[i] = cP[i] * expClamp((t * du[i * m]) / cP[i]);
        cmT[i] = cM[i] * expClamp((t * du[i * m + 1]) / cM[i]);
        psT[i] = psi[i] + t * du[i * m + 2];
      }
      const Rt = residual(cpT, cmT, psT);
      const rt = norm(Rt);
      if (rt < rnorm * (1 - 1e-4 * t) || rt < tol) {
        cP.set(cpT);
        cM.set(cmT);
        psi.set(psT);
        R = Rt;
        rnorm = rt;
        accepted = true;
        trace?.(iter, rnorm, t);
        break;
      }
      t /= 2;
    }
    if (!accepted) {
      return { cPlus: cP, cMinus: cM, psi, converged: rnorm < 1e-7, iterations, residualNorm: rnorm };
    }
  }

  return { cPlus: cP, cMinus: cM, psi, converged: rnorm <= 1e-8, iterations, residualNorm: rnorm };
}

/** Internal Newton solver, exported for verification tests only. */
export const _newtonSolve = newtonSolve;

export function solvePNP(params: PNPParams): PNPSolution {
  const { L, c0, epsR, T, Vapp, N } = params;
  const lambdaD = debyeLength(epsR, T, c0);
  const lamHat = lambdaD / L;
  const epsHat = lamHat * lamHat;
  const psiTarget = Vapp / thermalVoltage(T);

  const xHat = gradedMesh(N, lamHat);
  let cPlus = new Float64Array(N).fill(1);
  let cMinus = new Float64Array(N).fill(1);
  let psi = new Float64Array(N);

  // continuation in applied potential: |Δψ| ≤ 1 per step, each step warm
  // started from a Boltzmann-consistent rescaling of the previous profile
  const steps = Math.max(1, Math.ceil(Math.abs(psiTarget) / 1.0));
  let result: NewtonResult = {
    cPlus,
    cMinus,
    psi,
    converged: true,
    iterations: 0,
    residualNorm: 0,
  };
  let totalIters = 0;
  let psiPrev = 0;
  for (let s = 1; s <= steps; s++) {
    const psiA = (psiTarget * s) / steps;
    if (s === 1) {
      for (let i = 0; i < N; i++) {
        psi[i] = psiA * Math.exp(-xHat[i] / Math.max(lamHat, 1e-6));
      }
    } else {
      const scale = psiA / psiPrev;
      for (let i = 0; i < N; i++) psi[i] *= scale;
    }
    // exact Poisson–Boltzmann relation as the concentration guess
    for (let i = 0; i < N; i++) {
      const clamped = Math.max(-30, Math.min(30, psi[i]));
      cPlus[i] = Math.exp(-clamped);
      cMinus[i] = Math.exp(clamped);
    }
    result = newtonSolve(xHat, epsHat, psiA, { cPlus, cMinus, psi }, undefined);
    totalIters += result.iterations;
    cPlus = result.cPlus;
    cMinus = result.cMinus;
    psi = result.psi;
    psiPrev = psiA;
    if (!result.converged) break;
  }

  return {
    xHat,
    cPlus,
    cMinus,
    psi,
    lambdaD,
    converged: result.converged,
    newtonIterations: totalIters,
    residualNorm: result.residualNorm,
  };
}

/**
 * Gouy–Chapman analytic profile for a 1:1 electrolyte at a single wall:
 *   tanh(ψ/4) = tanh(ψ0/4) · exp(−x/λD)
 * Valid overlay when L ≫ λD. xHat in units of L, lamHat = λD/L.
 */
export function gouyChapman(
  xHat: Float64Array,
  psi0: number,
  lamHat: number
): { psi: Float64Array; cPlus: Float64Array; cMinus: Float64Array } {
  const n = xHat.length;
  const psi = new Float64Array(n);
  const cPlus = new Float64Array(n);
  const cMinus = new Float64Array(n);
  const t0 = Math.tanh(psi0 / 4);
  for (let i = 0; i < n; i++) {
    const t = t0 * Math.exp(-xHat[i] / lamHat);
    psi[i] = 4 * atanh(t);
    cPlus[i] = Math.exp(-psi[i]);
    cMinus[i] = Math.exp(psi[i]);
  }
  return { psi, cPlus, cMinus };
}

function atanh(x: number): number {
  return 0.5 * Math.log((1 + x) / (1 - x));
}

/** Gouy–Chapman differential capacitance C = (ε/λD)·cosh(ψ0/2), F/m². */
export function gcCapacitance(epsR: number, T: number, c0: number, psi0: number): number {
  const lam = debyeLength(epsR, T, c0);
  return ((epsR * 8.8541878128e-12) / lam) * Math.cosh(psi0 / 2);
}

/**
 * Method of manufactured solutions on the full coupled system, uniform mesh.
 * Returns the L2 error of ψ against the manufactured field for each N, from
 * which the observed order of accuracy follows. ε̂ is fixed at 0.05 so the
 * problem is coupled but not boundary-layer dominated at the coarsest mesh.
 */
export interface MMSRow {
  N: number;
  /**
   * The largest cell in the mesh, not 1/(N−1).
   *
   * These are the same number on a uniform mesh and very different on a graded
   * one, where refining N barely moves the coarse end. Reporting 1/(N−1) and
   * calling it h is what made this study appear to lose an order of accuracy on
   * graded meshes: the observed order is a log ratio of errors over a log ratio
   * of spacings, and feeding it a spacing that did not actually halve deflates
   * the result. Measured against the real h_max the scheme holds second order.
   */
  h: number;
  /**
   * Mesh-weighted L2 error, sqrt(Σ h̄ᵢ eᵢ² / Σ h̄ᵢ).
   *
   * An unweighted RMS over nodes is a different quantity on a graded mesh: it
   * counts every node equally, and a graded mesh deliberately puts most of its
   * nodes in the thin layer near the electrode, so the norm reports mostly on
   * the region that is already best resolved.
   */
  error: number;
}

/**
 * Convergence study by the method of manufactured solutions.
 *
 * `ratio` grades the mesh geometrically, 1 being uniform. Pass the value a
 * shipped configuration actually produces to measure the scheme where it runs;
 * `gradedMesh` derives that ratio from λ̂ and N.
 *
 * Both configurations impose Dirichlet conditions on all three fields, because
 * a manufactured solution has to: the exact profiles are prescribed at the
 * boundary nodes. The blocking, zero-flux electrode the demos run is therefore
 * not exercised here, and nothing in this study should be read as covering it.
 */
export function mmsConvergence(Ns: number[], opts: { epsHat?: number; ratio?: number } = {}): MMSRow[] {
  const epsHat = opts.epsHat ?? 0.05;
  const ratio = opts.ratio ?? 1;
  const PI = Math.PI;
  const cpE = (x: number) => 1 + 0.4 * Math.cos(PI * x);
  const cpE1 = (x: number) => -0.4 * PI * Math.sin(PI * x);
  const cpE2 = (x: number) => -0.4 * PI * PI * Math.cos(PI * x);
  const cmE = (x: number) => 1 + 0.4 * Math.cos(2 * PI * x);
  const cmE1 = (x: number) => -0.8 * PI * Math.sin(2 * PI * x);
  const cmE2 = (x: number) => -1.6 * PI * PI * Math.cos(2 * PI * x);
  const psE = (x: number) => 0.8 * Math.sin(PI * x);
  const psE1 = (x: number) => 0.8 * PI * Math.cos(PI * x);
  const psE2 = (x: number) => -0.8 * PI * PI * Math.sin(PI * x);

  // continuum fluxes J± = −(c' ± c ψ'), sources f± = dJ±/dx, g from Poisson
  const fPlus = (x: number) => -(cpE2(x) + cpE1(x) * psE1(x) + cpE(x) * psE2(x));
  const fMinus = (x: number) => -(cmE2(x) - cmE1(x) * psE1(x) - cmE(x) * psE2(x));
  const g = (x: number) => epsHat * psE2(x) + (cpE(x) - cmE(x)) / 2;

  const mms: MMSSources = {
    fPlus,
    fMinus,
    g,
    cPlusExact: cpE,
    cMinusExact: cmE,
    psiExact: psE,
  };

  return Ns.map((N) => {
    const xHat = geometricMesh(N, ratio);
    const init = {
      cPlus: new Float64Array(N).fill(1),
      cMinus: new Float64Array(N).fill(1),
      psi: new Float64Array(N),
    };
    const sol = newtonSolve(xHat, epsHat, 0, init, mms);
    let num = 0;
    let den = 0;
    let hMax = 0;
    for (let i = 0; i < N; i++) {
      const hl = i > 0 ? xHat[i] - xHat[i - 1] : 0;
      const hr = i < N - 1 ? xHat[i + 1] - xHat[i] : 0;
      const hBar = (hl + hr) / 2;
      const e = sol.psi[i] - psE(xHat[i]);
      num += hBar * e * e;
      den += hBar;
      hMax = Math.max(hMax, hr);
    }
    return { N, h: hMax, error: Math.sqrt(num / den) };
  });
}

/** Geometric mesh on [0,1] with a prescribed growth ratio; 1 is uniform. */
function geometricMesh(N: number, ratio: number): Float64Array {
  const n = N - 1;
  const x = new Float64Array(N);
  if (Math.abs(ratio - 1) < 1e-12) {
    for (let i = 0; i < N; i++) x[i] = i / n;
    return x;
  }
  let h = (ratio - 1) / (Math.pow(ratio, n) - 1);
  x[0] = 0;
  for (let i = 1; i < N; i++) {
    x[i] = x[i - 1] + h;
    h *= ratio;
  }
  for (let i = 1; i < N; i++) x[i] /= x[N - 1];
  return x;
}
