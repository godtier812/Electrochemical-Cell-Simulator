import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { columnsToCsv, seriesToCsv } from '../src/lib/csv';
import { decodeState, encodeState, formatStateNumber, readStateNumber } from '../src/lib/urlstate';
import { EisParseError, dropPoints, inductivePoints, parseEis } from '../src/lib/eisdata';
import { addNoise, impedance, omegaGrid, type CircuitParams } from '../src/lib/eis';
import { computeDRT, drtPeaks, lambdaSweep, suggestLambda } from '../src/lib/drt';
import { mulberry32 } from '../src/lib/microstructure';
import { formatTick, formatValue, pow10 } from '../src/lib/plot';
import {
  bruggemanRatio,
  cRateCurrent,
  cRateHours,
  chargeTransferResistance,
  cottrellCurrent,
  debyeLengthSymmetric,
  diffusionLength,
  diffusionTime,
  nernstPotential,
  nernstSlopeMV,
  sandsTime,
  tafelSlopeMV,
  thermalVoltage,
  tortuosityFromRatio,
} from '../src/lib/calc';

/** The D4 default circuit, without its Warburg tail: one RC arc. */
const RC: CircuitParams = { Rohm: 10, Rct: 25, Cdl: 2e-5, Rd: 0, tauD: 1, Rsei: 0, Csei: 1e-4, age: 0 };

describe('CSV export', () => {
  it('writes shared-abscissa series as one wide table', () => {
    const csv = seriesToCsv(
      [
        { x: [1, 2, 3], y: [10, 20, 30], label: 'a' },
        { x: [1, 2, 3], y: [0.1, 0.2, 0.3], label: 'b' },
      ],
      'x / s',
      'y'
    );
    expect(csv).toBe('x / s,a,b\n1,10,0.1\n2,20,0.2\n3,30,0.3\n');
  });

  it('keeps separate x columns when the abscissas differ, rather than interpolating', () => {
    const csv = seriesToCsv([
      { x: [1, 2], y: [5, 6], label: 'a' },
      { x: [1, 2, 3], y: [7, 8, 9], label: 'b' },
    ]);
    const rows = csv.trim().split('\n');
    expect(rows[0]).toBe('x (a),a,x (b),b');
    expect(rows[3]).toBe(',,3,9'); // the shorter series is padded, not repeated
  });

  it('quotes names that contain a comma and leaves gaps empty', () => {
    const csv = columnsToCsv([
      { name: 'C, mol/m3', values: [1, NaN, 3] },
      { name: 'note', values: ['a "b"', 'c', 'd'] },
    ]);
    expect(csv).toBe('"C, mol/m3",note\n1,"a ""b"""\n,c\n3,d\n');
  });

  it('writes numbers at full precision', () => {
    expect(columnsToCsv([{ name: 'v', values: [1 / 3] }])).toContain(String(1 / 3));
  });
});

describe('shareable demo state', () => {
  it('round-trips a state through the query string', () => {
    const state = { 'd4-rct': '40', 'd4-lambda': '0.001', 'd1-mode': 'tafel', 'd3-showc': '1' };
    expect(decodeState('?' + encodeState(state))).toEqual(state);
  });

  it('formats numbers so they survive the trip', () => {
    for (const v of [0.001, 2e-5, 298, 1e-6, 0.0989, 154, -200]) {
      expect(Number(formatStateNumber(v))).toBeCloseTo(v, 12);
    }
    expect(formatStateNumber(0.1 + 0.2)).toBe('0.3');
  });

  it('clamps a linked value into the control range and ignores junk', () => {
    const state = decodeState('?a=1e9&b=-5&c=abc&d=');
    expect(readStateNumber(state, 'a', 0, 100)).toBe(100);
    expect(readStateNumber(state, 'b', 0, 100)).toBe(0);
    expect(readStateNumber(state, 'c', 0, 100)).toBeNull();
    expect(readStateNumber(state, 'd', 0, 100)).toBeNull();
    expect(readStateNumber(state, 'missing', 0, 100)).toBeNull();
  });
});

describe('demo controls', () => {
  it('every preset names a control that exists, with a value inside its range', () => {
    // A preset that points at a renamed control, or sets a value the control
    // would clamp, silently does something other than what its label says.
    const dir = join(import.meta.dirname, '..', 'src', 'components', 'demos');
    for (const file of readdirSync(dir).filter((f) => /^D\d.*\.astro$/.test(f))) {
      const src = readFileSync(join(dir, file), 'utf8');
      const controls = new Map<string, { min: number; max: number }>();
      for (const m of src.matchAll(/<Control id="([^"]+)"[^>]*?min=\{([^}]+)\}[^>]*?max=\{([^}]+)\}/g)) {
        controls.set(m[1], { min: Number(m[2]), max: Number(m[3]) });
      }
      const loose = new Set<string>();
      for (const m of src.matchAll(/<input[^>]*?\b(?:id|name)="([^"]+)"/g)) loose.add(m[1]);
      for (const m of src.matchAll(/state: \{([^}]*)\}/g)) {
        for (const pair of m[1].matchAll(/'([^']+)':\s*(-?[\d.e-]+)/g)) {
          const [, id, raw] = pair;
          const range = controls.get(id);
          if (range) {
            expect(Number(raw), `${file}: ${id}`).toBeGreaterThanOrEqual(range.min);
            expect(Number(raw), `${file}: ${id}`).toBeLessThanOrEqual(range.max);
          } else {
            expect(loose.has(id), `${file}: preset key ${id} matches no control`).toBe(true);
          }
        }
      }
    }
  });
});

describe('plot number formatting', () => {
  it('typesets powers of ten instead of printing 1e-4', () => {
    expect(pow10(-4)).toBe('10⁻⁴');
    expect(formatTick(1e-4)).toBe('10⁻⁴');
    expect(formatTick(2e5)).toBe('2×10⁵');
    expect(formatTick(0.25)).toBe('0.25');
    expect(formatTick(0)).toBe('0');
    expect(formatTick(-1e-6)).toBe('−10⁻⁶');
  });

  it('never shows a mantissa of ten', () => {
    // 9.9996e-5 rounds to 10.0×10⁻⁵ unless the exponent is carried
    expect(formatTick(9.9996e-5)).toBe('10⁻⁴');
  });

  it('formats readout values to four significant figures', () => {
    expect(formatValue(3.14159)).toBe('3.142');
    expect(formatValue(NaN)).toBe('—');
    expect(formatValue(1.2345e-7)).toBe('1.23×10⁻⁷');
  });
});

describe('impedance data parser', () => {
  const omega = omegaGrid(0.01, 1e5, 40);
  const Z = Array.from(omega, (w) => impedance(w, RC));
  const f = Array.from(omega, (w) => w / (2 * Math.PI));

  it('reads a plain three-column CSV with a header', () => {
    const text = 'f / Hz,Zre / ohm,Zim / ohm\n' + f.map((fi, i) => `${fi},${Z[i].re},${Z[i].im}`).join('\n');
    const p = parseEis(text);
    expect(p.data.freq).toHaveLength(40);
    expect(p.columns).toEqual({ freq: 0, re: 1, im: 2, imNegated: false });
    expect(p.data.Z[7].re).toBeCloseTo(Z[7].re, 12);
    expect(p.data.Z[7].im).toBeCloseTo(Z[7].im, 12);
  });

  it('reads tab-separated data with no header, highest frequency first', () => {
    const text = f
      .map((fi, i) => `${fi}\t${Z[i].re}\t${Z[i].im}`)
      .reverse()
      .join('\n');
    const p = parseEis(text);
    expect(p.header).toBeNull();
    // sorted ascending whatever order the file used
    expect(p.data.freq[0]).toBeLessThan(p.data.freq[39]);
    expect(p.data.Z[0].re).toBeCloseTo(Z[0].re, 12);
  });

  it('recognises a negated imaginary column from the data when the header does not say', () => {
    const text = f.map((fi, i) => `${fi} ${Z[i].re} ${-Z[i].im}`).join('\n');
    const p = parseEis(text);
    expect(p.columns.imNegated).toBe(true);
    expect(p.data.Z[5].im).toBeCloseTo(Z[5].im, 12);
    expect(p.notes.join(' ')).toMatch(/−Z″/);
  });

  it('finds columns by header name when they are out of order', () => {
    const text =
      "-Z'' (Ohm);Frequency (Hz);Z' (Ohm);Time (s)\n" +
      f.map((fi, i) => `${-Z[i].im};${fi};${Z[i].re};${i}`).join('\n');
    const p = parseEis(text);
    expect(p.columns).toEqual({ freq: 1, re: 2, im: 0, imNegated: true });
    expect(p.data.Z[3].im).toBeCloseTo(Z[3].im, 12);
  });

  it('reads decimal commas in semicolon-separated files', () => {
    const text = 'f;re;im\n0,1;12,5;-3,25\n1;11,5;-2,5\n10;10,5;-1,5\n';
    const p = parseEis(text);
    expect(p.data.freq[0]).toBeCloseTo(0.1, 12);
    expect(p.data.Z[0]).toEqual({ re: 12.5, im: -3.25 });
  });

  it('skips comments, blank lines and unusable rows, and says how many', () => {
    const text = '# exported 2026\n\nf,re,im\n1,10,-1\n2,9,-2\nbad,row,here\n3,8,-3\n0,7,-4\n';
    const p = parseEis(text);
    expect(p.data.freq).toHaveLength(3);
    expect(p.skipped).toBe(2); // the text row in the middle of the data, and the f = 0 row
  });

  it('honours a manual column override', () => {
    const text = f.map((fi, i) => `${i},${fi},${Z[i].re},${Z[i].im}`).join('\n');
    const p = parseEis(text, { freq: 1, re: 2, im: 3, imNegated: false });
    expect(p.data.Z[9].re).toBeCloseTo(Z[9].re, 12);
  });

  it('rejects input that cannot be a spectrum, with a reason', () => {
    expect(() => parseEis('hello')).toThrow(EisParseError);
    expect(() => parseEis('1,2\n3,4\n5,6\n')).toThrow(/three columns/);
  });

  it('flags inductive points and can drop them', () => {
    const text = '1,10,-2\n10,9,-1\n100,8,0.5\n1000,8,1.5\n';
    const p = parseEis(text, { imNegated: false });
    const bad = inductivePoints(p.data.Z);
    expect(bad).toEqual([2, 3]);
    const kept = dropPoints(p.data, bad);
    expect(Array.from(kept.freq)).toEqual([1, 10]);
    expect(kept.Z).toHaveLength(2);
  });
});

describe('DRT analysis', () => {
  const omega = omegaGrid(0.01, 1e5, 60);

  it('finds one peak for one RC arc, with its resistance, time constant and capacitance', () => {
    const Z = Array.from(omega, (w) => impedance(w, RC));
    const peaks = drtPeaks(computeDRT(omega, Z, { nTau: 60, lambda: 1e-3 }), omega);
    expect(peaks).toHaveLength(1);
    expect(peaks[0].resistance).toBeGreaterThan(0.95 * RC.Rct);
    expect(peaks[0].resistance).toBeLessThan(1.05 * RC.Rct);
    expect(Math.abs(Math.log10(peaks[0].tau / (RC.Rct * RC.Cdl)))).toBeLessThan(0.2);
    expect(Math.abs(Math.log10(peaks[0].capacitance / RC.Cdl))).toBeLessThan(0.25);
    expect(peaks[0].outsideWindow).toBe(false);
  });

  it('separates two processes, and their resistances add up to the total', () => {
    // SEI arc (R = 30, τ = 60 ms) plus charge transfer (R = 25, τ = 0.5 ms)
    const p = { ...RC, Rsei: 15, Csei: 2e-3, age: 2 };
    const Z = Array.from(omega, (w) => impedance(w, p));
    const drt = computeDRT(omega, Z, { nTau: 60, lambda: 1e-3 });
    const peaks = drtPeaks(drt, omega);
    expect(peaks).toHaveLength(2);
    const [fast, slow] = [...peaks].sort((a, b) => a.tau - b.tau);
    expect(fast.resistance).toBeGreaterThan(0.85 * 25);
    expect(fast.resistance).toBeLessThan(1.15 * 25);
    expect(slow.resistance).toBeGreaterThan(0.85 * 30);
    expect(slow.resistance).toBeLessThan(1.15 * 30);
    let total = 0;
    for (const g of drt.gamma) total += g * drt.dlnTau;
    expect(fast.resistance + slow.resistance).toBeCloseTo(total, 6);
  });

  it('survives the full round trip a user makes: export, parse, invert', () => {
    // exactly what "open in analyser" hands over, with 1% noise on it
    const noisy = addNoise(
      Array.from(omega, (w) => impedance(w, RC)),
      0.01,
      mulberry32(7)
    );
    const csv = columnsToCsv([
      { name: 'f / Hz', values: Array.from(omega, (w) => w / (2 * Math.PI)) },
      { name: 'Zre / ohm cm2', values: noisy.map((z) => z.re) },
      { name: 'Zim / ohm cm2', values: noisy.map((z) => z.im) },
    ]);
    const { data } = parseEis(csv);
    const drt = computeDRT(data.omega, data.Z, { nTau: 60, lambda: 1e-2 });
    const main = drtPeaks(drt, data.omega).sort((a, b) => b.resistance - a.resistance)[0];
    expect(drt.Rinf).toBeGreaterThan(9);
    expect(drt.Rinf).toBeLessThan(11);
    expect(main.resistance).toBeGreaterThan(0.9 * RC.Rct);
    expect(main.resistance).toBeLessThan(1.1 * RC.Rct);
    expect(Math.abs(Math.log10(main.tau / (RC.Rct * RC.Cdl)))).toBeLessThan(0.25);
  });

  it('seeded noise is reproducible and has the stated size', () => {
    const clean = Array.from(omega, (w) => impedance(w, RC));
    const a = addNoise(clean, 0.02, mulberry32(1));
    const b = addNoise(clean, 0.02, mulberry32(1));
    expect(a).toEqual(b);
    expect(addNoise(clean, 0, mulberry32(1))).toBe(clean);
    let sum = 0;
    for (let i = 0; i < clean.length; i++) {
      const mag = Math.hypot(clean[i].re, clean[i].im);
      sum += ((a[i].re - clean[i].re) / mag) ** 2 + ((a[i].im - clean[i].im) / mag) ** 2;
    }
    const rms = Math.sqrt(sum / (2 * clean.length));
    expect(rms).toBeGreaterThan(0.012);
    expect(rms).toBeLessThan(0.03);
  });

  it('a λ sweep shows misfit rising with λ, and suggests a value inside the sweep', () => {
    const Z = Array.from(omega, (w) => impedance(w, RC));
    const lambdas = [1e-4, 1e-3, 1e-2, 1e-1, 1];
    const sweep = lambdaSweep(omega, Z, lambdas);
    expect(sweep).toHaveLength(5);
    expect(sweep[4].misfit).toBeGreaterThan(sweep[0].misfit);
    const s = suggestLambda(sweep)!;
    expect(s).toBeGreaterThanOrEqual(1e-4);
    expect(s).toBeLessThanOrEqual(1);
    expect(suggestLambda([])).toBeNull();
  });
});

describe('bench calculators', () => {
  it('Debye length: 0.30 nm at 1 M and 0.96 nm at 0.1 M, halved for a 2:2 salt', () => {
    expect(debyeLengthSymmetric(78.5, 298.15, 1000) * 1e9).toBeCloseTo(0.304, 2);
    expect(debyeLengthSymmetric(78.5, 298.15, 100) * 1e9).toBeCloseTo(0.962, 2);
    expect(debyeLengthSymmetric(78.5, 298.15, 100, 2) * 1e9).toBeCloseTo(0.481, 2);
  });

  it('thermal voltage and Nernst slope at 25 °C', () => {
    expect(thermalVoltage(298.15) * 1000).toBeCloseTo(25.69, 2);
    expect(nernstSlopeMV(298.15)).toBeCloseTo(59.16, 2);
    expect(nernstSlopeMV(298.15, 2)).toBeCloseTo(29.58, 2);
    // a tenfold activity ratio shifts a one-electron couple by one slope
    expect(nernstPotential(0, 298.15, 1, 10) * 1000).toBeCloseTo(59.16, 2);
  });

  it('Tafel slope is 118 mV/decade for α = 0.5 at 25 °C', () => {
    expect(tafelSlopeMV(0.5, 298.15)).toBeCloseTo(118.3, 1);
  });

  it('charge-transfer resistance is RT/F over j0 for αa + αc = 1', () => {
    expect(chargeTransferResistance(1e-3, 298.15)).toBeCloseTo(25.69, 2);
    expect(chargeTransferResistance(1e-3, 298.15, 2)).toBeCloseTo(12.85, 2);
  });

  it("Sand's time against a hand evaluation", () => {
    // D = 1e-9 m²/s, c = 1000 mol/m³, n = 1, J = 100 A/m², t+ = 0.4
    const expected = (Math.PI * 1e-9 * (1000 * 96485.33212) ** 2) / (4 * 100 ** 2 * 0.6 ** 2);
    expect(sandsTime(1e-9, 1000, 1, 100, 0.4)).toBeCloseTo(expected, 6);
    // doubling the current quarters the time
    expect(sandsTime(1e-9, 1000, 1, 200, 0.4)).toBeCloseTo(expected / 4, 6);
  });

  it('diffusion time and length are inverses of each other', () => {
    expect(diffusionTime(10e-6, 1e-10)).toBeCloseTo(1, 12);
    expect(diffusionLength(1e-10, diffusionTime(10e-6, 1e-10))).toBeCloseTo(10e-6, 12);
  });

  it('Cottrell current falls as 1/√t', () => {
    const i1 = cottrellCurrent(1, 1e-4, 1, 1e-9, 1);
    expect(i1).toBeCloseTo(96485.33212 * 1e-4 * Math.sqrt(1e-9 / Math.PI), 12);
    expect(cottrellCurrent(1, 1e-4, 1, 1e-9, 4)).toBeCloseTo(i1 / 2, 12);
  });

  it('C-rate, Bruggeman and tortuosity', () => {
    expect(cRateCurrent(2, 5)).toBe(10);
    expect(cRateHours(2)).toBe(0.5);
    expect(bruggemanRatio(0.25)).toBeCloseTo(0.125, 12);
    expect(tortuosityFromRatio(0.25, bruggemanRatio(0.25))).toBeCloseTo(2, 12);
  });
});
