import { fieldToRGBA } from '../../lib/colormaps';
import {
  generateRSA,
  solveTransport,
  streamline,
  type Microstructure,
  type TransportResult,
} from '../../lib/microstructure';
import { createCanvas, enablePanel, rafDebounce, revealCanvas, type Shell } from './runtime';

const NX = 192;
const NY = 120;

export function init(shell: Shell): void {
  const $ = <T extends HTMLElement>(sel: string) => shell.root.querySelector<T>(sel)!;
  const epsSlider = $<HTMLInputElement>('#d5-eps');
  const rSlider = $<HTMLInputElement>('#d5-r');
  const sSlider = $<HTMLInputElement>('#d5-s');
  const linesToggle = $<HTMLInputElement>('#d5-lines');
  const reseed = $<HTMLButtonElement>('#d5-reseed');
  const outs = {
    eps: $<HTMLOutputElement>('#d5-eps-out'),
    r: $<HTMLOutputElement>('#d5-r-out'),
    s: $<HTMLOutputElement>('#d5-s-out'),
    measEps: $<HTMLOutputElement>('#d5-meas-eps'),
    deff: $<HTMLOutputElement>('#d5-deff'),
    brugg: $<HTMLOutputElement>('#d5-brugg'),
    tort: $<HTMLOutputElement>('#d5-tort'),
    tortB: $<HTMLOutputElement>('#d5-tort-brugg'),
  };

  const canvas = createCanvas(
    shell,
    'Random particle packing rendered as dark disks with the pore-phase potential field in colour and streamlines threading between particles'
  );
  const ctx = canvas.getContext('2d')!;
  const off = document.createElement('canvas');
  off.width = NX;
  off.height = NY;
  const offCtx = off.getContext('2d')!;
  const img = offCtx.createImageData(NX, NY);

  let ms: Microstructure;
  let tr: TransportResult;
  let firstFrame = true;

  const render = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    // solid phase: theme surface tone; pore: viridis of the potential field
    const rgba = img.data;
    const solidCol = dark ? [29, 36, 46] : [214, 221, 227];
    const norm = new Float64Array(NX * NY);
    for (let i = 0; i < NX * NY; i++) norm[i] = isNaN(tr.u[i]) ? 0 : tr.u[i];
    fieldToRGBA('viridis', Float64Array.from(norm), rgba as unknown as Uint8ClampedArray);
    for (let i = 0; i < NX * NY; i++) {
      if (!ms.pore[i]) {
        rgba[i * 4] = solidCol[0];
        rgba[i * 4 + 1] = solidCol[1];
        rgba[i * 4 + 2] = solidCol[2];
      }
    }
    offCtx.putImageData(img, 0, 0);

    const dpr = Math.min(devicePixelRatio || 1, 2);
    const cw = canvas.clientWidth || 600;
    const ch = canvas.clientHeight || 375;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, cw, ch);

    if (linesToggle.checked && !tr.blocked) {
      const sx = cw / NX;
      const sy = ch / NY;
      ctx.strokeStyle = dark ? 'rgba(228,233,239,0.75)' : 'rgba(26,33,41,0.65)';
      ctx.lineWidth = 1;
      for (let k = 1; k <= 7; k++) {
        const y0 = (NY * k) / 8;
        const pts = streamline(ms, tr.u, 1.5, y0);
        if (pts.length < 8) continue;
        ctx.beginPath();
        ctx.moveTo(pts[0].x * sx, pts[0].y * sy);
        for (const p of pts) ctx.lineTo(p.x * sx, p.y * sy);
        ctx.stroke();
      }
    }
    if (firstFrame) {
      firstFrame = false;
      revealCanvas(shell, canvas);
    }
  };

  const regenerate = rafDebounce(() => {
    const solidTarget = 1 - Number(epsSlider.value) / 100;
    const radius = Number(rSlider.value);
    const spread = Number(sSlider.value) / 100;
    outs.eps.value = (Number(epsSlider.value) / 100).toFixed(2);
    outs.r.value = `${radius} px`;
    outs.s.value = `±${Math.round(spread * 100)}%`;

    ms = generateRSA({ nx: NX, ny: NY, solidFraction: solidTarget, radius, spread });
    tr = solveTransport(ms);

    outs.measEps.value = ms.porosity.toFixed(3);
    if (tr.blocked) {
      outs.deff.value = 'no percolating path';
      outs.tort.value = '∞';
    } else {
      outs.deff.value = tr.deffRatio.toFixed(3);
      outs.tort.value = tr.tortuosity.toFixed(2);
    }
    outs.brugg.value = tr.bruggemanRatio.toFixed(3);
    outs.tortB.value = Math.pow(ms.porosity, -0.5).toFixed(2);
    render();
  });

  for (const el of [epsSlider, rSlider, sSlider]) el.addEventListener('input', regenerate);
  linesToggle.addEventListener('change', render);
  reseed.addEventListener('click', regenerate);
  addEventListener('resize', () => render());
  addEventListener('voltaire-theme', () => render());

  enablePanel(shell);
  regenerate();
}
