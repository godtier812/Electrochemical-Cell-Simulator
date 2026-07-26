import { Plot } from '../../lib/plot';
import { css } from '../../lib/colormaps';
import {
  butlerVolmer,
  butlerVolmerLinear,
  linearRegionMV,
  tafelSlopeMV,
} from '../../lib/butlervolmer';
import {
  createCanvas,
  enablePanel,
  rafDebounce,
  revealCanvas,
  siFormat,
  sliderToLog,
  type Shell,
} from './runtime';

const ETA_MAX = 0.4;

export function init(shell: Shell): void {
  const $ = <T extends HTMLElement>(sel: string) => shell.root.querySelector<T>(sel)!;
  const j0Slider = $<HTMLInputElement>('#d1-j0');
  const aaSlider = $<HTMLInputElement>('#d1-aa');
  const acSlider = $<HTMLInputElement>('#d1-ac');
  const lock = $<HTMLInputElement>('#d1-lock');
  const tSlider = $<HTMLInputElement>('#d1-T');
  const modeInputs = shell.root.querySelectorAll<HTMLInputElement>('input[name="d1-mode"]');
  const reset = $<HTMLButtonElement>('#d1-reset');

  const outJ0 = $<HTMLOutputElement>('#d1-j0-out');
  const outAa = $<HTMLOutputElement>('#d1-aa-out');
  const outAc = $<HTMLOutputElement>('#d1-ac-out');
  const outT = $<HTMLOutputElement>('#d1-T-out');
  const outSlopeA = $<HTMLOutputElement>('#d1-slope-a');
  const outSlopeC = $<HTMLOutputElement>('#d1-slope-c');
  const outLin = $<HTMLOutputElement>('#d1-linear');

  const canvas = createCanvas(shell, 'Current density versus overpotential for the Butler–Volmer equation with the current parameter values');
  const plot = new Plot(canvas);
  let firstFrame = true;

  const draw = rafDebounce(() => {
    const j0 = sliderToLog(Number(j0Slider.value), 1e-6, 1e-1);
    const aa = Number(aaSlider.value) / 100;
    if (lock.checked) {
      acSlider.value = String(100 - Number(aaSlider.value));
    }
    const ac = Number(acSlider.value) / 100;
    const T = Number(tSlider.value);
    const tafelMode = [...modeInputs].find((r) => r.checked)?.value === 'tafel';

    outJ0.value = siFormat(j0, 'A/cm²');
    outAa.value = aa.toFixed(2);
    outAc.value = ac.toFixed(2);
    outT.value = `${T} K`;
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

  for (const el of [j0Slider, aaSlider, acSlider, tSlider, lock]) {
    el.addEventListener('input', draw);
  }
  // exponents α are exchanged via the lock in both directions
  acSlider.addEventListener('input', () => {
    if (lock.checked) aaSlider.value = String(100 - Number(acSlider.value));
  });
  modeInputs.forEach((r) => r.addEventListener('change', draw));
  reset.addEventListener('click', () => {
    j0Slider.value = '50';
    aaSlider.value = '50';
    acSlider.value = '50';
    lock.checked = true;
    tSlider.value = '298';
    modeInputs.forEach((r) => (r.checked = r.value === 'linear'));
    draw();
  });
  addEventListener('resize', draw);

  enablePanel(shell);
  draw();
}
