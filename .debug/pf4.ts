import { writeFileSync } from 'node:fs';
import { PF_DEFAULTS, cpuStep, seedState, type PFParams } from '../src/lib/phasefield';
import { sample } from '../src/lib/colormaps';
import { encodePNG } from '../scripts/png';
import { mulberry32 } from '../src/lib/microstructure';

const nx = 288, ny = 200;
const P: PFParams = { ...PF_DEFAULTS, Leta: 0.09, D: 0.7, lambdaC: 3.5, W: 1.0, kappa0: 0.7, delta: 0.055, noise: 0.3, dt: 0.04 };
let a = seedState(nx, ny, 3, mulberry32(4));
let b = new Float32Array(a.length);
for (let f = 0; f < 6000; f++) { cpuStep(a, b, nx, ny, P, f); [a, b] = [b, a]; }
let solidVals: number[] = [];
for (let y = 20; y < 100; y++) for (let x = 0; x < nx; x++) {
  const p = a[(y*nx+x)*2];
  if (p > 0.5) solidVals.push(p);
}
console.log('mean solid xi:', (solidVals.reduce((s,v)=>s+v,0)/solidVals.length).toFixed(3));
const rgb = new Uint8Array(nx * ny * 3);
for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
  const p = a[((ny - 1 - y) * nx + x) * 2];
  const [r, g, bb] = sample('viridis', p);
  const j = (y * nx + x) * 3;
  rgb[j] = r; rgb[j+1] = g; rgb[j+2] = bb;
}
writeFileSync('.debug/pf-H.png', encodePNG(rgb, nx, ny));
