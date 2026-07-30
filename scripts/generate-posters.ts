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
import { gouyChapman, mmsConvergence, solvePNP } from '../src/lib/pnp';
import { cottrellStep } from '../src/lib/diffusion';
import { thermalVoltage } from '../src/lib/constants';
import { impedance, omegaGrid, type CircuitParams } from '../src/lib/eis';
import { computeDRT } from '../src/lib/drt';
import { generateRSA, mulberry32, solveTransport } from '../src/lib/microstructure';
import { simulateDischarge } from '../src/lib/spm';

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
/** 5x7 bitmap glyphs; enough to stamp page titles onto the social cards. */
const FONT: Record<string, number[]> = {
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b11111],
  J: [0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
  '0': [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  '1': [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  '2': [0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111],
  '3': [0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110],
  '4': [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  '5': [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  '6': [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  '7': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  '8': [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  '9': [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  '&': [0b01100, 0b10010, 0b10100, 0b01000, 0b10101, 0b10010, 0b01101],
  '-': [0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000],
  '.': [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b01100, 0b01100],
  ':': [0b00000, 0b01100, 0b01100, 0b00000, 0b01100, 0b01100, 0b00000],
  '/': [0b00001, 0b00010, 0b00010, 0b00100, 0b01000, 0b01000, 0b10000],
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
            // Titles vary in length, so clip rather than run off the buffer.
            if (px < 0 || px >= W || py < 0) continue;
            const i = (py * W + px) * 3;
            if (i + 2 >= rgb.length) continue;
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

/* ---------------- D6 poster (SVG) ---------------------------------------- */

{
  const run = simulateDischarge({ cRate: 1, T: 298.15, radius: 6e-6, R0: 0.025 });
  writeFileSync(
    join(POSTERS, 'd6-discharge.svg'),
    svgPlot({
      width: 640,
      height: 400,
      title: 'DISCHARGE  NMC811|graphite SPM  1.00C  T=298 K  R=6 um',
      series: [
        { x: run.q.subarray(0, run.n), y: run.ocv.subarray(0, run.n), color: CR, width: 1.5, dash: '5 4' },
        { x: run.q.subarray(0, run.n), y: run.v.subarray(0, run.n), color: C1, width: 2.5 },
      ],
      xLabel: 'discharged capacity / A h',
      yLabel: 'cell voltage / V',
      xRange: [0, run.capacityNominal * 1.05],
      yRange: [2.4, 4.3],
    })
  );
  console.log(
    `discharge poster: Q=${run.capacity.toFixed(3)} Ah, mean V=${run.meanV.toFixed(3)}, E=${run.energy.toFixed(2)} Wh, cutoff=${run.cutoff}`
  );
}

/* ---------------- per-page social cards (1200x630 PNG) -------------------- */

/**
 * One Open Graph card per page. These have to be PNG — three of the demo
 * posters are SVG, which no social scraper renders — and each one is painted by
 * the same physics code as the page it fronts, so a shared link previews the
 * thing the page is actually about.
 */
const OG_W = 1200;
const OG_H = 630;
const OG_BG: [number, number, number] = [0x24, 0x0b, 0x36];
const OG_INK: [number, number, number] = [0xf2, 0xf5, 0xf8];

/** Panel the artwork occupies, leaving the wordmark and title clear. */
const ART = { x: 0, y: 210, w: OG_W, h: OG_H - 210 };

function ogBase(): Uint8Array {
  const rgb = new Uint8Array(OG_W * OG_H * 3);
  for (let i = 0; i < OG_W * OG_H; i++) {
    rgb[i * 3] = OG_BG[0];
    rgb[i * 3 + 1] = OG_BG[1];
    rgb[i * 3 + 2] = OG_BG[2];
  }
  return rgb;
}

function ogFinish(rgb: Uint8Array, title: string, file: string): void {
  // viridis ramp rule across the top, as on every page of the site
  for (let x = 0; x < OG_W; x++) {
    const [r, g, b] = sample('viridis', x / (OG_W - 1));
    for (let y = 0; y < 12; y++) {
      const i = (y * OG_W + x) * 3;
      rgb[i] = r;
      rgb[i + 1] = g;
      rgb[i + 2] = b;
    }
  }
  stampText(rgb, OG_W, 'VOLTAIRE', 72, 78, 10, OG_INK);
  const upper = title.toUpperCase();
  // 6px per glyph cell at scale 1; shrink the scale until the title fits
  let scale = 9;
  while (scale > 3 && 72 + upper.length * 6 * scale > OG_W - 72) scale--;
  stampText(rgb, OG_W, upper, 72, 150, scale, sample('viridis', 0.62));
  writeFileSync(join(POSTERS, file), encodePNG(rgb, OG_W, OG_H));
  console.log(`og card: ${file}`);
}

/** Blit a field render into the art panel, fading it out towards the title. */
function ogField(rgb: Uint8Array, src: Uint8Array, nx: number, ny: number): void {
  const k = Math.max(ART.w / nx, ART.h / ny);
  for (let y = ART.y; y < OG_H; y++) {
    const sy = Math.floor((y - ART.y) / k);
    if (sy < 0 || sy >= ny) continue;
    for (let x = 0; x < OG_W; x++) {
      const sx = Math.floor(x / k);
      if (sx < 0 || sx >= nx) continue;
      const si = (sy * nx + sx) * 3;
      const di = (y * OG_W + x) * 3;
      const fade = Math.min(1, (y - ART.y) / 90);
      rgb[di] = OG_BG[0] + (src[si] - OG_BG[0]) * fade;
      rgb[di + 1] = OG_BG[1] + (src[si + 1] - OG_BG[1]) * fade;
      rgb[di + 2] = OG_BG[2] + (src[si + 2] - OG_BG[2]) * fade;
    }
  }
}

interface OgSeries {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  t: number;
}

/**
 * Rasterise curves into the art panel. The curve pages (kinetics, impedance,
 * numerics, validation, docs) have no field to show, so their card is the plot
 * the page is about, drawn from real solver output.
 */
function ogPlot(rgb: Uint8Array, series: OgSeries[], logX = false, logY = false): void {
  const pad = 46;
  const px0 = ART.x + pad;
  const px1 = ART.x + ART.w - pad;
  const py0 = ART.y + 24;
  const py1 = OG_H - pad;
  const tx = (v: number) => (logX ? Math.log10(Math.max(v, 1e-300)) : v);
  const ty = (v: number) => (logY ? Math.log10(Math.max(v, 1e-300)) : v);

  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const s of series) {
    for (let i = 0; i < s.x.length; i++) {
      const X = tx(s.x[i]);
      const Y = ty(s.y[i]);
      if (!isFinite(X) || !isFinite(Y)) continue;
      xMin = Math.min(xMin, X); xMax = Math.max(xMax, X);
      yMin = Math.min(yMin, Y); yMax = Math.max(yMax, Y);
    }
  }
  if (!isFinite(xMin) || xMax === xMin || yMax === yMin) return;
  const spanY = yMax - yMin;
  yMin -= spanY * 0.06;
  yMax += spanY * 0.06;

  const sx = (v: number) => px0 + ((tx(v) - xMin) / (xMax - xMin)) * (px1 - px0);
  const sy = (v: number) => py1 - ((ty(v) - yMin) / (yMax - yMin)) * (py1 - py0);

  const put = (x: number, y: number, c: [number, number, number]) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || xi >= OG_W || yi < ART.y || yi >= OG_H) return;
    const i = (yi * OG_W + xi) * 3;
    rgb[i] = c[0]; rgb[i + 1] = c[1]; rgb[i + 2] = c[2];
  };

  // baseline furniture: a faint frame so the curve reads as a plot
  const axisCol: [number, number, number] = [0x62, 0x50, 0x76];
  for (let x = px0; x <= px1; x++) { put(x, py1, axisCol); }
  for (let y = py0; y <= py1; y++) { put(px0, y, axisCol); }

  for (const s of series) {
    const col = sample('viridis', s.t);
    let lastX = NaN;
    let lastY = NaN;
    for (let i = 0; i < s.x.length; i++) {
      const X = tx(s.x[i]);
      const Y = ty(s.y[i]);
      if (!isFinite(X) || !isFinite(Y)) { lastX = NaN; continue; }
      const cx = sx(s.x[i]);
      const cy = sy(s.y[i]);
      if (isFinite(lastX)) {
        const steps = Math.max(1, Math.ceil(Math.hypot(cx - lastX, cy - lastY)));
        for (let k = 0; k <= steps; k++) {
          const px = lastX + ((cx - lastX) * k) / steps;
          const py = lastY + ((cy - lastY) * k) / steps;
          // 3px nib so the line survives social-media downscaling
          for (let w = -1; w <= 1; w++) for (let h = -1; h <= 1; h++) put(px + w, py + h, col);
        }
      }
      lastX = cx;
      lastY = cy;
    }
  }
}

{
  console.time('og cards');

  // Demos and dendrites reuse phase-field frames already computed above, so
  // these cards cost no extra simulation time.
  {
    const rgb = ogBase();
    ogField(rgb, pfToRGB(hero.frames.get(5000)!, 352, 176, 0, 'viridis'), 352, 176);
    ogFinish(rgb, 'Demos', 'og-demos.png');
  }
  {
    const rgb = ogBase();
    ogField(rgb, pfToRGB(six.frames.get(4200)!, 288, 160, 0, 'viridis'), 288, 160);
    ogFinish(rgb, 'Dendrites', 'og-physics-dendrites.png');
  }
  {
    const rgb = ogBase();
    ogField(rgb, pfToRGB(heroFinal, 352, 176, 1, 'inferno'), 352, 176);
    ogFinish(rgb, 'Gallery', 'og-gallery.png');
  }
  {
    const g = microPNG(0.55, 21);
    const rgb = ogBase();
    ogField(rgb, g.rgb, g.nx, g.ny);
    ogFinish(rgb, 'Microstructure', 'og-microstructure.png');
  }

  // Butler-Volmer j(eta) for the kinetics page.
  {
    const n = 400;
    const eta: number[] = [];
    const j: number[] = [];
    for (let i = 0; i < n; i++) {
      const e = -0.4 + (0.8 * i) / (n - 1);
      eta.push(e);
      j.push(butlerVolmer(e, 1e-3, 0.5, 0.5, 298.15));
    }
    const rgb = ogBase();
    ogPlot(rgb, [{ x: eta, y: j, t: 0.45 }]);
    ogFinish(rgb, 'Kinetics', 'og-physics-kinetics.png');
  }

  // PNP potential and the Gouy-Chapman reference for the transport page.
  {
    const L = 60e-9;
    const sol = solvePNP({ L, c0: 100, epsR: 78.5, T: 298.15, Vapp: 0.1, N: 220 });
    const gc = gouyChapman(sol.xHat, 0.1 / thermalVoltage(298.15), sol.lambdaD / L);
    const x = Array.from(sol.xHat, (v) => v * L * 1e9);
    const rgb = ogBase();
    ogPlot(rgb, [
      { x, y: Array.from(gc.psi), t: 0.8 },
      { x, y: Array.from(sol.psi), t: 0.4 },
    ]);
    ogFinish(rgb, 'Transport', 'og-physics-transport.png');
  }

  // Nyquist arc for the impedance page.
  {
    const p: CircuitParams = { Rohm: 10, Rct: 25, Cdl: 2e-5, Rd: 30, tauD: 2, Rsei: 15, Csei: 2e-3, age: 0.6 };
    // Array.from, not .map: omegaGrid returns a Float64Array, whose map would
    // coerce each complex impedance object to NaN.
    const Z = Array.from(omegaGrid(0.01, 1e5, 220), (w) => impedance(w, p));
    const rgb = ogBase();
    ogPlot(rgb, [{ x: Z.map((z) => z.re), y: Z.map((z) => -z.im), t: 0.45 }]);
    ogFinish(rgb, 'Impedance', 'og-physics-impedance.png');
  }

  // Measured order of accuracy for the numerics page: real MMS output.
  {
    const rows = mmsConvergence([21, 41, 81, 161, 321]);
    const rgb = ogBase();
    ogPlot(
      rgb,
      [
        { x: rows.map((r) => r.h), y: rows.map((r) => r.error), t: 0.45 },
        // second-order reference slope, anchored on the coarsest mesh
        { x: rows.map((r) => r.h), y: rows.map((r) => rows[0].error * (r.h / rows[0].h) ** 2), t: 0.8 },
      ],
      true,
      true
    );
    ogFinish(rgb, 'Numerics', 'og-numerics.png');
  }

  // Cottrell decay against its analytic reference for the validation page.
  {
    const run = cottrellStep({ D: 1e-9, cStar: 1, A: 1e-4, nElectrons: 1, L: 400e-6, N: 400, tEnd: 5, nSteps: 240 });
    const rgb = ogBase();
    ogPlot(
      rgb,
      [
        { x: Array.from(run.t), y: Array.from(run.iCottrell), t: 0.8 },
        { x: Array.from(run.t), y: Array.from(run.i), t: 0.45 },
      ],
      true,
      true
    );
    ogFinish(rgb, 'Validation', 'og-validation.png');
  }

  // The discharge curve the quickstart describes, shared by the docs pages.
  {
    const run = simulateDischarge({ cRate: 1, T: 298.15, radius: 6e-6, R0: 0.025 });
    const rgb = ogBase();
    ogPlot(rgb, [
      { x: Array.from(run.q.subarray(0, run.n)), y: Array.from(run.ocv.subarray(0, run.n)), t: 0.8 },
      { x: Array.from(run.q.subarray(0, run.n)), y: Array.from(run.v.subarray(0, run.n)), t: 0.45 },
    ]);
    ogFinish(rgb, 'Documentation', 'og-docs.png');
  }

  // Pages with no field or curve of their own get a titled card.
  for (const [title, file] of [
    ['Thermal', 'og-physics-thermal.png'],
    ['Degradation', 'og-physics-degradation.png'],
    ['Roadmap', 'og-roadmap.png'],
    ['Cite', 'og-cite.png'],
    ['About', 'og-about.png'],
  ] as const) {
    const rgb = ogBase();
    // a viridis wash so the plain cards still look like part of the set
    for (let y = ART.y; y < OG_H; y++) {
      for (let x = 0; x < OG_W; x++) {
        const t = (x / OG_W) * 0.55 + ((y - ART.y) / ART.h) * 0.25;
        const [r, g, b] = sample('viridis', Math.min(0.95, t));
        const fade = 0.10 + 0.16 * ((y - ART.y) / ART.h);
        const i = (y * OG_W + x) * 3;
        rgb[i] = OG_BG[0] + (r - OG_BG[0]) * fade;
        rgb[i + 1] = OG_BG[1] + (g - OG_BG[1]) * fade;
        rgb[i + 2] = OG_BG[2] + (b - OG_BG[2]) * fade;
      }
    }
    ogFinish(rgb, title, file);
  }
  console.timeEnd('og cards');
}

console.log('all posters and gallery figures written');
