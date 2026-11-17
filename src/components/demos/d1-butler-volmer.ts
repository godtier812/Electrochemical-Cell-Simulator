import { Plot } from '../../lib/plot';
import { css } from '../../lib/colormaps';
import { columnsToCsv } from '../../lib/csv';
import {
  butlerVolmer,
  butlerVolmerLinear,
  linearRegionMV,
  tafelSlopeMV,
} from '../../lib/butlervolmer';
import { thermalVoltage } from '../../lib/constants';
import { bindParam, enablePanel, rafDebounce, setupShell, siFormat, type Shell } from './runtime';

const ETA_MAX = 0.4;
const N = 481;

export function init(shell: Shell): void {
  const $ = <T extends HTMLElement>(sel: string) => shell.root.querySelector<T>(sel)!;
  const lock = $<HTMLInputElement>('#d1-lock');

  const outSlopeA = $<HTMLOutputElement>('#d1-slope-a');
  const outSlopeC = $<HTMLOutputElement>('#d1-slope-c');
  const outLin = $<HTMLOutputElement>('#d1-linear');
  const outRct = $<HTMLOutputElement>('#d1-rct');

  // The two views used to share one canvas behind a radio toggle, which made
  // the comparison the demo is for (where does the linear law stop, where does
  // Tafel start) a matter of flipping back and forth. Side by side instead.
  const grid = document.createElement('div');
  grid.className = 'split-stage';
  grid.innerHTML = `
    <div><canvas role="img" aria-label="Current density against overpotential on linear axes, with the linearised response"></canvas></div>
    <div><canvas role="img" aria-label="Magnitude of current density against overpotential on a logarithmic axis, with the anodic and cathodic Tafel asymptotes"></canvas></div>`;
  shell.stage.insertBefore(grid, shell.stage.firstChild);
  const [cvLin, cvTafel] = [...grid.querySelectorAll('canvas')];
  const pLin = new Plot(cvLin, { xLabel: 'η / V', yLabel: 'j / A cm⁻²', xRange: [-ETA_MAX, ETA_MAX] });
  const pTafel = new Plot(cvTafel, { xLabel: 'η / V', yLabel: '|j| / A cm⁻²', yScale: 'log', xRange: [-ETA_MAX, ETA_MAX] });

  const eta = new Float64Array(N);
  for (let i = 0; i < N; i++) eta[i] = -ETA_MAX + (2 * ETA_MAX * i) / (N - 1);
  let last: { j: Float64Array; jl: Float64Array; tafA: Float64Array; tafC: Float64Array } | null = null;

  const redraw = () => draw();
  const pJ0 = bindParam(shell, 'd1-j0', redraw);
  // The lock keeps α_a + α_c = 1, driven from whichever coefficient was touched.
  const pAa = bindParam(shell, 'd1-aa', () => {
    if (lock.checked) pAc.value = 1 - pAa.value;
    redraw();
  });
  const pAc = bindParam(shell, 'd1-ac', () => {
    if (lock.checked) pAa.value = 1 - pAc.value;
    redraw();
  });
  const pT = bindParam(shell, 'd1-T', redraw);

  const cBV = css('viridis', 0.45);
  const cLin = css('viridis', 0.05);
  const cTafel = css('plasma', 0.55);

  const draw = rafDebounce(() => {
    const j0 = pJ0.value;
    const aa = pAa.value;
    const ac = pAc.value;
    const T = pT.value;

    const bA = tafelSlopeMV(aa, T);
    const bC = tafelSlopeMV(ac, T);
    outSlopeA.value = `${bA.toFixed(0)} mV/dec`;
    outSlopeC.value = `${bC.toFixed(0)} mV/dec`;
    const linMV = linearRegionMV(j0, aa, ac, T);
    outLin.value = `±${linMV.toFixed(0)} mV`;
    outRct.value = siFormat(thermalVoltage(T) / ((aa + ac) * j0), 'Ω cm²');

    const j = Float64Array.from(eta, (e) => butlerVolmer(e, j0, aa, ac, T));
    const jl = Float64Array.from(eta, (e) => butlerVolmerLinear(e, j0, aa, ac, T));
    // clip the linear overlay to the span of the curve it approximates
    const jmax = Math.max(Math.abs(j[0]), Math.abs(j[N - 1]));
    for (let i = 0; i < N; i++) if (Math.abs(jl[i]) > jmax) jl[i] = NaN;
    pLin.draw(
      [
        { x: eta, y: j, color: cBV, label: 'Butler–Volmer', width: 2 },
        { x: eta, y: jl, color: cLin, dash: [5, 4], label: 'linearised' },
      ],
      [
        { type: 'vline', x: -linMV / 1000, dash: [2, 3] },
        { type: 'vline', x: linMV / 1000, dash: [2, 3], label: 'linear ±5%' },
        { type: 'hline', y: 0 },
      ]
    );

    const absj = Float64Array.from(j, Math.abs);
    // Tafel asymptotes |j| = j₀·10^(|η|/b), one per branch
    const tafA = Float64Array.from(eta, (e) => (e > 0 ? j0 * Math.pow(10, e / (bA / 1000)) : NaN));
    const tafC = Float64Array.from(eta, (e) => (e < 0 ? j0 * Math.pow(10, -e / (bC / 1000)) : NaN));
    pTafel.setOptions({ yRange: [j0 * 1e-3, Math.max(absj[0], absj[N - 1]) * 3] });
    pTafel.draw(
      [
        { x: eta, y: absj, color: cBV, label: '|j|', width: 2 },
        { x: eta, y: tafA, color: cTafel, dash: [5, 4], label: `anodic ${bA.toFixed(0)} mV/dec` },
        { x: eta, y: tafC, color: cLin, dash: [5, 4], label: `cathodic ${bC.toFixed(0)} mV/dec` },
      ],
      [{ type: 'hline', y: j0, dash: [2, 3], label: 'j₀' }]
    );
    last = { j, jl, tafA, tafC };
  });

  lock.addEventListener('input', () => {
    if (lock.checked) pAc.value = 1 - pAa.value;
    draw();
  });
  addEventListener('resize', draw);

  setupShell(shell, {
    refresh: draw,
    hold: () => {
      const label = `j₀ = ${pJ0.format()}, α_a = ${pAa.format()}`;
      pLin.hold(label);
      pTafel.hold(label);
    },
    clearHold: () => {
      pLin.clearHeld();
      pTafel.clearHeld();
    },
    csv: () =>
      columnsToCsv(
        last
          ? [
              { name: 'eta / V', values: eta },
              { name: 'j / A cm-2', values: last.j },
              { name: 'j linearised / A cm-2', values: last.jl },
              { name: 'Tafel anodic / A cm-2', values: last.tafA },
              { name: 'Tafel cathodic / A cm-2', values: last.tafC },
            ]
          : []
      ),
  });

  shell.stage.querySelector('img.poster')?.remove();
  enablePanel(shell);
  draw();
}
