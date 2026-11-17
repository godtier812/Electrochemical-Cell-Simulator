/**
 * The formulas behind the bench calculators. Each is one line of physics, so
 * the value of collecting them is that the calculators, the demos and the
 * tests all call the same function: a calculator cannot quietly disagree with
 * the demo that uses the same quantity. Where a formula already existed in a
 * kernel it is re-exported from there rather than written twice.
 *
 * SI throughout unless a name says otherwise.
 */
import { F, R, debyeLength, thermalVoltage } from './constants';
import { tafelSlopeMV } from './butlervolmer';
import { sandsTime } from './diffusion';

export { thermalVoltage, tafelSlopeMV, sandsTime };

/**
 * Debye length of a symmetric z:z electrolyte, m. εr relative permittivity,
 * T in K, c the salt concentration in mol/m³. The 1:1 case is
 * constants.debyeLength; a z:z salt has ionic strength z²c, which shortens the
 * length by a factor z.
 */
export function debyeLengthSymmetric(epsR: number, T: number, c: number, z = 1): number {
  return debyeLength(epsR, T, c) / Math.abs(z);
}

/**
 * Small-signal charge-transfer resistance R_ct = RT / ((αa+αc) F j0), from the
 * linearised Butler–Volmer equation. j0 in A/cm² gives Ω·cm².
 */
export function chargeTransferResistance(j0: number, T: number, alphaSum = 1): number {
  return (R * T) / (alphaSum * F * j0);
}

/** Nernst slope (RT/nF)·ln 10, in mV per decade of activity ratio. */
export function nernstSlopeMV(T: number, n = 1): number {
  return (1000 * Math.LN10 * R * T) / (n * F);
}

/** Nernst potential E = E0 + (RT/nF) ln(a_ox/a_red), V. */
export function nernstPotential(E0: number, T: number, n: number, ratio: number): number {
  return E0 + ((R * T) / (n * F)) * Math.log(ratio);
}

/** Time for diffusion across a length L: t = L²/D, s. */
export function diffusionTime(L: number, D: number): number {
  return (L * L) / D;
}

/** Diffusion length after time t: √(D t), m. (Some texts quote 2√(Dt); this is the plain root.) */
export function diffusionLength(D: number, t: number): number {
  return Math.sqrt(D * t);
}

/** Cottrell current i(t) = n F A c* √(D/πt), A. A in m², c* in mol/m³. */
export function cottrellCurrent(n: number, A: number, cStar: number, D: number, t: number): number {
  return n * F * A * cStar * Math.sqrt(D / (Math.PI * t));
}

/** Current for a given C-rate: I = C-rate × capacity. Capacity in A·h gives A. */
export function cRateCurrent(cRate: number, capacityAh: number): number {
  return cRate * capacityAh;
}

/** Nominal time to discharge fully at a constant C-rate, in hours: 1/C. */
export function cRateHours(cRate: number): number {
  return 1 / cRate;
}

/** Bruggeman effective-transport ratio D_eff/D0 = ε^b, with b = 1.5 for packed spheres. */
export function bruggemanRatio(porosity: number, exponent = 1.5): number {
  return Math.pow(porosity, exponent);
}

/** Tortuosity implied by D_eff/D0 = ε/τ. For Bruggeman with b = 1.5 this is ε^-0.5. */
export function tortuosityFromRatio(porosity: number, deffRatio: number): number {
  return porosity / deffRatio;
}

/** Time constant τ = RC of a parallel RC element, s. */
export function rcTimeConstant(R: number, C: number): number {
  return R * C;
}

/** Apex frequency of an RC arc on a Nyquist plot, f = 1/(2πRC), Hz. */
export function rcApexFrequency(R: number, C: number): number {
  return 1 / (2 * Math.PI * R * C);
}
