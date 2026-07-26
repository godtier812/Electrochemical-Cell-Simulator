import { writeFileSync } from 'node:fs';
import { PF_DEFAULTS, cpuStep, seedState, surfaceMetrics, type PFParams } from '../src/lib/phasefield';
import { sample } from '../src/lib/colormaps';
import { encodePNG } from '../scripts/png';
import { mulberry32 } from '../src/lib/microstructure';

const combos: [string, Partial<PFParams>][] = [
  ['A', { Leta: 0.08, D: 1.0, lambdaC: 2.5, W: 1.0, noise: 0.08, delta: 0.05 }],
  ['B', { Leta: 0.12, D: 0.8, lambdaC: 3.0, W: 1.0, noise: 0.12, delta: 0.05 }],
  ['C', { Leta: 0.08, D: 1.0, lambdaC: 2.5, W: 0.6, noise: 0.08, delta: 0.05, kappa0: 0.9 }],
];
const nx = 256, ny = 144, steps = 3000;
for (const [name, over] of combos) {
  const P = { ...PF_DEFAULTS, ...over };
  let a = seedState(nx, ny, 3, mulberry32(11));
  let b = new Float32Array(a.length);
  let nan = false;
  for (let f = 0; f < steps; f++) {
    cpuStep(a, b, nx, ny, P, f);
    [a, b] = [b, a];
    if (f % 1000 === 999) {
      for (let i = 0; i < a.length; i += 997) if (!isFinite(a[i])) { nan = true; break; }
      if (nan) break;
    }
  }
  const m = surfaceMetrics(a, nx, ny);
  let maxH = 0;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) if (a[(y*nx+x)*2] > 0.5 && y > maxH) maxH = y;
  console.log(`${name}: ${nan ? 'NaN!' : ''} solid=${m.solidFraction.toFixed(3)} maxH=${maxH} rough=${m.roughness.toFixed(2)}`);
  const rgb = new Uint8Array(nx * ny * 3);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const p = a[((ny - 1 - y) * nx + x) * 2];
    const [r, g, bb] = sample('viridis', p);
    const j = (y * nx + x) * 3;
    rgb[j] = r; rgb[j+1] = g; rgb[j+2] = bb;
  }
  writeFileSync(`.debug/pf-${name}.png`, encodePNG(rgb, nx, ny));
}
