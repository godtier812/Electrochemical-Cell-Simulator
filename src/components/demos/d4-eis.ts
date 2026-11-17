import { Plot } from '../../lib/plot';
import { css } from '../../lib/colormaps';
import { columnsToCsv } from '../../lib/csv';
import { addNoise, impedance, omegaGrid, type CircuitParams } from '../../lib/eis';
import { computeDRT } from '../../lib/drt';
import { EIS_HANDOFF_KEY } from '../../lib/eisdata';
import { mulberry32 } from '../../lib/microstructure';
import { withBase } from '../../lib/url';
import {
  bindParam,
  enablePanel,
  rafDebounce,
  setupShell,
  siFormat,
  type Shell,
} from './runtime';

/** Fixed, so a given set of controls always shows the same noisy spectrum. */
const NOISE_SEED = 0x5eed1e55;

export function init(shell: Shell): void {
  const $ = <T extends HTMLElement>(sel: string) => shell.root.querySelector<T>(sel)!;
  const ageSlider = $<HTMLInputElement>('#d4-age');
  const outs = {
    age: $<HTMLOutputElement>('#d4-age-out'),
    misfit: $<HTMLOutputElement>('#d4-misfit'),
    rsum: $<HTMLOutputElement>('#d4-rsum'),
    hover: $<HTMLOutputElement>('#d4-hover'),
  };
  const analyse = $<HTMLButtonElement>('#d4-analyse');

  // build the four linked panels inside the stage
  const grid = document.createElement('div');
  grid.className = 'd4-grid';
  grid.innerHTML = `
    <div class="d4-cell d4-nyquist"><canvas role="img" aria-label="Nyquist plot: negative imaginary impedance against real impedance, equal axis scaling"></canvas></div>
    <div class="d4-cell"><canvas role="img" aria-label="Bode magnitude: absolute impedance against frequency"></canvas></div>
    <div class="d4-cell"><canvas role="img" aria-label="Bode phase: impedance phase angle against frequency"></canvas></div>
    <div class="d4-cell"><canvas role="img" aria-label="Distribution of relaxation times recovered from the spectrum"></canvas></div>`;
  shell.stage.insertBefore(grid, shell.stage.firstChild);
  const [cvNyq, cvMag, cvPhase, cvDrt] = [...grid.querySelectorAll('canvas')];

  const pNyq = new Plot(cvNyq, { equalAspect: true, hover: 'nearest', xLabel: "Z′ / Ω cm²", yLabel: "−Z″ / Ω cm²" });
  const pMag = new Plot(cvMag, { xScale: 'log', yScale: 'log', xLabel: 'f / Hz', yLabel: '|Z| / Ω cm²' });
  const pPhase = new Plot(cvPhase, { xScale: 'log', xLabel: 'f / Hz', yLabel: '−φ / °' });
  const pDrt = new Plot(cvDrt, { xScale: 'log', xLabel: 'τ / s', yLabel: 'γ(τ) / Ω cm²' });

  const N_FREQ = 60;
  const omega = omegaGrid(0.01, 1e5, N_FREQ);
  const freq = Float64Array.from(omega, (w) => w / (2 * Math.PI));

  let params: CircuitParams;
  let lastZ: { re: Float64Array; im: Float64Array } = {
    re: new Float64Array(N_FREQ),
    im: new Float64Array(N_FREQ),
  };
  /** The noise-free model curve, drawn under the points once noise is on. */
  let cleanZ: { re: Float64Array; negIm: Float64Array } | null = null;
  let lastDrt: ReturnType<typeof computeDRT> | null = null;
  let hoverTau: number | null = null;

  const rerun = () => recompute();
  const pRohm = bindParam(shell, 'd4-rohm', rerun);
  const pRct = bindParam(shell, 'd4-rct', rerun);
  const pCdl = bindParam(shell, 'd4-cdl', rerun);
  const pRd = bindParam(shell, 'd4-rd', rerun);
  const pTauD = bindParam(shell, 'd4-taud', rerun);
  const pNoise = bindParam(shell, 'd4-noise', rerun);
  const pLambda = bindParam(shell, 'd4-lambda', rerun);

  const readParams = (): CircuitParams => ({
    Rohm: pRohm.value,
    Rct: pRct.value,
    Cdl: pCdl.value,
    Rd: pRd.value,
    tauD: pTauD.value,
    Rsei: 15,
    Csei: 2e-3,
    age: Number(ageSlider.value) / 100,
  });

  const cData = css('viridis', 0.45);
  const cFit = css('plasma', 0.55);
  const cMark = css('viridis', 0.02);

  const recompute = rafDebounce(() => {
    params = readParams();
    const lambda = pLambda.value;

    outs.age.value = params.age === 0 ? 'fresh' : `${params.age.toFixed(2)}×`;

    const clean = Array.from(omega, (w) => impedance(w, params));
    const noise = pNoise.value / 100;
    const Z = addNoise(clean, noise, mulberry32(NOISE_SEED));
    lastZ = {
      re: Float64Array.from(Z, (z) => z.re),
      im: Float64Array.from(Z, (z) => z.im),
    };
    cleanZ =
      noise > 0
        ? { re: Float64Array.from(clean, (z) => z.re), negIm: Float64Array.from(clean, (z) => -z.im) }
        : null;
    lastDrt = computeDRT(omega, Z, { nTau: 60, lambda });
    outs.misfit.value = `${(lastDrt.misfit * 100).toFixed(2)}%`;
    // area under γ in ln τ: the polarisation resistance the inversion accounts for
    let area = 0;
    for (const g of lastDrt.gamma) area += g * lastDrt.dlnTau;
    outs.rsum.value = `${area.toFixed(1)} Ω cm²`;

    drawAll();
  });

  function drawAll(): void {
    if (!lastDrt) return;
    const negIm = Float64Array.from(lastZ.im, (v) => -v);
    // DRT reconstruction of the spectrum, for the fit overlay
    const fitRe = new Float64Array(N_FREQ);
    const fitIm = new Float64Array(N_FREQ);
    for (let i = 0; i < N_FREQ; i++) {
      let re = lastDrt.Rinf;
      let im = 0;
      for (let k = 0; k < lastDrt.tau.length; k++) {
        const wt = omega[i] * lastDrt.tau[k];
        const d = 1 + wt * wt;
        // gamma is a density in ln τ, so the measure goes back in here
        const g = lastDrt.gamma[k] * lastDrt.dlnTau;
        re += g / d;
        im -= (g * wt) / d;
      }
      fitRe[i] = re;
      fitIm[i] = -im;
    }

    const nyqAnnotations: Parameters<Plot['draw']>[1] = [];
    const drtAnnotations: Parameters<Plot['draw']>[1] = [];
    if (hoverTau !== null) {
      // mark the point on the spectrum at ω = 1/τ
      const w = 1 / hoverTau;
      const zi = impedance(w, params);
      nyqAnnotations.push(
        { type: 'segment', x1: zi.re, y1: 0, x2: zi.re, y2: -zi.im, color: cMark, dash: [3, 3] },
        { type: 'text', x: zi.re, y: -zi.im, text: '  ← f = ' + siFormat(w / (2 * Math.PI), 'Hz', 2), color: cMark }
      );
      drtAnnotations.push({ type: 'vline', x: hoverTau, color: cMark, dash: [3, 3] });
      outs.hover.value = `τ = ${siFormat(hoverTau, 's', 2)} (f = ${siFormat(1 / (2 * Math.PI * hoverTau), 'Hz', 2)})`;
    } else {
      outs.hover.value = '—';
    }

    pNyq.draw(
      cleanZ
        ? [
            // with noise on, the points are the "measurement" and the line is the truth behind it
            { x: lastZ.re, y: negIm, color: cData, marker: 2.5, width: 0, label: 'Z(ω) with noise' },
            { x: cleanZ.re, y: cleanZ.negIm, color: cData, width: 1.25, alpha: 0.5, label: 'noise-free' },
            { x: fitRe, y: fitIm, color: cFit, dash: [4, 3], width: 1.25, label: 'DRT fit' },
          ]
        : [
            { x: lastZ.re, y: negIm, color: cData, marker: 2.5, width: 1.25, label: 'Z(ω)' },
            { x: fitRe, y: fitIm, color: cFit, dash: [4, 3], width: 1.25, label: 'DRT fit' },
          ],
      nyqAnnotations
    );
    const mag = Float64Array.from(lastZ.re, (re, i) => Math.hypot(re, lastZ.im[i]));
    const phase = Float64Array.from(lastZ.re, (re, i) => (-Math.atan2(lastZ.im[i], re) * 180) / Math.PI);
    pMag.draw([{ x: freq, y: mag, color: cData, width: 1.75 }]);
    pPhase.draw([{ x: freq, y: phase, color: cData, width: 1.75 }]);
    pDrt.draw(
      [{ x: lastDrt.tau, y: lastDrt.gamma, color: cFit, width: 1.75, fill: true }],
      drtAnnotations
    );
  }

  // hover linking DRT -> Nyquist
  cvDrt.addEventListener('pointermove', (e) => {
    if (!lastDrt) return;
    const rect = cvDrt.getBoundingClientRect();
    const [x] = pDrt.pxToData(e.clientX - rect.left, e.clientY - rect.top);
    // snap to the nearest tau node
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < lastDrt.tau.length; k++) {
      const d = Math.abs(Math.log10(lastDrt.tau[k]) - Math.log10(x));
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    hoverTau = lastDrt.tau[best];
    drawAll();
  });
  cvDrt.addEventListener('pointerleave', () => {
    hoverTau = null;
    drawAll();
  });

  ageSlider.addEventListener('input', recompute);
  addEventListener('resize', recompute);

  const spectrumColumns = () => [
    { name: 'f / Hz', values: freq },
    { name: 'Zre / ohm cm2', values: lastZ.re },
    { name: 'Zim / ohm cm2', values: lastZ.im },
  ];

  // Hand the spectrum on screen to the analyser, which treats it exactly like
  // a pasted file. sessionStorage rather than the URL: 60 rows of doubles do
  // not belong in a query string, and nothing leaves the browser either way.
  analyse.addEventListener('click', () => {
    try {
      sessionStorage.setItem(EIS_HANDOFF_KEY, columnsToCsv(spectrumColumns()));
    } catch {
      // storage unavailable: the analyser opens on its built-in example instead
    }
    location.href = withBase('/tools/eis/');
  });

  setupShell(shell, {
    refresh: recompute,
    hold: () => {
      const label = `R_ct = ${pRct.format()}, age ${outs.age.value}`;
      for (const p of [pNyq, pMag, pPhase, pDrt]) p.hold(label);
    },
    clearHold: () => {
      for (const p of [pNyq, pMag, pPhase, pDrt]) p.clearHeld();
    },
    csv: () =>
      columnsToCsv([
        ...spectrumColumns(),
        { name: 'tau / s', values: lastDrt?.tau ?? [] },
        { name: 'gamma (density in ln tau) / ohm cm2', values: lastDrt?.gamma ?? [] },
      ]),
  });

  shell.stage.querySelector('img.poster')?.remove();
  enablePanel(shell);
  recompute();
}
