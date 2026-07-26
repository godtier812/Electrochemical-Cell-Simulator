import { Plot } from '../../lib/plot';
import { css } from '../../lib/colormaps';
import { gcCapacitance, gouyChapman, solvePNP } from '../../lib/pnp';
import { thermalVoltage } from '../../lib/constants';
import {
  enablePanel,
  rafDebounce,
  siFormat,
  sliderToLog,
  type Shell,
} from './runtime';

export function init(shell: Shell): void {
  const $ = <T extends HTMLElement>(sel: string) => shell.root.querySelector<T>(sel)!;
  const vSlider = $<HTMLInputElement>('#d2-v');
  const cSlider = $<HTMLInputElement>('#d2-c0');
  const lSlider = $<HTMLInputElement>('#d2-L');
  const tSlider = $<HTMLInputElement>('#d2-T');
  const reset = $<HTMLButtonElement>('#d2-reset');
  const outs = {
    v: $<HTMLOutputElement>('#d2-v-out'),
    c0: $<HTMLOutputElement>('#d2-c0-out'),
    L: $<HTMLOutputElement>('#d2-L-out'),
    T: $<HTMLOutputElement>('#d2-T-out'),
    lam: $<HTMLOutputElement>('#d2-lambda'),
    cap: $<HTMLOutputElement>('#d2-cap'),
    newton: $<HTMLOutputElement>('#d2-newton'),
  };

  const grid = document.createElement('div');
  grid.className = 'd2-grid';
  grid.innerHTML = `
    <div class="d2-cell">
      <canvas role="img" aria-label="Electrostatic potential profile across the gap, numerical solution and Gouy-Chapman overlay"></canvas>
      <div class="d2-inset"><canvas role="img" aria-label="Zoom of the potential over the first five Debye lengths"></canvas></div>
    </div>
    <div class="d2-cell">
      <canvas role="img" aria-label="Cation and anion concentration profiles on a log scale, with Gouy-Chapman overlays"></canvas>
      <div class="d2-inset"><canvas role="img" aria-label="Zoom of the concentrations over the first five Debye lengths"></canvas></div>
    </div>`;
  shell.stage.insertBefore(grid, shell.stage.firstChild);
  const cells = grid.querySelectorAll('canvas');
  const pPhi = new Plot(cells[0], { xLabel: 'x / nm', yLabel: 'φ / mV', legend: 'tr' });
  const pPhiZoom = new Plot(cells[1], { pad: 0.02 });
  const pC = new Plot(cells[2], { xLabel: 'x / nm', yLabel: 'C / c₀', yScale: 'log', legend: 'tr' });
  const pCZoom = new Plot(cells[3], { yScale: 'log', pad: 0.02 });

  const cNum = css('viridis', 0.45);
  const cNum2 = css('viridis', 0.75);
  const cGC = css('plasma', 0.55);

  const recompute = rafDebounce(() => {
    const Vapp = Number(vSlider.value) / 1000;
    const c0 = sliderToLog(Number(cSlider.value), 1, 1000);
    const L = Number(lSlider.value) * 1e-9;
    const T = Number(tSlider.value);

    outs.v.value = `${(Vapp * 1000).toFixed(0)} mV`;
    outs.c0.value = c0 >= 1 ? `${(c0 / 1000).toPrecision(3)} M` : `${c0.toPrecision(2)} mol/m³`;
    outs.L.value = `${(L * 1e9).toFixed(0)} nm`;
    outs.T.value = `${T} K`;

    const sol = solvePNP({ L, c0, epsR: 78.5, T, Vapp, N: 220 });
    const psi0 = Vapp / thermalVoltage(T);
    const lamHat = sol.lambdaD / L;
    const gc = gouyChapman(sol.xHat, psi0, lamHat);

    outs.lam.value = siFormat(sol.lambdaD, 'm');
    outs.cap.value = `${(gcCapacitance(78.5, T, c0, psi0) * 100).toPrecision(3)} µF/cm²`;
    outs.newton.value = sol.converged
      ? `${sol.newtonIterations} its, ‖R‖=${sol.residualNorm.toExponential(1)}`
      : 'did not converge';

    const n = sol.xHat.length;
    const xnm = Float64Array.from(sol.xHat, (v) => v * L * 1e9);
    const mV = (1000 * thermalVoltage(T));
    const phiNum = Float64Array.from(sol.psi, (v) => v * mV);
    const phiGC = Float64Array.from(gc.psi, (v) => v * mV);

    const phiSeries = [
      { x: xnm, y: phiNum, color: cNum, width: 2, label: 'PNP numeric' },
      { x: xnm, y: phiGC, color: cGC, dash: [5, 4], label: 'Gouy–Chapman' },
    ];
    const cSeries = [
      { x: xnm, y: sol.cPlus, color: cNum, width: 2, label: 'C₊' },
      { x: xnm, y: sol.cMinus, color: cNum2, width: 2, label: 'C₋' },
      { x: xnm, y: gc.cPlus, color: cGC, dash: [5, 4], label: 'GC' },
      { x: xnm, y: gc.cMinus, color: cGC, dash: [5, 4] },
    ];
    void n;
    pPhi.draw(phiSeries);
    pC.draw(cSeries);

    // insets: first 5 Debye lengths
    const zoomEnd = Math.min(5 * sol.lambdaD * 1e9, xnm[xnm.length - 1]);
    pPhiZoom.setOptions({ xRange: [0, zoomEnd] });
    pPhiZoom.draw(phiSeries.map((s) => ({ ...s, label: undefined })), [
      { type: 'vline', x: sol.lambdaD * 1e9, dash: [2, 3], label: 'λ_D' },
    ]);
    pCZoom.setOptions({ xRange: [0, zoomEnd] });
    pCZoom.draw(cSeries.map((s) => ({ ...s, label: undefined })), [
      { type: 'vline', x: sol.lambdaD * 1e9, dash: [2, 3], label: 'λ_D' },
    ]);
  });

  for (const el of [vSlider, cSlider, lSlider, tSlider]) el.addEventListener('input', recompute);
  reset.addEventListener('click', () => {
    vSlider.value = '100';
    cSlider.value = '67';
    lSlider.value = '50';
    tSlider.value = '298';
    recompute();
  });
  addEventListener('resize', recompute);

  shell.stage.querySelector('img.poster')?.remove();
  enablePanel(shell);
  recompute();
}
