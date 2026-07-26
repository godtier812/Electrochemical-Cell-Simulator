import { Plot } from '../../lib/plot';
import { css } from '../../lib/colormaps';
import { mmsConvergence, solvePNP, gouyChapman } from '../../lib/pnp';
import { cottrellStep } from '../../lib/diffusion';
import { thermalVoltage } from '../../lib/constants';

/**
 * The landing page's validation strip: three of the four panels are computed
 * live in this browser tab when they scroll into view (the fourth, the
 * PyBaMM comparison, is honestly labelled "not yet run"). Each panel states
 * its check and links to /validation/.
 */
export function initValidationStrip(root: HTMLElement): void {
  const cNum = css('viridis', 0.45);
  const cRef = css('plasma', 0.55);

  const mmsCanvas = root.querySelector<HTMLCanvasElement>('#val-mms');
  if (mmsCanvas) {
    const rows = mmsConvergence([21, 41, 81, 161]);
    const h = Float64Array.from(rows, (r) => r.h);
    const e = Float64Array.from(rows, (r) => r.error);
    const order =
      Math.log(rows[rows.length - 2].error / rows[rows.length - 1].error) /
      Math.log(rows[rows.length - 2].h / rows[rows.length - 1].h);
    // reference slope-2 line anchored at the finest point
    const ref = Float64Array.from(h, (hi) => e[e.length - 1] * Math.pow(hi / h[h.length - 1], 2));
    new Plot(mmsCanvas, {
      xScale: 'log',
      yScale: 'log',
      xLabel: 'h',
      yLabel: 'L₂ error (ψ)',
      legend: 'tl',
    }).draw([
      { x: h, y: e, color: cNum, marker: 3, label: `measured (p=${order.toFixed(2)})` },
      { x: h, y: ref, color: cRef, dash: [4, 3], label: 'slope 2' },
    ]);
    const out = root.querySelector('#val-mms-order');
    if (out) out.textContent = `observed order ${order.toFixed(2)}`;
  }

  const cotCanvas = root.querySelector<HTMLCanvasElement>('#val-cottrell');
  if (cotCanvas) {
    const run = cottrellStep({
      D: 1e-9,
      cStar: 1,
      A: 1e-4,
      nElectrons: 1,
      L: 300e-6,
      N: 400,
      tEnd: 4,
      nSteps: 160,
    });
    new Plot(cotCanvas, {
      xScale: 'log',
      yScale: 'log',
      xLabel: 't / s',
      yLabel: 'i / A',
      legend: 'tr',
    }).draw([
      { x: run.t, y: run.i, color: cNum, width: 2, label: 'implicit FD' },
      { x: run.t, y: run.iCottrell, color: cRef, dash: [4, 3], label: 'Cottrell √(D/πt)' },
    ]);
  }

  const gcCanvas = root.querySelector<HTMLCanvasElement>('#val-gc');
  if (gcCanvas) {
    const T = 298.15;
    const Vapp = 0.1;
    const sol = solvePNP({ L: 60e-9, c0: 100, epsR: 78.5, T, Vapp, N: 160 });
    const gc = gouyChapman(sol.xHat, Vapp / thermalVoltage(T), sol.lambdaD / 60e-9);
    const xnm = Float64Array.from(sol.xHat, (v) => v * 60);
    const mV = 1000 * thermalVoltage(T);
    new Plot(gcCanvas, {
      xLabel: 'x / nm',
      yLabel: 'φ / mV',
      xRange: [0, 8],
      legend: 'tr',
    }).draw([
      { x: xnm, y: Float64Array.from(sol.psi, (v) => v * mV), color: cNum, width: 2, label: 'PNP numeric' },
      { x: xnm, y: Float64Array.from(gc.psi, (v) => v * mV), color: cRef, dash: [4, 3], label: 'Gouy–Chapman' },
    ]);
  }
}
