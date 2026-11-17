import { Plot } from '../../lib/plot';
import { css } from '../../lib/colormaps';
import { simulateDischarge } from '../../lib/spm';
import { columnsToCsv } from '../../lib/csv';
import { bindParam, createCanvas, enablePanel, rafDebounce, revealCanvas, setupShell, type Shell } from './runtime';

const CUTOFF_LABEL: Record<string, string> = {
  voltage: '2.5 V cut-off',
  stoichiometry: 'surface saturated',
  time: 'time limit',
};

export function init(shell: Shell): void {
  const $ = <T extends HTMLElement>(sel: string) => shell.root.querySelector<T>(sel)!;
  const showOcv = $<HTMLInputElement>('#d6-ocv');

  const outCap = $<HTMLOutputElement>('#d6-cap');
  const outVmean = $<HTMLOutputElement>('#d6-vmean');
  const outEnergy = $<HTMLOutputElement>('#d6-energy');
  const outCutoff = $<HTMLOutputElement>('#d6-cutoff');

  const canvas = createCanvas(
    shell,
    'Cell voltage against discharged capacity for the current C-rate, with the open-circuit curve for comparison'
  );
  const plot = new Plot(canvas);
  let firstFrame = true;
  let last: Record<string, ArrayLike<number>> | null = null;

  const redraw = () => draw();
  const pCrate = bindParam(shell, 'd6-crate', redraw);
  const pRadius = bindParam(shell, 'd6-radius', redraw);
  const pR0 = bindParam(shell, 'd6-r0', redraw);
  const pT = bindParam(shell, 'd6-T', redraw);

  const draw = rafDebounce(() => {
    const cRate = pCrate.value;
    const rMicron = pRadius.value;
    const T = pT.value;
    const series = pR0.value / 1000;

    const run = simulateDischarge({
      cRate,
      T,
      radius: rMicron * 1e-6,
      R0: series,
    });

    outCap.value = `${run.capacity.toFixed(2)} A·h`;
    outVmean.value = `${run.meanV.toFixed(3)} V`;
    outEnergy.value = `${run.energy.toFixed(1)} W·h`;
    outCutoff.value = CUTOFF_LABEL[run.cutoff] ?? run.cutoff;

    const q = run.q.subarray(0, run.n);
    const v = run.v.subarray(0, run.n);
    const ocv = run.ocv.subarray(0, run.n);

    const cV = css('viridis', 0.45);
    const cOcv = css('viridis', 0.05);

    plot.setOptions({
      xLabel: 'discharged capacity / A·h',
      yLabel: 'cell voltage / V',
      xScale: 'linear',
      yScale: 'linear',
      // a little headroom past the nominal-capacity marker for its label
      xRange: [0, Math.max(0.5, run.capacityNominal * 1.1)],
      yRange: [2.4, 4.3],
    });
    plot.draw(
      [
        ...(showOcv.checked
          ? [{ x: q, y: ocv, color: cOcv, dash: [5, 4], label: 'open circuit (surface)' }]
          : []),
        { x: q, y: v, color: cV, label: `terminal voltage, ${cRate.toFixed(2)}C`, width: 2 },
      ],
      [
        { type: 'hline', y: 2.5, dash: [2, 3], label: 'cut-off' },
        { type: 'vline', x: run.capacityNominal, dash: [2, 3], label: 'nominal' },
      ]
    );

    last = { 'discharged capacity / A h': q, 'terminal voltage / V': v, 'open-circuit voltage / V': ocv };

    if (firstFrame) {
      firstFrame = false;
      revealCanvas(shell, canvas);
    }
  });

  showOcv.addEventListener('input', draw);
  addEventListener('resize', draw);

  setupShell(shell, {
    refresh: draw,
    hold: () => plot.hold(`${pCrate.format()}C, ${pRadius.format()} µm, ${pT.format()} K`),
    clearHold: () => plot.clearHeld(),
    csv: () => columnsToCsv(Object.entries(last ?? {}).map(([name, values]) => ({ name, values }))),
  });

  enablePanel(shell);
  draw();
}
