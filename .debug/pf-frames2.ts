import { writeFileSync } from 'node:fs';
import { PF_DEFAULTS, cpuStep, seedState, type PFParams } from '../src/lib/phasefield';
import { sample } from '../src/lib/colormaps';
import { encodePNG } from '../scripts/png';
import { mulberry32 } from '../src/lib/microstructure';

const nx = 288, ny = 176;
const combos: [string, Partial<PFParams>][] = [
  ['D', { Leta: 0.07, D: 0.8, lambdaC: 3.0, W: 1.2, kappa0: 0.9, delta: 0.05, noise: 0.2, dt: 0.05 }],
  ['E', { Leta: 0.06, D: 0.9, lambdaC: 3.0, W: 1.0, kappa0: 0.8, delta: 0.05, noise: 0.25, dt: 0.05 }],
];
for (const [name, over] of combos) {
  const P: PFParams = { ...PF_DEFAULTS, ...over };
  let a = seedState(nx, ny, 3, mulberry32(11));
  let b = new Float32Array(a.length);
  for (let f = 0; f < 4000; f++) {
    cpuStep(a, b, nx, ny, P, f);
    [a, b] = [b, a];
  }
  const rgb = new Uint8Array(nx * ny * 3);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const p = a[((ny - 1 - y) * nx + x) * 2];
    const [r, g, bb] = sample('viridis', p);
    const j = (y * nx + x) * 3;
    rgb[j] = r; rgb[j+1] = g; rgb[j+2] = bb;
  }
  writeFileSync(`.debug/pf-${name}.png`, encodePNG(rgb, nx, ny));
  console.log(name, 'done');
}
