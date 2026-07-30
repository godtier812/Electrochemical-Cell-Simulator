/**
 * Single-particle model (SPM) of a galvanostatic discharge.
 *
 * The SPM is the cheapest reduction of the porous-electrode (P2D) picture: it
 * assumes the reaction current is distributed uniformly through each electrode,
 * so a whole electrode collapses onto one representative spherical particle and
 * the electrolyte carries no concentration or potential gradient. What survives
 * is exactly the physics that sets the shape of a discharge curve at moderate
 * rate — solid-state diffusion inside the particles, interfacial kinetics, and
 * the two open-circuit potential curves — which is what this demo is for.
 *
 * What the SPM therefore cannot show, and what the P2D in the Python solver is
 * for: electrolyte depletion down the cell thickness, reaction-current
 * non-uniformity between separator and current collector, and the rate capability
 * limits those impose. Above roughly 2C the curves here are optimistic.
 *
 * Model
 *   Solid diffusion in each particle, spherically symmetric:
 *     ∂c/∂t = (1/r²) ∂/∂r ( D r² ∂c/∂r ),   ∂c/∂r|₀ = 0,   D ∂c/∂r|_R = N_in
 *   solved by finite volume + implicit Euler (tridiagonal, one solve per particle
 *   per step — the same Thomas solver the Cottrell check uses).
 *
 *   Interfacial kinetics, symmetric Butler–Volmer (α_a = α_c = ½), inverted
 *   analytically rather than by Newton because the symmetric case is a sinh:
 *     j = 2 i₀ sinh( Fη / 2RT )   ⟹   η = (2RT/F) asinh( j / 2i₀ )
 *
 *   Terminal voltage:
 *     V = U_p(y_surf) + η_p − U_n(x_surf) − η_n − I R₀
 *
 * Parameters
 *   The open-circuit potential fits for graphite and NMC811 are the functional
 *   forms published by Chen et al., "Development of Experimental Techniques for
 *   Parameterization of Multi-scale Lithium-ion Battery Models", J. Electrochem.
 *   Soc. 167 (2020) 080534, for an LG M50 cell. The geometry, diffusivities and
 *   kinetics below are representative values of that cell format rather than a
 *   validated reproduction of any one published parameter set — they are chosen
 *   to put the cell near 5 A·h with a realistic 1C curve, and the demo makes no
 *   claim to reproduce a measured cell. Nothing on this page is a measurement.
 */

import { solveTridiagonal } from './linalg';
import { F, R as Rgas } from './constants';

/** Open-circuit potential of graphite vs Li/Li⁺, V, as a function of stoichiometry x. */
export function ocpGraphite(x: number): number {
  return (
    1.9793 * Math.exp(-39.3631 * x) +
    0.2482 -
    0.0909 * Math.tanh(29.8538 * (x - 0.1234)) -
    0.04478 * Math.tanh(14.9159 * (x - 0.2769)) -
    0.0205 * Math.tanh(30.4444 * (x - 0.6103))
  );
}

/** Open-circuit potential of NMC811 vs Li/Li⁺, V, as a function of stoichiometry y. */
export function ocpNMC(y: number): number {
  return (
    -0.809 * y +
    4.4875 -
    0.0428 * Math.tanh(18.5138 * (y - 0.5542)) -
    17.7326 * Math.tanh(15.789 * (y - 0.3117)) +
    17.5842 * Math.tanh(15.9308 * (y - 0.312))
  );
}

/** Representative cell: NMC811 positive, graphite negative, LG M50 format. */
export const CELL = {
  /** Current-collector area, m². */
  area: 0.1027,
  neg: {
    thickness: 85.2e-6, // m
    activeFraction: 0.75,
    cMax: 33133, // mol/m³
    /** Stoichiometry at full charge and at full discharge. */
    x100: 0.9014,
    x0: 0.0279,
    /** Exchange current density at half stoichiometry, A/m² — representative. */
    i0Ref: 3.0,
  },
  pos: {
    thickness: 75.6e-6,
    activeFraction: 0.665,
    cMax: 63104,
    y100: 0.2661,
    y0: 0.9084,
    i0Ref: 1.6,
  },
} as const;

export interface SPMParams {
  /** Discharge rate in multiples of the nominal capacity per hour. */
  cRate: number;
  /** Temperature, K. */
  T: number;
  /** Particle radius, m — applied to both electrodes. */
  radius: number;
  /** Solid diffusivity in the negative particle, m²/s. */
  Dn?: number;
  /** Solid diffusivity in the positive particle, m²/s. */
  Dp?: number;
  /** Lumped series resistance (electrolyte, films, foils), Ω. */
  R0?: number;
  /** Lower cut-off voltage, V. */
  vMin?: number;
  /** Radial nodes per particle. */
  nR?: number;
  /** Time steps across the nominal discharge. */
  nSteps?: number;
}

export interface SPMRun {
  /** Number of valid samples in every array below. */
  n: number;
  t: Float64Array; // s
  q: Float64Array; // A·h removed
  v: Float64Array; // terminal voltage, V
  ocv: Float64Array; // U_p − U_n at the surface stoichiometries, V
  xSurf: Float64Array; // negative surface stoichiometry
  ySurf: Float64Array; // positive surface stoichiometry
  /** Total kinetic overpotential magnitude |η_n| + |η_p|, V. */
  eta: Float64Array;
  /** Capacity delivered at cut-off, A·h. */
  capacity: number;
  /** Theoretical capacity of the limiting electrode, A·h. */
  capacityNominal: number;
  /** Mean discharge voltage (energy / capacity), V. */
  meanV: number;
  /** Delivered energy, W·h. */
  energy: number;
  /** Why the run stopped. */
  cutoff: 'voltage' | 'stoichiometry' | 'time';
  /** Applied current, A. */
  current: number;
}

/** Active-material volume of an electrode, m³. */
function activeVolume(e: { thickness: number; activeFraction: number }): number {
  return e.thickness * e.activeFraction * CELL.area;
}

/** Interfacial area of an electrode for spherical particles of radius R, m². */
function interfacialArea(e: { thickness: number; activeFraction: number }, radius: number): number {
  return (3 * activeVolume(e)) / radius;
}

/** Cyclable capacity of one electrode between its stoichiometry limits, A·h. */
function electrodeCapacity(
  e: { thickness: number; activeFraction: number; cMax: number },
  span: number
): number {
  return (activeVolume(e) * e.cMax * span * F) / 3600;
}

/**
 * Build the implicit-Euler tridiagonal system for one step of spherically
 * symmetric diffusion on a uniform radial finite-volume mesh, and solve it.
 * `nIn` is the inward molar flux at the particle surface, mol/(m²·s).
 */
function diffuseSphere(c: Float64Array, D: number, radius: number, dt: number, nIn: number): Float64Array {
  const n = c.length;
  const h = radius / (n - 1);
  const a = new Float64Array(n);
  const b = new Float64Array(n);
  const sup = new Float64Array(n);
  const d = new Float64Array(n);

  /** Face area (÷4π) at r_{i+1/2}. */
  const face = (i: number) => {
    const r = (i + 0.5) * h;
    return r * r;
  };
  /** Control volume (÷4π) of node i. */
  const vol = (i: number) => {
    const rOut = i === n - 1 ? radius : (i + 0.5) * h;
    const rIn = i === 0 ? 0 : (i - 0.5) * h;
    return (rOut * rOut * rOut - rIn * rIn * rIn) / 3;
  };

  for (let i = 0; i < n; i++) {
    const v = vol(i);
    const wOut = i < n - 1 ? (D * dt * face(i)) / (h * v) : 0;
    const wIn = i > 0 ? (D * dt * face(i - 1)) / (h * v) : 0;
    a[i] = -wIn;
    sup[i] = -wOut;
    b[i] = 1 + wIn + wOut;
    d[i] = c[i];
  }
  // Surface flux enters the outermost control volume as a source term.
  d[n - 1] += (dt * radius * radius * nIn) / vol(n - 1);
  return solveTridiagonal(a, b, sup, d);
}

/**
 * Run a constant-current discharge from a fully charged rest state until the
 * voltage cut-off, a stoichiometry limit, or the nominal time is reached.
 */
export function simulateDischarge(p: SPMParams): SPMRun {
  const T = p.T;
  const radius = p.radius;
  const Dn = p.Dn ?? 3.3e-14;
  const Dp = p.Dp ?? 4.0e-15;
  const R0 = p.R0 ?? 0.025;
  const vMin = p.vMin ?? 2.5;
  const nR = p.nR ?? 24;
  const nSteps = p.nSteps ?? 600;

  const { neg, pos } = CELL;
  const capN = electrodeCapacity(neg, neg.x100 - neg.x0);
  const capP = electrodeCapacity(pos, pos.y0 - pos.y100);
  const capacityNominal = Math.min(capN, capP);

  const current = p.cRate * capacityNominal; // A
  const areaN = interfacialArea(neg, radius);
  const areaP = interfacialArea(pos, radius);
  // Molar flux at each surface: Li leaves the negative, enters the positive.
  const nInN = -current / (F * areaN);
  const nInP = current / (F * areaP);
  // Interfacial current densities, signed anodic-positive.
  const jN = current / areaN;
  const jP = -current / areaP;

  const cN = new Float64Array(nR).fill(neg.x100 * neg.cMax);
  const cP = new Float64Array(nR).fill(pos.y100 * pos.cMax);

  // A little past the nominal hour so a slow discharge reaches the voltage
  // cut-off rather than simply running out of simulated time.
  const tEnd = (3600 / p.cRate) * 1.1;
  const dt = tEnd / nSteps;
  const cap = nSteps + 1;
  const t = new Float64Array(cap);
  const q = new Float64Array(cap);
  const v = new Float64Array(cap);
  const ocv = new Float64Array(cap);
  const xSurf = new Float64Array(cap);
  const ySurf = new Float64Array(cap);
  const eta = new Float64Array(cap);

  const twoRTF = (2 * Rgas * T) / F;
  /** Exchange current density with the usual √(c(cmax−c)) stoichiometry dependence. */
  const i0 = (ref: number, c: number, cMax: number) => {
    const s = (c / cMax) * (1 - c / cMax);
    // normalised so i₀ = ref at half stoichiometry, where s = ¼
    return Math.max(1e-9, 2 * ref * Math.sqrt(Math.max(0, s)));
  };

  let n = 0;
  let cutoff: SPMRun['cutoff'] = 'time';
  let energy = 0;
  let prevV = 0;

  for (let k = 0; k <= nSteps; k++) {
    const cNs = cN[nR - 1];
    const cPs = cP[nR - 1];
    const x = cNs / neg.cMax;
    const y = cPs / pos.cMax;

    // x0/y0 are the manufacturer's operating window, not physical bounds: at
    // high rate the surface runs past them while bulk capacity remains, and the
    // voltage cut-off below is what should end the discharge. Only a fully
    // depleted or saturated surface stops the run here.
    if (x <= 1e-4 || y >= 1 - 1e-4) {
      cutoff = 'stoichiometry';
      break;
    }

    const etaN = twoRTF * Math.asinh(jN / (2 * i0(neg.i0Ref, cNs, neg.cMax)));
    const etaP = twoRTF * Math.asinh(jP / (2 * i0(pos.i0Ref, cPs, pos.cMax)));
    const openCircuit = ocpNMC(y) - ocpGraphite(x);
    const terminal = openCircuit + etaP - etaN - current * R0;

    if (terminal < vMin) {
      cutoff = 'voltage';
      break;
    }

    t[n] = k * dt;
    q[n] = (current * t[n]) / 3600;
    v[n] = terminal;
    ocv[n] = openCircuit;
    xSurf[n] = x;
    ySurf[n] = y;
    eta[n] = Math.abs(etaN) + Math.abs(etaP);
    if (n > 0) energy += ((prevV + terminal) / 2) * ((current * dt) / 3600);
    prevV = terminal;
    n++;

    // diffuseSphere reads the whole profile before returning, so writing the
    // result back over the input is safe and keeps one buffer per particle.
    cN.set(diffuseSphere(cN, Dn, radius, dt, nInN));
    cP.set(diffuseSphere(cP, Dp, radius, dt, nInP));
  }

  const capacity = n > 0 ? q[n - 1] : 0;
  return {
    n,
    t,
    q,
    v,
    ocv,
    xSurf,
    ySurf,
    eta,
    capacity,
    capacityNominal,
    meanV: capacity > 0 ? energy / capacity : 0,
    energy,
    cutoff,
    current,
  };
}
