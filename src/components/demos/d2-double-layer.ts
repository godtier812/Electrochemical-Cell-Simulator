import { Plot } from '../../lib/plot';
import { css } from '../../lib/colormaps';
import { columnsToCsv } from '../../lib/csv';
import { gcCapacitance, gouyChapman, solvePNP } from '../../lib/pnp';
import { thermalVoltage } from '../../lib/constants';
import { bindParam, enablePanel, rafDebounce, setupShell, type Shell } from './runtime';

/** How much of the gap the default view shows, in Debye lengths. */
const VIEW_DEBYE = 10;

export function init(shell: Shell): void {
  const $ = <T extends HTMLElement>(sel: string) => shell.root.querySelector<T>(sel)!;
  const fullGap = $<HTMLInputElement>('#d2-full');
  const outs = {
    lam: $<HTMLOutputElement>('#d2-lambda'),
    cap: $<HTMLOutputElement>('#d2-cap'),
    ratio: $<HTMLOutputElement>('#d2-ratio'),
    newton: $<HTMLOutputElement>('#d2-newton'),
  };

  const grid = document.createElement('div');
  grid.className = 'split-stage';
  grid.innerHTML = `
    <div><canvas role="img" aria-label="Electrostatic potential against distance from the electrode, numerical solution and Gouy-Chapman overlay"></canvas></div>
    <div><canvas role="img" aria-label="Cation and anion concentration against distance from the electrode on a log scale, with Gouy-Chapman overlays"></canvas></div>`;
  shell.stage.insertBefore(grid, shell.stage.firstChild);
  const cells = grid.querySelectorAll('canvas');
  const pPhi = new Plot(cells[0], { xLabel: 'x / nm', yLabel: 'φ / mV' });
  const pC = new Plot(cells[1], { xLabel: 'x / nm', yLabel: 'C / c₀', yScale: 'log' });

  const cNum = css('viridis', 0.45);
  const cNum2 = css('viridis', 0.75);
  const cGC = css('plasma', 0.55);

  const rerun = () => recompute();
  const pV = bindParam(shell, 'd2-v', rerun);
  const pC0 = bindParam(shell, 'd2-c0', rerun);
  const pL = bindParam(shell, 'd2-L', rerun);
  const pT = bindParam(shell, 'd2-T', rerun);

  let last: Record<string, ArrayLike<number>> | null = null;

  const recompute = rafDebounce(() => {
    const Vapp = pV.value / 1000;
    // the control is in molar; the solver works in mol/m³
    const c0 = pC0.value * 1000;
    const L = pL.value * 1e-9;
    const T = pT.value;

    const sol = solvePNP({ L, c0, epsR: 78.5, T, Vapp, N: 220 });
    const psi0 = Vapp / thermalVoltage(T);
    const lamHat = sol.lambdaD / L;
    const gc = gouyChapman(sol.xHat, psi0, lamHat);

    // nanometres whatever the size: it is the unit the literature quotes λ_D in
    outs.lam.value = `${(sol.lambdaD * 1e9).toPrecision(3)} nm`;
    outs.cap.value = `${(gcCapacitance(78.5, T, c0, psi0) * 100).toPrecision(3)} µF/cm²`;
    outs.ratio.value = (1 / lamHat).toPrecision(3);
    outs.newton.value = sol.converged
      ? `${sol.newtonIterations} its, ‖R‖ = ${sol.residualNorm.toExponential(1)}`
      : 'did not converge';

    const xnm = Float64Array.from(sol.xHat, (v) => v * L * 1e9);
    const mV = 1000 * thermalVoltage(T);
    const phiNum = Float64Array.from(sol.psi, (v) => v * mV);
    const phiGC = Float64Array.from(gc.psi, (v) => v * mV);

    // The layer is a few Debye lengths of a gap that may be hundreds wide.
    // Plotting the whole gap put all the structure in the first 5% of the axis
    // and needed insets to be legible; the default view is the layer itself.
    const lamNm = sol.lambdaD * 1e9;
    const gapNm = xnm[xnm.length - 1];
    const xMax = fullGap.checked ? gapNm : Math.min(gapNm, VIEW_DEBYE * lamNm);
    const marks = [{ type: 'vline' as const, x: lamNm, dash: [2, 3], label: 'λ_D' }];

    pPhi.setOptions({ xRange: [0, xMax] });
    pPhi.draw(
      [
        { x: xnm, y: phiNum, color: cNum, width: 2, label: 'PNP numeric' },
        { x: xnm, y: phiGC, color: cGC, dash: [5, 4], label: 'Gouy–Chapman' },
      ],
      marks
    );
    pC.setOptions({ xRange: [0, xMax] });
    pC.draw(
      [
        { x: xnm, y: sol.cPlus, color: cNum, width: 2, label: 'C₊ numeric' },
        { x: xnm, y: sol.cMinus, color: cNum2, width: 2, label: 'C₋ numeric' },
        { x: xnm, y: gc.cPlus, color: cGC, dash: [5, 4], label: 'Gouy–Chapman' },
        { x: xnm, y: gc.cMinus, color: cGC, dash: [5, 4] },
      ],
      marks
    );
    last = {
      'x / nm': xnm,
      'phi numeric / mV': phiNum,
      'phi Gouy-Chapman / mV': phiGC,
      'C+ numeric / c0': sol.cPlus,
      'C- numeric / c0': sol.cMinus,
      'C+ Gouy-Chapman / c0': gc.cPlus,
      'C- Gouy-Chapman / c0': gc.cMinus,
    };
  });

  fullGap.addEventListener('change', recompute);
  addEventListener('resize', recompute);

  setupShell(shell, {
    refresh: recompute,
    hold: () => {
      const label = `${pV.format()} mV, ${pC0.format()} M`;
      pPhi.hold(label);
      pC.hold(label);
    },
    clearHold: () => {
      pPhi.clearHeld();
      pC.clearHeld();
    },
    csv: () => columnsToCsv(Object.entries(last ?? {}).map(([name, values]) => ({ name, values }))),
  });

  shell.stage.querySelector('img.poster')?.remove();
  enablePanel(shell);
  recompute();
}
