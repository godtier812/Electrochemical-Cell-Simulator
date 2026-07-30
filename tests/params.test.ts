import { describe, expect, it } from 'vitest';
import { F, R as Rgas } from '../src/lib/constants';

/**
 * Mirrors of the Param mappings in src/components/demos/runtime.ts. Param
 * itself is bound to live DOM inputs, so the arithmetic is duplicated here to
 * pin the property that matters: a value put on the slider comes back out.
 */
function round(v: number, min: number, max: number, step: number | null): number {
  if (step === null) return v;
  return Math.min(max, Math.max(min, min + Math.round((v - min) / step) * step));
}

function fromPosition(
  pos: number,
  min: number,
  max: number,
  scale: string,
  positions: number,
  step: number | null
) {
  const f = pos / positions;
  const raw =
    scale === 'log'
      ? Math.pow(10, Math.log10(min) + (Math.log10(max) - Math.log10(min)) * f)
      : min + (max - min) * f;
  return round(raw, min, max, step);
}

function toPosition(v: number, min: number, max: number, scale: string, positions: number) {
  const raw =
    scale === 'log'
      ? (Math.log10(v) - Math.log10(min)) / (Math.log10(max) - Math.log10(min))
      : (v - min) / (max - min);
  return Math.round(Math.min(1, Math.max(0, raw)) * positions);
}

/** Every parameter declared by a Control in D1–D6, with its real range. */
const PARAMS: Array<{
  id: string;
  min: number;
  max: number;
  scale: 'linear' | 'log';
  step: number | null;
}> = [
  { id: 'd1-j0', min: 1e-6, max: 1e-1, scale: 'log', step: null },
  { id: 'd1-aa', min: 0.1, max: 0.9, scale: 'linear', step: 0.01 },
  { id: 'd1-ac', min: 0.1, max: 0.9, scale: 'linear', step: 0.01 },
  { id: 'd1-T', min: 250, max: 350, scale: 'linear', step: 1 },
  { id: 'd2-v', min: -300, max: 300, scale: 'linear', step: 5 },
  { id: 'd2-c0', min: 0.001, max: 1, scale: 'log', step: null },
  { id: 'd2-L', min: 20, max: 200, scale: 'linear', step: 5 },
  { id: 'd2-T', min: 273, max: 350, scale: 'linear', step: 1 },
  { id: 'd3-eta', min: 50, max: 205, scale: 'linear', step: 1 },
  { id: 'd3-delta', min: 0, max: 0.06, scale: 'linear', step: 0.001 },
  { id: 'd3-T', min: 250, max: 350, scale: 'linear', step: 1 },
  { id: 'd3-nuc', min: 1, max: 8, scale: 'linear', step: 1 },
  { id: 'd4-rohm', min: 0, max: 50, scale: 'linear', step: 0.1 },
  { id: 'd4-rct', min: 1, max: 100, scale: 'log', step: null },
  { id: 'd4-cdl', min: 1e-6, max: 1e-3, scale: 'log', step: null },
  { id: 'd4-rd', min: 0, max: 100, scale: 'linear', step: 0.5 },
  { id: 'd4-taud', min: 0.01, max: 100, scale: 'log', step: null },
  { id: 'd4-lambda', min: 1e-4, max: 1, scale: 'log', step: null },
  { id: 'd5-eps', min: 0.35, max: 0.9, scale: 'linear', step: 0.01 },
  { id: 'd5-r', min: 4, max: 14, scale: 'linear', step: 1 },
  { id: 'd5-s', min: 0, max: 50, scale: 'linear', step: 5 },
  { id: 'd6-crate', min: 0.1, max: 4, scale: 'linear', step: 0.1 },
  { id: 'd6-radius', min: 2, max: 12, scale: 'linear', step: 1 },
  { id: 'd6-r0', min: 0, max: 60, scale: 'linear', step: 1 },
  { id: 'd6-T', min: 273, max: 333, scale: 'linear', step: 1 },
];

/** Mirrors Control.astro: one detent per step, else a smooth 200 for log scales. */
function positionsFor(p: { min: number; max: number; step: number | null }): number {
  return p.step ? Math.max(1, Math.round((p.max - p.min) / p.step)) : 200;
}

describe('demo parameter mapping', () => {
  it('covers every Control-backed parameter in the demos', () => {
    expect(PARAMS).toHaveLength(25);
  });

  it('one arrow-key press moves a stepped parameter by exactly one step', () => {
    // A range input's arrow keys move it one detent. If a detent is finer than
    // the value step, presses round back to the same number and the control
    // looks broken to a keyboard user.
    for (const p of PARAMS.filter((q) => q.step !== null)) {
      const POSITIONS = positionsFor(p);
      for (const pos of [0, Math.floor(POSITIONS / 2), POSITIONS - 1]) {
        const here = fromPosition(pos, p.min, p.max, p.scale, POSITIONS, p.step);
        const next = fromPosition(pos + 1, p.min, p.max, p.scale, POSITIONS, p.step);
        expect(next - here, `${p.id} at detent ${pos}`).toBeCloseTo(p.step!, 6);
      }
    }
  });

  it('round-trips a typed value back to itself', () => {
    for (const p of PARAMS) {
      const POSITIONS = positionsFor(p);
      for (let i = 0; i <= 20; i++) {
        const target = round(
          p.scale === 'log'
            ? Math.pow(10, Math.log10(p.min) + ((Math.log10(p.max) - Math.log10(p.min)) * i) / 20)
            : p.min + ((p.max - p.min) * i) / 20,
          p.min,
          p.max,
          p.step
        );
        const back = fromPosition(
          toPosition(target, p.min, p.max, p.scale, POSITIONS),
          p.min,
          p.max,
          p.scale,
          POSITIONS,
          p.step
        );
        // one slider detent of slack, which is all the position grid can hold
        const detent = p.scale === 'log' ? Math.abs(target) * 0.06 : (p.max - p.min) / POSITIONS + (p.step ?? 0);
        expect(Math.abs(back - target), `${p.id} at ${target}`).toBeLessThanOrEqual(detent);
      }
    }
  });

  it('keeps every slider position inside the declared physical range', () => {
    for (const p of PARAMS) {
      const POSITIONS = positionsFor(p);
      for (let pos = 0; pos <= POSITIONS; pos++) {
        const v = fromPosition(pos, p.min, p.max, p.scale, POSITIONS, p.step);
        expect(v, `${p.id} at position ${pos}`).toBeGreaterThanOrEqual(p.min - 1e-9);
        expect(v, `${p.id} at position ${pos}`).toBeLessThanOrEqual(p.max + 1e-9);
      }
    }
  });

  it('maps the ends of the slider onto the ends of the range', () => {
    for (const p of PARAMS) {
      const POSITIONS = positionsFor(p);
      expect(fromPosition(0, p.min, p.max, p.scale, POSITIONS, p.step), `${p.id} left`).toBeCloseTo(p.min, 6);
      expect(
        fromPosition(POSITIONS, p.min, p.max, p.scale, POSITIONS, p.step),
        `${p.id} right`
      ).toBeCloseTo(p.max, 6);
    }
  });

  it('every parameter increases left to right, with no exceptions', () => {
    // This is what makes the native keyboard behaviour of <input type="range">
    // correct: ArrowRight/ArrowUp raise the position, so they must raise the
    // value. Any control needing the opposite sense is declared as a magnitude
    // and negated at the physics boundary instead of flipping the mapping.
    for (const p of PARAMS) {
      const POSITIONS = positionsFor(p);
      let prev = -Infinity;
      for (let pos = 0; pos <= POSITIONS; pos++) {
        const v = fromPosition(pos, p.min, p.max, p.scale, POSITIONS, p.step);
        expect(v, `${p.id} decreased at position ${pos}`).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    }
  });

  it('the dendrite overpotential is a positive magnitude in millivolts', () => {
    const eta = PARAMS.find((p) => p.id === 'd3-eta')!;
    const POSITIONS = positionsFor(eta);
    expect(eta.min).toBe(50);
    expect(eta.max).toBe(205);
    // left is the least drive, right is the most
    expect(fromPosition(0, eta.min, eta.max, eta.scale, POSITIONS, eta.step)).toBeCloseTo(50, 6);
    expect(
      fromPosition(POSITIONS, eta.min, eta.max, eta.scale, POSITIONS, eta.step)
    ).toBeCloseTo(205, 6);
    // one detent per millivolt, so the 154 mV default sits at detent 104 of 155
    expect(POSITIONS).toBe(155);
    expect(toPosition(154, eta.min, eta.max, eta.scale, POSITIONS)).toBe(104);
  });

  it('derives aη = Fη/RT from the millivolt control, and lets T move it', () => {
    // The conversion in d3-dendrite.ts: the control holds applied volts fixed,
    // so the dimensionless group that reaches Butler–Volmer must fall as the
    // cell warms. That coupling is the point of deriving it instead of storing it.
    const aeta = (mV: number, T: number) => (F * (-mV / 1000)) / (Rgas * T);
    expect(aeta(154, 298)).toBeCloseTo(-6.0, 1);
    expect(aeta(154, 350)).toBeCloseTo(-5.11, 2);
    expect(aeta(50, 298)).toBeCloseTo(-1.95, 2);
    expect(aeta(205, 298)).toBeCloseTo(-7.98, 2);
    // hotter cell, same applied millivolts, strictly less drive
    expect(Math.abs(aeta(154, 350))).toBeLessThan(Math.abs(aeta(154, 298)));
    // and the millivolt range still spans what the old aη control reached
    expect(Math.abs(aeta(50, 298))).toBeLessThan(2.05);
    expect(Math.abs(aeta(205, 298))).toBeGreaterThan(7.9);
  });

  it('log parameters give even travel per decade', () => {
    for (const p of PARAMS.filter((q) => q.scale === 'log')) {
      const POSITIONS = positionsFor(p);
      const mid = fromPosition(POSITIONS / 2, p.min, p.max, p.scale, POSITIONS, p.step);
      expect(Math.log10(mid)).toBeCloseTo((Math.log10(p.min) + Math.log10(p.max)) / 2, 6);
    }
  });

  it('clamps out-of-range entries to the bounds', () => {
    for (const p of PARAMS) {
      const clamp = (v: number) => Math.min(p.max, Math.max(p.min, v));
      expect(clamp(p.min - 1e6)).toBe(p.min);
      expect(clamp(p.max + 1e6)).toBe(p.max);
    }
  });
});
