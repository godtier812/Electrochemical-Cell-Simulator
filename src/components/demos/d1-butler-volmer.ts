import { Plot } from '../../lib/plot';
import { css } from '../../lib/colormaps';
import {
  butlerVolmer,
  butlerVolmerLinear,
  linearRegionMV,
  tafelSlopeMV,
} from '../../lib/butlervolmer';
import {
  bindParam,
  createCanvas,
  enablePanel,
  rafDebounce,
  revealCanvas,
  type Shell,
} from './runtime';

const ETA_MAX = 0.4;

export function init(shell: Shell): void {
  const $ = <T extends HTMLElement>(sel: string) => shell.root.querySelector<T>(sel)!;
  const lock = $<HTMLInputElement>('#d1-lock');
  const modeInputs = shell.root.querySelectorAll<HTMLInputElement>('input[name="d1-mode"]');
  const reset = $<HTMLButtonElement>('#d1-reset');

  const outSlopeA = $<HTMLOutputElement>('#d1-slope-a');
  const outSlopeC = $<HTMLOutputElement>('#d1-slope-c');
  const outLin = $<HTMLOutputElement>('#d1-linear');

  const canvas = createCanvas(shell, 'Current density versus overpotential for the Butler–Volmer equation with the current parameter values');
  const plot = new Plot(canvas);
  let firstFrame = true;

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

  const draw = rafDebounce(() => {
    const j0 = pJ0.value;
    const aa = pAa.value;
    const ac = pAc.value;
    const T = pT.value;
    const tafelMode = [...modeInputs].find((r) => r.checked)?.value === 'tafel';

    const bA = tafelSlopeMV(aa, T);
    const bC = tafelSlopeMV(ac, T);
    outSlopeA.value = `${bA.toFixed(0)} mV/dec`;
    outSlopeC.value = `${bC.toFixed(0)} mV/dec`;
    const linMV = linearRegionMV(j0, aa, ac, T);
    outLin.value = `±${linMV.toFixed(0)} mV`;

    const n = 481;
    const eta = new Float64Array(n);
    for (let i = 0; i < n; i++) eta[i] = -ETA_MAX + (2 * ETA_MAX * i) / (n - 1);

    const cBV = css('viridis', 0.45);
    const cLin = css('viridis', 0.05);
    const cTafel = css('plasma', 0.55);

    if (!tafelMode) {
      const j = Float64Array.from(eta, (e) => butlerVolmer(e, j0, aa, ac, T));
      const jl = Float64Array.from(eta, (e) => butlerVolmerLinear(e, j0, aa, ac, T));
      // clip the linear overlay to a sane vertical span
      const jmax = Math.max(Math.abs(j[0]), Math.abs(j[n - 1]));
      for (let i = 0; i < n; i++) {
        if (Math.abs(jl[i]) > jmax) jl[i] = NaN;
      }
      plot.setOptions({
        xLabel: 'η / V',
        yLabel: 'j / A cm⁻²',
        xScale: 'linear',
        yScale: 'linear',
        xRange: [-ETA_MAX, ETA_MAX],
        yRange: undefined,
        legend: 'tl',
      });
      plot.draw(
        [
          { x: eta, y: j, color: cBV, label: 'Butler–Volmer', width: 2 },
          { x: eta, y: jl, color: cLin, dash: [5, 4], label: 'linear j ≈ j₀(αa+αc)Fη/RT' },
        ],
        [
          { type: 'vline', x: -linMV / 1000, dash: [2, 3] },
          { type: 'vline', x: linMV / 1000, dash: [2, 3], label: 'linear ±5%' },
          { type: 'hline', y: 0 },
        ]
      );
    } else {
      const absj = Float64Array.from(eta, (e) => Math.abs(butlerVolmer(e, j0, aa, ac, T)));
      // Tafel asymptotes |j| = j0·exp(αF|η|/RT)
      // decade slope b [V] = bA/1000; |j| = j0·10^(|η|/b) on each branch
      const tafA = Float64Array.from(eta, (e) => (e > 0 ? j0 * Math.pow(10, e / (bA / 1000)) : NaN));
      const tafC = Float64Array.from(eta, (e) => (e < 0 ? j0 * Math.pow(10, -e / (bC / 1000)) : NaN));
      plot.setOptions({
        xLabel: 'η / V',
        yLabel: '|j| / A cm⁻²',
        xScale: 'linear',
        yScale: 'log',
        xRange: [-ETA_MAX, ETA_MAX],
        yRange: [j0 * 1e-3, Math.max(...absj) * 3],
        legend: 'bl',
      });
      plot.draw(
        [
          { x: eta, y: absj, color: cBV, label: '|j| Butler–Volmer', width: 2 },
          { x: eta, y: tafA, color: cTafel, dash: [5, 4], label: `Tafel anodic ${bA.toFixed(0)} mV/dec` },
          { x: eta, y: tafC, color: cLin, dash: [5, 4], label: `Tafel cathodic ${bC.toFixed(0)} mV/dec` },
        ],
        [{ type: 'hline', y: j0, dash: [2, 3], label: 'j₀' }]
      );
    }
    if (firstFrame) {
      firstFrame = false;
      revealCanvas(shell, canvas);
    }
  });

  lock.addEventListener('input', () => {
    if (lock.checked) pAc.value = 1 - pAa.value;
    draw();
  });
  modeInputs.forEach((r) => r.addEventListener('change', draw));
  reset.addEventListener('click', () => {
    for (const p of [pJ0, pAa, pAc, pT]) p.reset();
    lock.checked = true;
    modeInputs.forEach((r) => (r.checked = r.value === 'linear'));
    draw();
  });
  addEventListener('resize', draw);

  enablePanel(shell);
  draw();
}
