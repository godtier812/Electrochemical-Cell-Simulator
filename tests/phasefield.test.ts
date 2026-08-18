import { describe, expect, it } from 'vitest';
import {
  CLAMP_ALARM_FRACTION,
  PF_DEFAULTS,
  STEP_SRC,
  cflLimit,
  cflLimitDiffusive,
  cpuStep,
  seedState,
  surfaceMetrics,
  type PFParams,
} from '../src/lib/phasefield';

/**
 * The phase-field kernel drives the hero animation, the D3 demo, the gallery
 * and the OG card, and until now had no tests at all.
 *
 * One thing these cannot do: run the GLSL. There is no WebGL2 in vitest, so
 * "the two backends agree numerically" is not a checkable claim here. What is
 * checkable is that both encode the same rule, which is what the parity test
 * below pins — see its comment for what that does and does not buy.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Run n steps from a seeded start, returning the final interleaved state. */
function evolve(nx: number, ny: number, P: PFParams, steps: number, seed = 12345): Float32Array {
  let a: Float32Array = seedState(nx, ny, 3, mulberry32(seed));
  let b: Float32Array = new Float32Array(a.length);
  for (let f = 0; f < steps; f++) {
    cpuStep(a, b, nx, ny, P, f);
    const swap = a;
    a = b;
    b = swap;
  }
  return a;
}

describe('phase field — seeding', () => {
  it('lays down an electrode strip, a bulk electrolyte, and nuclei', () => {
    const nx = 64;
    const ny = 48;
    const s = seedState(nx, ny, 3, mulberry32(1));
    expect(s.length).toBe(nx * ny * 2);

    // rows 0-2 are metal: xi = 1, C = 0
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < nx; x++) {
        expect(s[(y * nx + x) * 2]).toBe(1);
        expect(s[(y * nx + x) * 2 + 1]).toBe(0);
      }
    }
    // the top row is untouched electrolyte: xi = 0, C = 1
    for (let x = 0; x < nx; x++) {
      expect(s[((ny - 1) * nx + x) * 2]).toBe(0);
      expect(s[((ny - 1) * nx + x) * 2 + 1]).toBe(1);
    }
    // nuclei put some metal above the strip
    let above = 0;
    for (let y = 3; y < ny; y++) {
      for (let x = 0; x < nx; x++) if (s[(y * nx + x) * 2] === 1) above++;
    }
    expect(above).toBeGreaterThan(0);
  });

  it('is deterministic for a given rng', () => {
    const a = seedState(48, 32, 4, mulberry32(7));
    const b = seedState(48, 32, 4, mulberry32(7));
    expect(Array.from(a)).toEqual(Array.from(b));
    const c = seedState(48, 32, 4, mulberry32(8));
    expect(Array.from(c)).not.toEqual(Array.from(a));
  });
});

describe('phase field — conservation and structure of the update', () => {
  /**
   * With diffusion switched off, the C equation is nothing but the coupling
   * term: dC/dt = -lambdaC * dxi/dt. So over one step, cell by cell, the change
   * in C must be exactly -lambdaC times the change in xi. This pins the sign and
   * the magnitude of the coupling, which is the part of the C equation that
   * carries the physics (metal deposited is lithium removed from solution).
   *
   * Parameters and initial state are chosen so nothing reaches a clamp bound:
   * once a clamp fires the identity is destroyed by construction, which is
   * precisely the failure mode the clamps make invisible in normal operation.
   */
  it('C tracks xi exactly through the coupling term when diffusion is off', () => {
    const nx = 32;
    const ny = 24;
    const P: PFParams = { ...PF_DEFAULTS, D: 0, noise: 0, Leta: 0, dt: 0.01 };
    const src = new Float32Array(nx * ny * 2);
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const i = (y * nx + x) * 2;
        // smooth, small-amplitude, centred on 0.5 so no bound is near
        src[i] = 0.5 + 0.08 * Math.sin((2 * Math.PI * x) / nx) * Math.cos((Math.PI * y) / ny);
        src[i + 1] = 0.7;
      }
    }
    const dst = new Float32Array(src.length);
    cpuStep(src, dst, nx, ny, P, 0);

    let checked = 0;
    for (let y = 1; y < ny - 1; y++) {
      for (let x = 0; x < nx; x++) {
        const i = (y * nx + x) * 2;
        const dXi = dst[i] - src[i];
        const dC = dst[i + 1] - src[i + 1];
        // no clamp may have fired for the identity to be meaningful
        expect(dst[i]).toBeGreaterThan(0);
        expect(dst[i]).toBeLessThan(1);
        expect(dst[i + 1]).toBeGreaterThan(0);
        expect(dst[i + 1]).toBeLessThan(1.5);
        expect(dC).toBeCloseTo(-PF_DEFAULTS.lambdaC * dXi, 6);
        checked++;
      }
    }
    expect(checked).toBe(nx * (ny - 2));
  });

  it('with xi = 0 everywhere the C equation is the 5-point Laplacian', () => {
    const nx = 24;
    const ny = 20;
    const P: PFParams = { ...PF_DEFAULTS, lambdaC: 0, Leta: 0, noise: 0, D: 1, dt: 0.05 };

    // a uniform field is a fixed point
    const flat = new Float32Array(nx * ny * 2);
    for (let i = 0; i < nx * ny; i++) {
      flat[i * 2] = 0;
      flat[i * 2 + 1] = 0.4;
    }
    // State lives in Float32Array, so ~1e-7 relative is the floor on every
    // comparison here regardless of how exact the arithmetic is.
    const out = new Float32Array(flat.length);
    cpuStep(flat, out, nx, ny, P, 0);
    for (let y = 1; y < ny - 1; y++) {
      for (let x = 0; x < nx; x++) {
        expect(out[(y * nx + x) * 2]).toBeCloseTo(0, 6);
        expect(out[(y * nx + x) * 2 + 1]).toBeCloseTo(0.4, 6);
      }
    }

    // a single bump spreads to exactly its four neighbours, by D*dt each
    const bump = new Float32Array(flat);
    const bx = 12;
    const by = 10;
    bump[(by * nx + bx) * 2 + 1] = 0.4 + 1;
    cpuStep(bump, out, nx, ny, P, 0);
    const cAt = (x: number, y: number) => out[(y * nx + x) * 2 + 1];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      expect(cAt(bx + dx, by + dy)).toBeCloseTo(0.4 + P.D * P.dt, 6);
    }
    expect(cAt(bx, by)).toBeCloseTo(0.4 + 1 - 4 * P.D * P.dt, 6);
    // and nothing reached a diagonal in one step
    expect(cAt(bx + 1, by + 1)).toBeCloseTo(0.4, 6);
  });
});

describe('phase field — bounds and the diffuse interface', () => {
  it('keeps xi in [0,1] and C in [0,1.5] over a run at the shipped defaults', () => {
    const s = evolve(96, 64, PF_DEFAULTS, 200);
    for (let i = 0; i < s.length; i += 2) {
      expect(Number.isFinite(s[i])).toBe(true);
      expect(Number.isFinite(s[i + 1])).toBe(true);
      expect(s[i]).toBeGreaterThanOrEqual(0);
      expect(s[i]).toBeLessThanOrEqual(1);
      expect(s[i + 1]).toBeGreaterThanOrEqual(0);
      expect(s[i + 1]).toBeLessThanOrEqual(1.5);
    }
  });

  /**
   * The bounds test above passes at any timestep, because the clamps enforce it
   * unconditionally — that is the whole problem with them. What actually
   * separates a converged run from a binarised one is whether a diffuse
   * interface survives: at the default dt the field has a broad band of
   * partially-solid cells, and at 5x the default almost every cell has been
   * driven onto a bound and the band collapses.
   */
  it('sustains a diffuse interface at the default dt, and loses it at 5x', () => {
    const nx = 96;
    const ny = 64;
    const ok = surfaceMetrics(evolve(nx, ny, PF_DEFAULTS, 200), nx, ny);
    const hot = surfaceMetrics(evolve(nx, ny, { ...PF_DEFAULTS, dt: 0.3 }, 200), nx, ny);

    expect(ok.interfaceCells).toBeGreaterThan(nx / 2);
    expect(ok.solidFraction).toBeGreaterThan(0);
    expect(ok.solidFraction).toBeLessThan(1);
    // the unstable run collapses the interface band
    expect(hot.interfaceCells).toBeLessThan(ok.interfaceCells / 2);
  });

  it('surfaceMetrics counts what it says it counts', () => {
    const nx = 10;
    const ny = 4;
    const s = new Float32Array(nx * ny * 2);
    for (let i = 0; i < nx * ny; i++) s[i * 2] = 0;
    s[(0 * nx + 0) * 2] = 1; // solid
    s[(0 * nx + 1) * 2] = 0.9; // solid, not interface
    s[(0 * nx + 2) * 2] = 0.5; // interface
    s[(0 * nx + 3) * 2] = 0.2; // interface
    s[(0 * nx + 4) * 2] = 0.1; // neither
    const m = surfaceMetrics(s, nx, ny);
    expect(m.interfaceCells).toBe(2);
    expect(m.solidFraction).toBeCloseTo(2 / (nx * ny), 12);
    expect(m.roughness).toBeCloseTo(2 / nx, 12);
  });
});

describe('phase field — stability bound', () => {
  it('puts the shipped defaults inside the bound, with the margin claimed', () => {
    const limit = cflLimit(PF_DEFAULTS);
    expect(limit).toBeCloseTo(0.114, 3);
    expect(PF_DEFAULTS.dt).toBeLessThan(limit);
    expect(limit / PF_DEFAULTS.dt).toBeGreaterThan(1.5);
  });

  it('the diffusive bound is the looser of the two, and both are positive', () => {
    for (const P of [PF_DEFAULTS, { ...PF_DEFAULTS, Leta: 0.15, etaA: -9.5 }]) {
      expect(cflLimit(P)).toBeGreaterThan(0);
      expect(cflLimitDiffusive(P)).toBeGreaterThanOrEqual(cflLimit(P));
    }
  });

  /**
   * A derived bound that silently stops tracking one of its inputs is worse
   * than a hardcoded one, because it looks live. Each parameter below enters
   * the derivation, so moving it in the destabilising direction must lower the
   * bound. kappa0 and delta act through the gradient coefficient, D through the
   * C equation, and W, Leta and etaA through the reaction term.
   */
  it('tracks every input it is derived from', () => {
    const base = cflLimit(PF_DEFAULTS);
    const tighter: [string, Partial<PFParams>][] = [
      ['kappa0', { kappa0: PF_DEFAULTS.kappa0 * 2 }],
      ['delta', { delta: 0.5 }],
      ['W', { W: PF_DEFAULTS.W * 4 }],
      ['Leta', { Leta: PF_DEFAULTS.Leta * 10 }],
      ['etaA', { etaA: PF_DEFAULTS.etaA * 1.5 }], // more cathodic -> bigger drive
      ['D', { D: PF_DEFAULTS.D * 8 }],
    ];
    for (const [name, patch] of tighter) {
      const moved = cflLimit({ ...PF_DEFAULTS, ...patch });
      expect(moved, `${name} must tighten the bound`).toBeLessThan(base);
    }

    // and the reverse direction must loosen it, so the test cannot pass on a
    // function that merely decreases with every perturbation
    const looser: [string, Partial<PFParams>][] = [
      ['kappa0', { kappa0: PF_DEFAULTS.kappa0 / 2 }],
      ['delta', { delta: 0 }],
      ['W', { W: PF_DEFAULTS.W / 4 }],
      ['Leta', { Leta: PF_DEFAULTS.Leta / 10 }],
      ['etaA', { etaA: PF_DEFAULTS.etaA / 2 }],
    ];
    for (const [name, patch] of looser) {
      const moved = cflLimit({ ...PF_DEFAULTS, ...patch });
      expect(moved, `${name} must loosen the bound`).toBeGreaterThan(base);
    }

    // D is the exception, and for a real reason: the bound is a min of two
    // branches, and at the defaults the xi branch is the smaller one, so easing
    // the C branch changes nothing. Check it from a base where C does bind.
    const cBound: PFParams = { ...PF_DEFAULTS, D: 40 };
    expect(cflLimit(cBound)).toBeCloseTo(1 / (4 * 40), 12);
    expect(cflLimit({ ...cBound, D: 20 })).toBeGreaterThan(cflLimit(cBound));
  });

  it('the diffusive bound tracks kappa0, delta and D', () => {
    const base = cflLimitDiffusive(PF_DEFAULTS);
    expect(cflLimitDiffusive({ ...PF_DEFAULTS, D: PF_DEFAULTS.D * 4 })).toBeLessThan(base);
    // kappa0 only binds once the xi side overtakes the C side
    const kappaBound = { ...PF_DEFAULTS, kappa0: 4, D: 0.1 };
    expect(cflLimitDiffusive(kappaBound)).toBeLessThan(cflLimitDiffusive({ ...kappaBound, kappa0: 2 }));
    expect(cflLimitDiffusive({ ...kappaBound, delta: 0.5 })).toBeLessThan(cflLimitDiffusive(kappaBound));
  });
});

describe('phase field — clamp diagnostic', () => {
  it('counts clamped cells, and the count separates stable from unstable dt', () => {
    const nx = 96;
    const ny = 64;
    const interior = nx * (ny - 2);
    const rate = (dt: number): number => {
      let a: Float32Array = seedState(nx, ny, 3, mulberry32(999));
      let b: Float32Array = new Float32Array(a.length);
      const P: PFParams = { ...PF_DEFAULTS, dt };
      let last = 0;
      for (let f = 0; f < 200; f++) {
        last = cpuStep(a, b, nx, ny, P, f) / interior;
        const swap = a;
        a = b;
        b = swap;
      }
      return last;
    };
    const normal = rate(PF_DEFAULTS.dt);
    const hot = rate(0.3);

    // some clamping is normal: the bulk phases sit on the bounds
    expect(normal).toBeGreaterThan(0);
    expect(normal).toBeLessThan(CLAMP_ALARM_FRACTION);
    // an unstable step is unambiguous by the same measure
    expect(hot).toBeGreaterThan(CLAMP_ALARM_FRACTION);
    expect(hot).toBeGreaterThan(normal * 3);
  });

  it('the alarm threshold sits between the observed stable and unstable rates', () => {
    expect(CLAMP_ALARM_FRACTION).toBeGreaterThan(0.1195); // highest stable observation
    expect(CLAMP_ALARM_FRACTION).toBeLessThan(0.3042); // lowest unstable observation
  });
});

describe('phase field — CPU and GLSL encode the same rule', () => {
  /**
   * There is no WebGL2 in this test environment, so this cannot compare numbers
   * coming out of the two backends. What it does is pin every constant the GLSL
   * shares with the TypeScript, so that editing one path and not the other
   * fails here rather than silently on someone's GPU. `pf-engine.ts` claims the
   * two run "the identical update rule"; this is the guard for that claim, not
   * a proof of it.
   */
  it('the shader carries the same coefficients as the CPU path', () => {
    const src = STEP_SRC.replace(/\s+/g, ' ');

    // interpolation h(p) = p^3 (6p^2 - 15p + 10) and h'(p) = 30 p^2 (1-p)^2
    expect(src).toContain('30.0 * p * p * (1.0 - p) * (1.0 - p)');
    expect(src).toContain('p * p * p * (6.0 * p * p - 15.0 * p + 10.0)');

    // double-well derivative f' = 2W p(1-p)(1-2p)
    expect(src).toContain('2.0 * uWchem * p * (1.0 - p) * (1.0 - 2.0 * p)');

    // Butler-Volmer bracket
    expect(src).toContain('exp((1.0 - uAlpha) * uEtaA) - c * exp(-uAlpha * uEtaA)');

    // anisotropy: kappa(theta) and its derivative
    expect(src).toContain('uKappa0 * (1.0 + uDelta * cos(arg))');
    expect(src).toContain('-uKappa0 * uDelta * uOmega * sin(arg)');

    // the clamp bounds the CPU path uses
    expect(src).toContain('clamp(p + uDt * dpdt, 0.0, 1.0)');
    expect(src).toContain('clamp(c + uDt * dcdt, 0.0, 1.5)');

    // hash-noise constants, and the p(1-p) envelope that kills noise in the bulk
    expect(src).toContain('127.1');
    expect(src).toContain('311.7');
    expect(src).toContain('43758.5453');
    expect(src).toContain('uFrame * 0.37');
    expect(src).toContain('uNoise * p * (1.0 - p)');

    // the 5-point Laplacian and the blocked face diffusivities
    expect(src).toContain('pE + pW + pN + pS - 4.0 * p');
    expect(src).toContain('uDdiff * (1.0 - hInterp(0.5 * (p + pE)))');
  });

  it('every PFParams field has a uniform in the shader', () => {
    const uniforms: Record<keyof PFParams, string> = {
      kappa0: 'uKappa0',
      delta: 'uDelta',
      omegaMode: 'uOmega',
      theta0: 'uTheta0',
      W: 'uWchem',
      Lsigma: 'uLsigma',
      Leta: 'uLeta',
      alpha: 'uAlpha',
      etaA: 'uEtaA',
      D: 'uDdiff',
      lambdaC: 'uLambdaC',
      noise: 'uNoise',
      dt: 'uDt',
    };
    for (const key of Object.keys(PF_DEFAULTS) as (keyof PFParams)[]) {
      expect(STEP_SRC).toContain(uniforms[key]);
    }
  });
});
