import { solveTridiagonal } from './linalg';
import { F } from './constants';

/**
 * 1D transient diffusion after a potential step (Cottrell experiment):
 *   ∂c/∂t = D ∂²c/∂x²,  c(x,0) = c*,  c(0,t) = 0,  ∂c/∂x(L,t) = 0
 * solved with implicit Euler on a uniform mesh. The simulated current
 *   i(t) = n F A D ∂c/∂x |_{x=0}
 * is compared against the Cottrell solution i(t) = n F A c* √(D/(π t)),
 * which is exact while the depletion layer √(Dt) stays well inside L.
 */
export interface CottrellRun {
  t: Float64Array;
  /** simulated current, A */
  i: Float64Array;
  /** analytic Cottrell current, A */
  iCottrell: Float64Array;
  /** final concentration profile for display */
  x: Float64Array;
  c: Float64Array;
}

export function cottrellStep(opts: {
  D: number; // m²/s
  cStar: number; // mol/m³
  A: number; // m²
  nElectrons: number;
  L: number; // m
  N?: number;
  tEnd?: number; // s
  nSteps?: number;
}): CottrellRun {
  const { D, cStar, A, nElectrons } = opts;
  const N = opts.N ?? 400;
  const L = opts.L;
  const tEnd = opts.tEnd ?? 10;
  const nSteps = opts.nSteps ?? 400;
  const h = L / (N - 1);

  // logarithmically spaced output times resolve the early-time transient
  const tOut = new Float64Array(nSteps);
  const t0 = tEnd / 2000;
  for (let k = 0; k < nSteps; k++) {
    tOut[k] = t0 * Math.pow(tEnd / t0, k / (nSteps - 1));
  }

  const c = new Float64Array(N).fill(cStar);
  c[0] = 0;
  const iSim = new Float64Array(nSteps);
  const iAn = new Float64Array(nSteps);

  const a = new Float64Array(N);
  const b = new Float64Array(N);
  const cc = new Float64Array(N);
  const d = new Float64Array(N);

  let tPrev = 0;
  for (let k = 0; k < nSteps; k++) {
    const dt = tOut[k] - tPrev;
    tPrev = tOut[k];
    const r = (D * dt) / (h * h);
    // implicit Euler: (I − dt D ∂²) c_new = c_old
    b[0] = 1;
    cc[0] = 0;
    d[0] = 0; // c(0) = 0
    for (let i2 = 1; i2 < N - 1; i2++) {
      a[i2] = -r;
      b[i2] = 1 + 2 * r;
      cc[i2] = -r;
      d[i2] = c[i2];
    }
    a[N - 1] = -2 * r; // zero-flux far wall (ghost-node reflection)
    b[N - 1] = 1 + 2 * r;
    d[N - 1] = c[N - 1];
    c.set(solveTridiagonal(a, b, cc, d));
    // three-point one-sided gradient at the electrode
    const grad = (-3 * c[0] + 4 * c[1] - c[2]) / (2 * h);
    iSim[k] = nElectrons * F * A * D * grad;
    iAn[k] = nElectrons * F * A * cStar * Math.sqrt(D / (Math.PI * tOut[k]));
  }

  const x = new Float64Array(N);
  for (let i2 = 0; i2 < N; i2++) x[i2] = i2 * h;
  return { t: tOut, i: iSim, iCottrell: iAn, x, c };
}

/** Sand's time τ = π D (c0 n F)² / (4 J² t_a²) for dendrite onset, seconds. */
export function sandsTime(D: number, c0: number, nElectrons: number, J: number, tPlus: number): number {
  const ta = 1 - tPlus; // anion transference number
  return (Math.PI * D * Math.pow(c0 * nElectrons * F, 2)) / (4 * J * J * ta * ta);
}
