import { writeFileSync } from 'node:fs';
import { PF_DEFAULTS, cpuStep, seedState, surfaceMetrics } from '../src/lib/phasefield';
import { sample } from '../src/lib/colormaps';
import { encodePNG } from '../scripts/png';
import { mulberry32 } from '../src/lib/microstructure';

const nx = 256, ny = 144;
let a = seedState(nx, ny, 3, mulberry32(11));
let b = new Float32Array(a.length);
const P = { ...PF_DEFAULTS };
const t0 = Date.now();
for (let f = 0; f < 3000; f++) {
  cpuStep(a, b, nx, ny, P, f);
  [a, b] = [b, a];
  if (f % 600 === 599) {
    const m = surfaceMetrics(a, nx, ny);
    let maxH = 0;
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) if (a[(y*nx+x)*2] > 0.5 && y > maxH) maxH = y;
    console.log(`step ${f+1}: solid=${m.solidFraction.toFixed(3)} iface=${m.interfaceCells} maxH=${maxH} rough=${m.roughness.toFixed(2)}`);
    let bad = false;
    for (let i = 0; i < a.length; i++) if (!isFinite(a[i])) { bad = true; break; }
    if (bad) { console.log('NaN detected!'); break; }
  }
}
console.log('elapsed ms:', Date.now() - t0);
const rgb = new Uint8Array(nx * ny * 3);
for (let y = 0; y < ny; y++) {
  for (let x = 0; x < nx; x++) {
    const p = a[((ny - 1 - y) * nx + x) * 2];
    const [r, g, bb] = sample('viridis', p);
    const j = (y * nx + x) * 3;
    rgb[j] = r; rgb[j+1] = g; rgb[j+2] = bb;
  }
}
writeFileSync('.debug/pf.png', encodePNG(rgb, nx, ny));
console.log('wrote .debug/pf.png');
