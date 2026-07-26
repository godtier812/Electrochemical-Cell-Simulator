/**
 * Build-time generator for demo poster fallbacks, the hero poster, and the
 * gallery figures. Every image is computed by the same physics code the live
 * demos run (src/lib), with seeded RNGs so output is reproducible.
 *
 *   npx tsx scripts/generate-posters.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePNG } from './png';
import { svgPlot } from './svgplot';
import { PF_DEFAULTS, cpuStep, seedState, type PFParams } from '../src/lib/phasefield';
import { sample, css } from '../src/lib/colormaps';
import { butlerVolmer, butlerVolmerLinear } from '../src/lib/butlervolmer';
import { gouyChapman, solvePNP } from '../src/lib/pnp';
import { thermalVoltage } from '../src/lib/constants';
import { impedance, omegaGrid, type CircuitParams } from '../src/lib/eis';
import { computeDRT } from '../src/lib/drt';
import { generateRSA, mulberry32, solveTransport } from '../src/lib/microstructure';

const ROOT = join(import.meta.dirname, '..');
const POSTERS = join(ROOT, 'public', 'posters');
const GALLERY = join(ROOT, 'public', 'gallery');
mkdirSync(POSTERS, { recursive: true });
mkdirSync(GALLERY, { recursive: true });

const C1 = css('viridis', 0.45);
const C2 = css('viridis', 0.75);
const CR = css('plasma', 0.55);

/* ---------------- phase-field runs (hero, D3 poster, gallery) ------------ */

interface PFRun {
  nx: number;
  ny: number;
  frames: Map<number, Float32Array>;
}

function runPF(
  nx: number,
  ny: number,
  P: PFParams,
  steps: number,
  snaps: number[],
  seed: number,
  nuclei: number
): PFRun {
  let a: Float32Array = seedState(nx, ny, nuclei, mulberry32(seed));
  let b: Float32Array = new Float32Array(a.length);
  const frames = new Map<number, Float32Array>();
  for (let f = 0; f < steps; f++) {
    cpuStep(a, b, nx, ny, P, f);
    [a, b] = [b, a];
    if (snaps.includes(f + 1)) frames.set(f + 1, a.slice());
  }
  return { nx, ny, frames };
}

function pfToRGB(
  state: Float32Array,
  nx: number,
  ny: number,
  channel: 0 | 1,
  map: 'viridis' | 'inferno'
): Uint8Array {
  const rgb = new Uint8Array(nx * ny * 3);
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const v = state[((ny - 1 - y) * nx + x) * 2 + channel];
      const [r, g, b] = sample(map, Math.max(0, Math.min(1, v)));
      const j = (y * nx + x) * 3;
      rgb[j] = r;
      rgb[j + 1] = g;
      rgb[j + 2] = b;
    }
  }
  return rgb;
}

function scaleNearest(rgb: Uint8Array, nx: number, ny: number, k: number): Uint8Array {
  const out = new Uint8Array(nx * k * ny * k * 3);
  for (let y = 0; y < ny * k; y++) {
    const sy = Math.floor(y / k);
    for (let x = 0; x < nx * k; x++) {
      const sx = Math.floor(x / k);
      const si = (sy * nx + sx) * 3;
      const di = (y * nx * k + x) * 3;
      out[di] = rgb[si];
      out[di + 1] = rgb[si + 1];
      out[di + 2] = rgb[si + 2];
    }
  }
  return out;
}

console.time('phase-field hero run');
const HERO_P: PFParams = {
  ...PF_DEFAULTS,
  Leta: 0.1,
  D: 0.7,
  lambdaC: 3.5,
  W: 0.8,
  kappa0: 0.65,
  delta: 0.06,
  noise: 0.35,
  dt: 0.045,
};
const hero = runPF(352, 176, HERO_P, 5000, [1500, 2500, 3500, 4400, 5000], 4, 5);
console.timeEnd('phase-field hero run');

const heroFinal = hero.frames.get(4400)!;
writeFileSync(
  join(POSTERS, 'hero.png'),
  encodePNG(scaleNearest(pfToRGB(heroFinal, 352, 176, 0, 'viridis'), 352, 176, 2), 704, 352)
);
writeFileSync(
  join(POSTERS, 'd3-dendrite.png'),
  encodePNG(scaleNearest(pfToRGB(hero.frames.get(3500)!, 352, 176, 0, 'viridis'), 352, 176, 2), 704, 352)
);
for (const [step, label] of [
  [1500, 't1'],
  [2500, 't2'],
  [3500, 't3'],
  [5000, 't4'],
] as const) {
  writeFileSync(
    join(GALLERY, `dendrite-${label}.png`),
    encodePNG(scaleNearest(pfToRGB(hero.frames.get(step)!, 352, 176, 0, 'viridis'), 352, 176, 2), 704, 352)
  );
}
writeFileSync(
  join(GALLERY, 'dendrite-concentration.png'),
  encodePNG(scaleNearest(pfToRGB(heroFinal, 352, 176, 1, 'inferno'), 352, 176, 2), 704, 352)
);
console.log('hero + dendrite gallery written');

console.time('needle + 6-fold runs');
const NEEDLE_P: PFParams = { ...PF_DEFAULTS, Leta: 0.05, D: 1.0, lambdaC: 2.5, W: 1.0, kappa0: 1.0, delta: 0.05, noise: 0.1, dt: 0.05 };
const needles = runPF(288, 160, NEEDLE_P, 4200, [4200], 11, 3);
writeFileSync(
  join(GALLERY, 'needles.png'),
  encodePNG(scaleNearest(pfToRGB(needles.frames.get(4200)!, 288, 160, 0, 'viridis'), 288, 160, 2), 576, 320)
);
const SIX_P: PFParams = { ...HERO_P, omegaMode: 6, delta: 0.025 };
const six = runPF(288, 160, SIX_P, 4200, [4200], 9, 4);
writeFileSync(
  join(GALLERY, 'dendrite-6fold.png'),
  encodePNG(scaleNearest(pfToRGB(six.frames.get(4200)!, 288, 160, 0, 'viridis'), 288, 160, 2), 576, 320)
);
console.timeEnd('needle + 6-fold runs');

/* ---------------- OG image: hero frame + dot-matrix wordmark ------------- */

// 5x7 dot-matrix font for the wordmark — instrument-panel style
const FONT: Record<string, number[]> = {
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b01010, 0b00100],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b11111],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  ' ': [0, 0, 0, 0, 0, 0, 0],
};

function stampText(
  rgb: Uint8Array,
  W: number,
  text: string,
  ox: number,
  oy: number,
  scale: number,
  color: [number, number, number]
): void {
  let cx = ox;
  for (const ch of text) {
    const glyph = FONT[ch] ?? FONT[' '];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (!(glyph[row] & (1 << (4 - col)))) continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const px = cx + col * scale + dx;
            const py = oy + row * scale + dy;
            const i = (py * W + px) * 3;
            rgb[i] = color[0];
            rgb[i + 1] = color[1];
            rgb[i + 2] = color[2];
          }
        }
      }
    }
    cx += 6 * scale;
  }
}

{
  const W = 1200;
  const H = 630;
  const rgb = new Uint8Array(W * H * 3);
  // background: deep viridis purple
  for (let i = 0; i < W * H; i++) {
    rgb[i * 3] = 0x24;
    rgb[i * 3 + 1] = 0x0b;
    rgb[i * 3 + 2] = 0x36;
  }
  // hero frame scaled 3.4x -> 1197x598, centred at bottom
  const frame = pfToRGB(heroFinal, 352, 176, 0, 'viridis');
  const k = 3.4;
  for (let y = 0; y < H; y++) {
    const sy = Math.floor((y - (H - 176 * k)) / k);
    if (sy < 0 || sy >= 176) continue;
    for (let x = 0; x < W; x++) {
      const sx = Math.floor(x / k);
      if (sx >= 352) continue;
      const si = (sy * 352 + sx) * 3;
      const di = (y * W + x) * 3;
      // darken the top of the sim so the wordmark stays legible
      const fade = Math.min(1, Math.max(0.35, (y - 40) / 300));
      rgb[di] = frame[si] * fade;
      rgb[di + 1] = frame[si + 1] * fade;
      rgb[di + 2] = frame[si + 2] * fade;
    }
  }
  // viridis ramp rule across the top
  for (let x = 0; x < W; x++) {
    const [r, g, b] = sample('viridis', x / (W - 1));
    for (let y = 0; y < 10; y++) {
      const i = (y * W + x) * 3;
      rgb[i] = r;
      rgb[i + 1] = g;
      rgb[i + 2] = b;
    }
  }
  stampText(rgb, W, 'VOLTAIRE', 72, 90, 14, [0xf2, 0xf5, 0xf8]);
  writeFileSync(join(ROOT, 'public', 'og.png'), encodePNG(rgb, W, H));
  console.log('og.png written');
}

/* ---------------- D1 poster (SVG) ---------------------------------------- */

{
  const n = 241;
  const eta: number[] = [];
  const j: number[] = [];
  const jl: number[] = [];
  for (let i = 0; i < n; i++) {
    const e = -0.4 + (0.8 * i) / (n - 1);
    eta.push(e);
    j.push(butlerVolmer(e, 1e-3, 0.5, 0.5, 298.15));
    const lin = butlerVolmerLinear(e, 1e-3, 0.5, 0.5, 298.15);
    jl.push(Math.abs(lin) > Math.abs(j[0]) ? NaN : lin);
  }
  writeFileSync(
    join(POSTERS, 'd1-butler-volmer.svg'),
    svgPlot({
      width: 640,
      height: 400,
      title: 'BUTLER-VOLMER  j0=1e-3 A/cm2  alpha=0.5/0.5  T=298 K',
      series: [
        { x: eta, y: j, color: C1, width: 2.5 },
        { x: eta, y: jl, color: CR, width: 1.5, dash: '5 4' },
      ],
      xLabel: 'overpotential eta / V',
      yLabel: 'j / A cm-2',
    })
  );
}

/* ---------------- D2 poster (SVG) ---------------------------------------- */

{
  const T = 298.15;
  const L = 50e-9;
  const sol = solvePNP({ L, c0: 100, epsR: 78.5, T, Vapp: 0.1, N: 220 });
  const gc = gouyChapman(sol.xHat, 0.1 / thermalVoltage(T), sol.lambdaD / L);
  const xnm = Array.from(sol.xHat, (v) => v * L * 1e9);
  const mV = 1000 * thermalVoltage(T);
  writeFileSync(
    join(POSTERS, 'd2-double-layer.svg'),
    svgPlot({
      width: 640,
      height: 400,
      title: 'PNP DOUBLE LAYER  +100 mV  0.1 M  vs GOUY-CHAPMAN (dashed)',
      series: [
        { x: xnm, y: Array.from(sol.psi, (v) => v * mV), color: C1, width: 2.5 },
        { x: xnm, y: Array.from(gc.psi, (v) => v * mV), color: CR, width: 1.5, dash: '5 4' },
      ],
      xLabel: 'x / nm',
      yLabel: 'phi / mV',
      xRange: [0, 12],
    })
  );
}

/* ---------------- D4 poster (SVG) ---------------------------------------- */

{
  const p: CircuitParams = { Rohm: 10, Rct: 25, Cdl: 2e-5, Rd: 30, tauD: 2, Rsei: 15, Csei: 2e-3, age: 1 };
  const omega = omegaGrid(0.01, 1e5, 70);
  const re: number[] = [];
  const im: number[] = [];
  for (const w of omega) {
    const z = impedance(w, p);
    re.push(z.re);
    im.push(-z.im);
  }
  const maxRe = Math.max(...re);
  writeFileSync(
    join(POSTERS, 'd4-impedance.svg'),
    svgPlot({
      width: 640,
      height: 400,
      title: 'NYQUIST  R + SEI + (RCT||CDL) + WARBURG   (aged cell, equal aspect)',
      series: [{ x: re, y: im, color: C1, width: 2.5 }],
      xLabel: "Z' / ohm cm2",
      yLabel: "-Z'' / ohm cm2",
      xRange: [0, maxRe * 1.05],
      yRange: [0, maxRe * 1.05 * (400 - 62) / (640 - 64)],
    })
  );
  // gallery: DRT ageing series
  const series = [0, 1, 2.5].map((age, i) => {
    const Z = Array.from(omega, (w) => impedance(w, { ...p, age }));
    const d = computeDRT(omega, Z, { nTau: 60, lambda: 1e-2 });
    return {
      x: Array.from(d.tau, (t) => Math.log10(t)),
      y: Array.from(d.gamma),
      color: [C1, C2, CR][i],
      width: 2,
    };
  });
  writeFileSync(
    join(GALLERY, 'drt-ageing.svg'),
    svgPlot({
      width: 720,
      height: 400,
      title: 'DRT vs SEI AGE  (fresh / 1x / 2.5x)  TIKHONOV-NNLS',
      series,
      xLabel: 'log10 tau / s',
      yLabel: 'gamma / ohm cm2',
    })
  );
}

/* ---------------- D5 poster + gallery (PNG) ------------------------------ */

function microPNG(porosity: number, seed: number): { rgb: Uint8Array; nx: number; ny: number; eps: number; deff: number } {
  const nx = 192;
  const ny = 120;
  const ms = generateRSA({ nx, ny, solidFraction: 1 - porosity, radius: 8, spread: 0.25, rng: mulberry32(seed) });
  const tr = solveTransport(ms);
  const rgb = new Uint8Array(nx * ny * 3);
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const i = y * nx + x;
      const j = i * 3;
      if (!ms.pore[i]) {
        rgb[j] = 0x2a;
        rgb[j + 1] = 0x32;
        rgb[j + 2] = 0x3d;
      } else {
        const [r, g, b] = sample('viridis', isNaN(tr.u[i]) ? 0 : tr.u[i]);
        rgb[j] = r;
        rgb[j + 1] = g;
        rgb[j + 2] = b;
      }
    }
  }
  return { rgb, nx, ny, eps: ms.porosity, deff: tr.deffRatio };
}

{
  const poster = microPNG(0.55, 21);
  writeFileSync(join(POSTERS, 'd5-microstructure.png'), encodePNG(scaleNearest(poster.rgb, poster.nx, poster.ny, 3), poster.nx * 3, poster.ny * 3));
  for (const [eps, seed] of [
    [0.45, 31],
    [0.6, 32],
    [0.75, 33],
  ] as const) {
    const g = microPNG(eps, seed);
    writeFileSync(
      join(GALLERY, `microstructure-eps${Math.round(eps * 100)}.png`),
      encodePNG(scaleNearest(g.rgb, g.nx, g.ny, 3), g.nx * 3, g.ny * 3)
    );
    console.log(`microstructure ε=${eps}: measured ε=${g.eps.toFixed(3)}, Deff/D0=${g.deff.toFixed(3)}`);
  }
}

console.log('all posters and gallery figures written');
