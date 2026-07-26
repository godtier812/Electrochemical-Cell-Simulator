import { type C, c, cadd, cdiv, cinv, cmul, tanhSqrtOverSqrt } from './complex';

/**
 * Equivalent-circuit impedance for the EIS/DRT demo:
 *
 *   Z(ω) = R_Ω + [R_SEI ∥ C_SEI] + [R_ct ∥ C_dl] + Z_W(finite length)
 *
 * with the finite-length (bounded) Warburg
 *   Z_W = R_d · tanh(√(iωτ_d)) / √(iωτ_d),  τ_d = L²/D.
 *
 * The SEI branch is scaled by an "age" parameter so users can watch a second
 * semicircle grow as the film thickens (R_SEI = age · R_SEI,ref).
 */
export interface CircuitParams {
  /** ohmic/electrolyte resistance, Ω·cm² */
  Rohm: number;
  /** charge-transfer resistance, Ω·cm² */
  Rct: number;
  /** double-layer capacitance, F/cm² */
  Cdl: number;
  /** Warburg (diffusion) resistance, Ω·cm² */
  Rd: number;
  /** diffusion time constant L²/D, s */
  tauD: number;
  /** SEI film resistance at age = 1, Ω·cm² */
  Rsei: number;
  /** SEI film capacitance, F/cm² */
  Csei: number;
  /** SEI age multiplier, 0 = fresh cell */
  age: number;
}

export function impedance(omega: number, p: CircuitParams): C {
  const iw = c(0, omega);
  let Z = c(p.Rohm, 0);
  // SEI film: R_SEI(age) ∥ C_SEI
  const Rsei = p.Rsei * p.age;
  if (Rsei > 0) {
    const Ysei = cadd(c(1 / Rsei, 0), cmul(iw, c(p.Csei, 0)));
    Z = cadd(Z, cinv(Ysei));
  }
  // charge transfer ∥ double layer, in series with the Warburg inside the
  // faradaic branch (Randles topology)
  const Zw = cmul(c(p.Rd, 0), tanhSqrtOverSqrt(cmul(iw, c(p.tauD, 0))));
  const Zfar = cadd(c(p.Rct, 0), Zw);
  const Y = cadd(cdiv(c(1, 0), Zfar), cmul(iw, c(p.Cdl, 0)));
  Z = cadd(Z, cinv(Y));
  return Z;
}

/** Logarithmically spaced angular frequencies. */
export function omegaGrid(fMin: number, fMax: number, n: number): Float64Array {
  const out = new Float64Array(n);
  const l0 = Math.log10(fMin);
  const l1 = Math.log10(fMax);
  for (let i = 0; i < n; i++) {
    out[i] = 2 * Math.PI * Math.pow(10, l0 + ((l1 - l0) * i) / (n - 1));
  }
  return out;
}

/** Semi-infinite Warburg coefficient line Z = σ(1−i)/√ω for overlay checks. */
export function warburgAsymptote(sigma: number, omega: number): C {
  const m = sigma / Math.sqrt(omega);
  return c(m, -m);
}
