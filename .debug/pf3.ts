import { writeFileSync } from 'node:fs';
import { PF_DEFAULTS, cpuStep, seedState, type PFParams } from '../src/lib/phasefield';
import { sample } from '../src/lib/colormaps';
import { encodePNG } from '../scripts/png';
import { mulberry32 } from '../src/lib/microstructure';

const nx = 288, ny = 200;
const combos: [string, Partial<PFParams>][] = [
  ['F', { Leta: 0.1, D: 0.7, lambdaC: 3.5, W: 0.8, kappa0: 0.65, delta: 0.06, noise: 0.35, dt: 0.04 }],
  ['G', { Leta: 0.15, D: 0.6, lambdaC: 4.0, W: 0.7, kappa0: 0.55, delta: 0.06, noise: 0.5, dt: 0.04 }],
];
for (const [name, over] of combos) {
  const P: PFParams = { ...PF_DEFAULTS, ...over };
  let a = seedState(nx, ny, 2, mulberry32(4));
  let b = new Float32Array(a.length);
  for (let f = 0; f < 6000; f++) { cpuStep(a, b, nx, ny, P, f); [a, b] = [b, a]; }
  let maxH = 0;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) if (a[(y*nx+x)*2] > 0.5 && y > maxH) maxH = y;
  console.log(name, 'maxH', maxH);
  const rgb = new Uint8Array(nx * ny * 3);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const p = a[((ny - 1 - y) * nx + x) * 2];
    const [r, g, bb] = sample('viridis', p);
    const j = (y * nx + x) * 3;
    rgb[j] = r; rgb[j+1] = g; rgb[j+2] = bb;
  }
  writeFileSync(`.debug/pf-${name}.png`, encodePNG(rgb, nx, ny));
}
