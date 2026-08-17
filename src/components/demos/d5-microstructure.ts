import { fieldToRGBA } from '../../lib/colormaps';
import {
  generateRSA,
  mulberry32,
  solveTransport,
  streamline,
  type Microstructure,
  type TransportResult,
} from '../../lib/microstructure';
import { bindParam, createCanvas, enablePanel, rafDebounce, revealCanvas, type Shell } from './runtime';

const NX = 192;
const NY = 120;

export function init(shell: Shell): void {
  const $ = <T extends HTMLElement>(sel: string) => shell.root.querySelector<T>(sel)!;
  const linesToggle = $<HTMLInputElement>('#d5-lines');
  const reseed = $<HTMLButtonElement>('#d5-reseed');
  const outs = {
    measEps: $<HTMLOutputElement>('#d5-meas-eps'),
    deff: $<HTMLOutputElement>('#d5-deff'),
    brugg: $<HTMLOutputElement>('#d5-brugg'),
    maxwell: $<HTMLOutputElement>('#d5-maxwell'),
    tort: $<HTMLOutputElement>('#d5-tort'),
    tortB: $<HTMLOutputElement>('#d5-tort-brugg'),
    sat: $<HTMLOutputElement>('#d5-sat'),
  };
  const satNote = $<HTMLSpanElement>('#d5-sat-note');

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
    // Blend by pore fraction rather than switching on a binary flag: a cell the
    // particle boundary cuts through is part solid, and drawing it as one or the
    // other is the same rounding the solver no longer does.
    for (let i = 0; i < NX * NY; i++) {
      const a = ms.phi[i];
      if (a >= 1) continue;
      const s = 1 - a;
      rgba[i * 4] = Math.round(rgba[i * 4] * a + solidCol[0] * s);
      rgba[i * 4 + 1] = Math.round(rgba[i * 4 + 1] * a + solidCol[1] * s);
      rgba[i * 4 + 2] = Math.round(rgba[i * 4 + 2] * a + solidCol[2] * s);
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

  /**
   * The packing seed is held across slider moves so that changing porosity,
   * radius or polydispersity varies that one parameter against a fixed draw.
   * Reseeding on every move changed the structure and the parameter together,
   * which makes the comparison the demo exists for impossible to read. A new
   * draw is what the "new packing" button is for.
   */
  let seed = (Math.random() * 0x100000000) >>> 0;

  const rerun = () => regenerate();
  const pEps = bindParam(shell, 'd5-eps', rerun);
  const pR = bindParam(shell, 'd5-r', rerun);
  const pS = bindParam(shell, 'd5-s', rerun);

  const regenerate = rafDebounce(() => {
    const solidTarget = 1 - pEps.value;
    const radius = pR.value;
    const spread = pS.value / 100;

    ms = generateRSA({ nx: NX, ny: NY, solidFraction: solidTarget, radius, spread, rng: mulberry32(seed) });
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
    outs.maxwell.value = tr.maxwell2dRatio.toFixed(3);
    outs.tortB.value = Math.pow(ms.porosity, -0.5).toFixed(2);

    // The slider asks for a target porosity; RSA cannot always reach it. Say so
    // with the value actually attained rather than letting the control look dead.
    satNote.hidden = !ms.saturated;
    if (ms.saturated) outs.sat.value = `ε cannot go below ${ms.porosity.toFixed(3)} at this radius and polydispersity`;
    render();
  });

  linesToggle.addEventListener('change', render);
  reseed.addEventListener('click', () => {
    seed = (seed + 0x9e3779b9) >>> 0; // golden-ratio step: well spread, no state beyond the seed
    regenerate();
  });
  addEventListener('resize', () => render());
  addEventListener('voltaire-theme', () => render());

  enablePanel(shell);
  regenerate();
}
