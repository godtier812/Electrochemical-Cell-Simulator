import { writeFileSync } from 'node:fs';
import { PF_DEFAULTS, cpuStep, seedState, type PFParams } from '../src/lib/phasefield';
import { sample } from '../src/lib/colormaps';
import { encodePNG } from '../scripts/png';
import { mulberry32 } from '../src/lib/microstructure';

const nx = 288, ny = 176;
const P: PFParams = { ...PF_DEFAULTS, Leta: 0.07, D: 0.8, lambdaC: 3.0, W: 1.2, kappa0: 0.9, delta: 0.05, noise: 0.2, dt: 0.05 };
let a = seedState(nx, ny, 3, mulberry32(11));
let b = new Float32Array(a.length);
for (let f = 0; f < 4000; f++) { cpuStep(a, b, nx, ny, P, f); [a, b] = [b, a]; }
let cMin = 10, cAtIface = [] as number[];
for (let y = 1; y < ny-1; y++) for (let x = 0; x < nx; x++) {
  const i = (y*nx+x)*2;
  const p = a[i], c = a[i+1];
  if (p < 0.4 && c < cMin) cMin = c;
  if (p > 0.3 && p < 0.7) cAtIface.push(c);
}
console.log('min C in electrolyte:', cMin.toFixed(4), 'mean C at interface:', (cAtIface.reduce((s,v)=>s+v,0)/cAtIface.length).toFixed(4));
const rgb = new Uint8Array(nx * ny * 3);
for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
  const i = ((ny - 1 - y) * nx + x) * 2;
  const c = a[i+1];
  const [r, g, bb] = sample('inferno', c);
  const j = (y * nx + x) * 3;
  rgb[j] = r; rgb[j+1] = g; rgb[j+2] = bb;
}
writeFileSync('.debug/pf-C.png', encodePNG(rgb, nx, ny));
