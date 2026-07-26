import { writeFileSync } from 'node:fs';
import { PF_DEFAULTS, cpuStep, seedState, type PFParams } from '../src/lib/phasefield';
import { sample } from '../src/lib/colormaps';
import { encodePNG } from '../scripts/png';
import { mulberry32 } from '../src/lib/microstructure';

const nx = 256, ny = 144;
const P: PFParams = { ...PF_DEFAULTS, Leta: 0.05, D: 1.0, lambdaC: 2.5, W: 1.0, kappa0: 1.0, delta: 0.05, noise: 0.1, dt: 0.05 };
let a = seedState(nx, ny, 3, mulberry32(11));
let b = new Float32Array(a.length);
const snaps = [800, 1600, 2400, 3200];
let next = 0;
for (let f = 0; f < 3200; f++) {
  cpuStep(a, b, nx, ny, P, f);
  [a, b] = [b, a];
  if (next < snaps.length && f + 1 === snaps[next]) {
    const rgb = new Uint8Array(nx * ny * 3);
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const p = a[((ny - 1 - y) * nx + x) * 2];
      const [r, g, bb] = sample('viridis', p);
      const j = (y * nx + x) * 3;
      rgb[j] = r; rgb[j+1] = g; rgb[j+2] = bb;
    }
    writeFileSync(`.debug/pf-f${snaps[next]}.png`, encodePNG(rgb, nx, ny));
    next++;
  }
}
console.log('done');
