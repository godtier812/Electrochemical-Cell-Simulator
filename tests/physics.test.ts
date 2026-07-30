import { describe, expect, it } from 'vitest';
import { bernoulli, bernoulliPrime, gouyChapman, mmsConvergence, solvePNP } from '../src/lib/pnp';
import { butlerVolmer, butlerVolmerLinear, tafelSlopeMV } from '../src/lib/butlervolmer';
import { computeDRT } from '../src/lib/drt';
import { impedance, omegaGrid, type CircuitParams } from '../src/lib/eis';
import { cottrellStep } from '../src/lib/diffusion';
import { generateRSA, mulberry32, solveTransport } from '../src/lib/microstructure';
import { debyeLength, thermalVoltage } from '../src/lib/constants';
import { CELL, ocpGraphite, ocpNMC, simulateDischarge } from '../src/lib/spm';

describe('Bernoulli function', () => {
  it('is smooth through zero and matches the exact form away from it', () => {
    expect(bernoulli(0)).toBeCloseTo(1, 12);
    expect(bernoulli(1e-6)).toBeCloseTo(1 - 5e-7, 10);
    expect(bernoulli(2)).toBeCloseTo(2 / (Math.exp(2) - 1), 12);
    expect(bernoulli(-2)).toBeCloseTo(-2 / (Math.exp(-2) - 1), 12);
    // B(-x) - B(x) = x identity
    for (const x of [0.5, 1, 3, 10]) {
      expect(bernoulli(-x) - bernoulli(x)).toBeCloseTo(x, 9);
    }
    // derivative vs finite difference
    for (const x of [-3, -0.5, 0.01, 2]) {
      const fd = (bernoulli(x + 1e-6) - bernoulli(x - 1e-6)) / 2e-6;
      expect(bernoulliPrime(x)).toBeCloseTo(fd, 5);
    }
  });
});

describe('Butler-Volmer', () => {
  it('reduces to the linear form near equilibrium', () => {
    const j0 = 1e-3;
    const T = 298.15;
    const eta = 1e-4;
    expect(butlerVolmer(eta, j0, 0.5, 0.5, T)).toBeCloseTo(butlerVolmerLinear(eta, j0, 0.5, 0.5, T), 8);
  });

  it('has the textbook Tafel slope: ~118 mV/decade at alpha=0.5, 25°C', () => {
    expect(tafelSlopeMV(0.5, 298.15)).toBeGreaterThan(117);
    expect(tafelSlopeMV(0.5, 298.15)).toBeLessThan(119);
  });
});

describe('PNP double layer', () => {
  it('Debye length follows the 0.304 nm/√I rule (0.30 nm at 1 M, 0.96 nm at 0.1 M)', () => {
    expect(debyeLength(78.5, 298.15, 1000) * 1e9).toBeCloseTo(0.304, 2);
    expect(debyeLength(78.5, 298.15, 100) * 1e9).toBeCloseTo(0.962, 2);
  });

  it('Newton converges and reproduces Gouy-Chapman at moderate potential', () => {
    const T = 298.15;
    const sol = solvePNP({ L: 50e-9, c0: 100, epsR: 78.5, T, Vapp: 0.1, N: 240 });
    expect(sol.converged).toBe(true);
    const psi0 = 0.1 / thermalVoltage(T);
    const gc = gouyChapman(sol.xHat, psi0, sol.lambdaD / 50e-9);
    // compare potential profile point-by-point (skip far-field noise floor)
    let maxErr = 0;
    for (let i = 0; i < sol.xHat.length; i++) {
      if (sol.xHat[i] > 0.5) break;
      maxErr = Math.max(maxErr, Math.abs(sol.psi[i] - gc.psi[i]));
    }
    expect(maxErr).toBeLessThan(0.02 * psi0);
  });

  it('handles ±0.3 V via continuation (|psi| ~ 11.7) and stays positive', () => {
    const sol = solvePNP({ L: 50e-9, c0: 100, epsR: 78.5, T: 298.15, Vapp: -0.3, N: 240 });
    expect(sol.converged).toBe(true);
    for (const v of sol.cPlus) expect(v).toBeGreaterThan(0);
    for (const v of sol.cMinus) expect(v).toBeGreaterThan(0);
    // cations accumulate at a negative electrode
    expect(sol.cPlus[0]).toBeGreaterThan(100);
  });

  it('MMS shows ~2nd order spatial convergence', () => {
    const rows = mmsConvergence([26, 51, 101, 201]);
    const orders: number[] = [];
    for (let i = 1; i < rows.length; i++) {
      orders.push(Math.log(rows[i - 1].error / rows[i].error) / Math.log(rows[i - 1].h / rows[i].h));
    }
    const finest = orders[orders.length - 1];
    expect(finest).toBeGreaterThan(1.8);
    expect(finest).toBeLessThan(2.4);
  });
});

describe('EIS + DRT', () => {
  const base: CircuitParams = {
    Rohm: 10,
    Rct: 25,
    Cdl: 2e-5,
    Rd: 0,
    tauD: 1,
    Rsei: 0,
    Csei: 1e-4,
    age: 0,
  };

  it('single RC arc: apex frequency at 1/(Rct·Cdl)', () => {
    const wPeak = 1 / (base.Rct * base.Cdl);
    const z = impedance(wPeak, base);
    // at the apex, -Im = Rct/2 and Re = Rohm + Rct/2
    expect(-z.im).toBeCloseTo(base.Rct / 2, 6);
    expect(z.re).toBeCloseTo(base.Rohm + base.Rct / 2, 6);
  });

  it('finite-length Warburg tends to 45° at high frequency', () => {
    const p = { ...base, Rct: 1e-9, Cdl: 1e-12, Rd: 50, tauD: 2 };
    const w = 400 / p.tauD; // deep in the semi-infinite regime
    const z = impedance(w, p);
    const angle = Math.atan2(-z.im, z.re - p.Rohm);
    expect(angle).toBeGreaterThan((40 * Math.PI) / 180);
    expect(angle).toBeLessThan((50 * Math.PI) / 180);
  });

  it('DRT recovers the RC time constant', () => {
    const omega = omegaGrid(0.01, 1e5, 60);
    const Z = Array.from(omega, (w) => impedance(w, base));
    const drt = computeDRT(omega, Z, { nTau: 60, lambda: 1e-3 });
    expect(drt.misfit).toBeLessThan(0.02);
    expect(drt.Rinf).toBeCloseTo(base.Rohm, 0);
    // gamma integrates (sums) to ~Rct and peaks near tau = Rct*Cdl
    let sum = 0;
    let peakTau = 0;
    let peakVal = 0;
    for (let k = 0; k < drt.tau.length; k++) {
      sum += drt.gamma[k];
      if (drt.gamma[k] > peakVal) {
        peakVal = drt.gamma[k];
        peakTau = drt.tau[k];
      }
    }
    expect(sum).toBeGreaterThan(0.9 * base.Rct);
    expect(sum).toBeLessThan(1.1 * base.Rct);
    const tauTrue = base.Rct * base.Cdl;
    expect(Math.abs(Math.log10(peakTau / tauTrue))).toBeLessThan(0.35);
  });

  it('aged cell shows a second resolvable DRT peak', () => {
    const aged: CircuitParams = { ...base, Rsei: 12, Csei: 2e-3, age: 1 };
    const omega = omegaGrid(0.01, 1e5, 60);
    const Z = Array.from(omega, (w) => impedance(w, aged));
    const drt = computeDRT(omega, Z, { nTau: 60, lambda: 1e-3 });
    // count local maxima above 5% of max
    let peaks = 0;
    const g = drt.gamma;
    const gMax = Math.max(...g);
    for (let k = 1; k < g.length - 1; k++) {
      if (g[k] > g[k - 1] && g[k] >= g[k + 1] && g[k] > 0.05 * gMax) peaks++;
    }
    expect(peaks).toBeGreaterThanOrEqual(2);
  });
});

describe('Cottrell step', () => {
  it('simulated current matches the analytic i(t) within 2% mid-window', () => {
    const run = cottrellStep({
      D: 1e-9,
      cStar: 1,
      A: 1e-4,
      nElectrons: 1,
      L: 400e-6,
      N: 600,
      tEnd: 5,
      nSteps: 300,
    });
    let checked = 0;
    for (let k = 0; k < run.t.length; k++) {
      const t = run.t[k];
      if (t < 0.05 || t > 2) continue; // skip start-up error and wall effects
      const rel = Math.abs(run.i[k] - run.iCottrell[k]) / run.iCottrell[k];
      expect(rel).toBeLessThan(0.02);
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });
});

describe('microstructure', () => {
  it('empty domain has D_eff/D0 = 1 and tortuosity 1', () => {
    const ms = generateRSA({ nx: 64, ny: 48, solidFraction: 0, radius: 6, spread: 0, rng: mulberry32(1) });
    const tr = solveTransport(ms);
    expect(tr.converged).toBe(true);
    expect(tr.deffRatio).toBeCloseTo(1, 3);
    expect(tr.tortuosity).toBeCloseTo(1, 3);
  });

  it('packed electrode: porosity near target, D_eff below Bruggeman-free value', () => {
    const ms = generateRSA({
      nx: 96,
      ny: 72,
      solidFraction: 0.45,
      radius: 7,
      spread: 0.3,
      rng: mulberry32(7),
    });
    expect(ms.porosity).toBeGreaterThan(0.4);
    expect(ms.porosity).toBeLessThan(0.7);
    const tr = solveTransport(ms);
    expect(tr.converged).toBe(true);
    expect(tr.deffRatio).toBeLessThan(ms.porosity); // transport worse than volume fraction
    expect(tr.deffRatio).toBeGreaterThan(0.05);
    expect(tr.tortuosity).toBeGreaterThan(1);
  });
});

describe('single-particle discharge', () => {
  it('open-circuit potentials fall monotonically across their operating windows', () => {
    const { neg, pos } = CELL;
    for (let i = 1; i <= 100; i++) {
      const xa = neg.x0 + ((neg.x100 - neg.x0) * (i - 1)) / 100;
      const xb = neg.x0 + ((neg.x100 - neg.x0) * i) / 100;
      expect(ocpGraphite(xb)).toBeLessThanOrEqual(ocpGraphite(xa) + 1e-9);
      const ya = pos.y100 + ((pos.y0 - pos.y100) * (i - 1)) / 100;
      const yb = pos.y100 + ((pos.y0 - pos.y100) * i) / 100;
      expect(ocpNMC(yb)).toBeLessThanOrEqual(ocpNMC(ya) + 1e-9);
    }
  });

  it('rests near 4.2 V charged and near the 2.5 V cut-off discharged', () => {
    const { neg, pos } = CELL;
    const full = ocpNMC(pos.y100) - ocpGraphite(neg.x100);
    const empty = ocpNMC(pos.y0) - ocpGraphite(neg.x0);
    expect(full).toBeGreaterThan(4.0);
    expect(full).toBeLessThan(4.3);
    expect(empty).toBeGreaterThan(2.3);
    expect(empty).toBeLessThan(2.7);
  });

  it('counts coulombs: reported capacity equals the integrated current', () => {
    const run = simulateDischarge({ cRate: 1, T: 298.15, radius: 6e-6 });
    const tEnd = run.t[run.n - 1];
    expect(run.capacity).toBeCloseTo((run.current * tEnd) / 3600, 9);
    // and the delivered energy is consistent with the mean voltage
    expect(run.energy).toBeCloseTo(run.meanV * run.capacity, 6);
  });

  it('approaches the open-circuit curve as the rate falls', () => {
    const slow = simulateDischarge({ cRate: 0.05, T: 298.15, radius: 6e-6 });
    let worst = 0;
    for (let i = 0; i < slow.n; i++) worst = Math.max(worst, Math.abs(slow.ocv[i] - slow.v[i]));
    // at C/20 the only gap left is kinetics and the series drop, both small
    expect(worst).toBeLessThan(0.05);
    expect(slow.capacity).toBeGreaterThan(0.97 * slow.capacityNominal);
  });

  it('loses capacity and mean voltage as the rate rises', () => {
    const rates = [0.5, 1, 2, 3].map((cRate) => simulateDischarge({ cRate, T: 298.15, radius: 6e-6 }));
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i].capacity).toBeLessThan(rates[i - 1].capacity);
      expect(rates[i].meanV).toBeLessThan(rates[i - 1].meanV);
    }
    expect(rates[0].capacity).toBeGreaterThan(0.9 * rates[0].capacityNominal);
  });

  it('bigger particles discharge less at the same rate', () => {
    const small = simulateDischarge({ cRate: 2, T: 298.15, radius: 3e-6 });
    const big = simulateDischarge({ cRate: 2, T: 298.15, radius: 10e-6 });
    expect(big.capacity).toBeLessThan(small.capacity);
  });

  it('conserves lithium: capacity never exceeds the limiting electrode', () => {
    for (const cRate of [0.2, 1, 3]) {
      const run = simulateDischarge({ cRate, T: 298.15, radius: 6e-6 });
      expect(run.capacity).toBeLessThanOrEqual(run.capacityNominal * 1.02);
      expect(run.v[0]).toBeGreaterThan(run.v[run.n - 1]);
    }
  });
});
