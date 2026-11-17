import { Plot, formatValue, type Annotation } from '../../lib/plot';
import { css } from '../../lib/colormaps';
import { columnsToCsv } from '../../lib/csv';
import { addNoise, impedance, omegaGrid } from '../../lib/eis';
import { computeDRT, drtPeaks, lambdaSweep, suggestLambda, type DRTPeak, type DRTResult } from '../../lib/drt';
import {
  EIS_HANDOFF_KEY,
  EisParseError,
  dropPoints,
  inductivePoints,
  parseEis,
  type EisColumns,
  type EisData,
  type EisParse,
} from '../../lib/eisdata';
import { mulberry32 } from '../../lib/microstructure';
import {
  bindParam,
  captureCanvases,
  downloadBlob,
  downloadText,
  enablePanel,
  rafDebounce,
  setupShell,
  siFormat,
  type Shell,
} from '../demos/runtime';

/** λ values tried by the stability sweep: four per decade over 10⁻⁴…1. */
const SWEEP = Array.from({ length: 17 }, (_, i) => Math.pow(10, -4 + i / 4));

/**
 * What the page opens on: a synthetic cell, so the format is visible and the
 * plots are not empty. Stated as synthetic wherever it is shown.
 */
function exampleText(): string {
  const omega = omegaGrid(0.01, 1e5, 50);
  const Z = addNoise(
    Array.from(omega, (w) =>
      impedance(w, { Rohm: 10, Rct: 25, Cdl: 2e-5, Rd: 30, tauD: 2, Rsei: 15, Csei: 2e-3, age: 1.5 })
    ),
    0.005,
    mulberry32(20260816)
  );
  return columnsToCsv([
    { name: 'f / Hz', values: Array.from(omega, (w) => +(w / (2 * Math.PI)).toPrecision(6)) },
    { name: 'Zre / ohm', values: Z.map((z) => +z.re.toPrecision(6)) },
    { name: 'Zim / ohm', values: Z.map((z) => +z.im.toPrecision(6)) },
  ]);
}

export function init(shell: Shell, page: HTMLElement): void {
  const $ = <T extends HTMLElement>(sel: string) => page.querySelector<T>(sel)!;
  const input = $<HTMLTextAreaElement>('#eis-input');
  const file = $<HTMLInputElement>('#eis-file');
  const exampleBtn = $<HTMLButtonElement>('#eis-example');
  const clearBtn = $<HTMLButtonElement>('#eis-clear');
  const status = $<HTMLElement>('#eis-status');
  const source = $<HTMLElement>('#eis-source');
  const colFreq = $<HTMLSelectElement>('#eis-col-f');
  const colRe = $<HTMLSelectElement>('#eis-col-re');
  const colIm = $<HTMLSelectElement>('#eis-col-im');
  const negated = $<HTMLInputElement>('#eis-negated');
  const dropInductive = $<HTMLInputElement>('#eis-drop-inductive');
  const peakBody = $<HTMLTableSectionElement>('#eis-peaks');
  const summary = $<HTMLElement>('#eis-summary');
  const suggestBtn = $<HTMLButtonElement>('#eis-suggest');
  const suggestOut = $<HTMLElement>('#eis-suggest-out');
  const exportPeaks = $<HTMLButtonElement>('#eis-export-peaks');
  const sweepStage = $<HTMLElement>('#eis-sweep-stage');
  const sweepPng = $<HTMLButtonElement>('#eis-sweep-png');

  const grid = document.createElement('div');
  grid.className = 'd4-grid';
  grid.innerHTML = `
    <div class="d4-cell d4-nyquist"><canvas role="img" aria-label="Nyquist plot of the loaded spectrum with the DRT reconstruction overlaid, equal axis scaling"></canvas></div>
    <div class="d4-cell"><canvas role="img" aria-label="Bode magnitude of the loaded spectrum"></canvas></div>
    <div class="d4-cell"><canvas role="img" aria-label="Bode phase of the loaded spectrum"></canvas></div>
    <div class="d4-cell"><canvas role="img" aria-label="Distribution of relaxation times recovered from the loaded spectrum, with its peaks numbered"></canvas></div>`;
  shell.stage.insertBefore(grid, shell.stage.firstChild);
  const [cvNyq, cvMag, cvPhase, cvDrt] = [...grid.querySelectorAll('canvas')];
  const pNyq = new Plot(cvNyq, { equalAspect: true, hover: 'nearest', xLabel: 'Z′ / Ω', yLabel: '−Z″ / Ω' });
  const pMag = new Plot(cvMag, { xScale: 'log', yScale: 'log', xLabel: 'f / Hz', yLabel: '|Z| / Ω' });
  const pPhase = new Plot(cvPhase, { xScale: 'log', xLabel: 'f / Hz', yLabel: '−φ / °' });
  const pDrt = new Plot(cvDrt, { xScale: 'log', xLabel: 'τ / s', yLabel: 'γ / Ω' });

  sweepStage.innerHTML = `
    <div><canvas role="img" aria-label="Relative misfit of the DRT reconstruction against the regularisation strength"></canvas></div>
    <div><canvas role="img" aria-label="Number of DRT peaks found against the regularisation strength"></canvas></div>`;
  const [cvMisfit, cvCount] = [...sweepStage.querySelectorAll('canvas')];
  const pMisfit = new Plot(cvMisfit, { xScale: 'log', yScale: 'log', xLabel: 'λ', yLabel: 'misfit / %' });
  const pCount = new Plot(cvCount, { xScale: 'log', xLabel: 'λ', yLabel: 'peaks found', pad: 0.15 });

  const cData = css('viridis', 0.45);
  const cFit = css('plasma', 0.55);
  const cDropped = css('viridis', 0.92);

  let parsed: EisParse | null = null;
  let used: EisData | null = null;
  let dropped: number[] = [];
  let drt: DRTResult | null = null;
  let peaks: DRTPeak[] = [];
  let sweep: ReturnType<typeof lambdaSweep> = [];
  /** Set when the user picks columns by hand; cleared when new text arrives. */
  let override: Partial<EisColumns> | undefined;

  const rerun = () => analyse();
  const pLambda = bindParam(shell, 'eis-lambda', rerun);
  const pTau = bindParam(shell, 'eis-ntau', () => {
    analyse();
    runSweep();
  });

  const say = (text: string, bad = false) => {
    status.textContent = text;
    status.toggleAttribute('data-bad', bad);
  };

  function fillColumnPickers(p: EisParse): void {
    for (const sel of [colFreq, colRe, colIm]) {
      sel.innerHTML = '';
      for (let i = 0; i < p.nColumns; i++) {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = p.header?.[i] ? `${i + 1}: ${p.header[i]}` : `column ${i + 1}`;
        sel.appendChild(opt);
      }
    }
    colFreq.value = String(p.columns.freq);
    colRe.value = String(p.columns.re);
    colIm.value = String(p.columns.im);
    negated.checked = p.columns.imNegated;
  }

  /** Text -> spectrum. Returns false, with the reason shown, if it cannot be read. */
  function load(): boolean {
    const text = input.value;
    if (text.trim() === '') {
      parsed = null;
      used = null;
      say('Paste a spectrum above, drop a file on the box, or load the example.');
      return false;
    }
    try {
      parsed = parseEis(text, override);
    } catch (err) {
      parsed = null;
      used = null;
      say(err instanceof EisParseError ? err.message : 'That could not be read as impedance data.', true);
      return false;
    }
    fillColumnPickers(parsed);
    return true;
  }

  const analyse = rafDebounce(() => {
    if (!parsed) {
      drawEmpty();
      return;
    }
    const inductive = inductivePoints(parsed.data.Z);
    dropped = dropInductive.checked ? inductive : [];
    used = dropped.length > 0 ? dropPoints(parsed.data, dropped) : parsed.data;
    if (used.freq.length < 3) {
      say('Fewer than three usable points remain after excluding the inductive ones.', true);
      drawEmpty();
      return;
    }
    drt = computeDRT(used.omega, used.Z, { nTau: pTau.value, lambda: pLambda.value });
    peaks = drtPeaks(drt, used.omega);

    const notes = [...parsed.notes];
    if (inductive.length > 0) {
      notes.push(
        dropInductive.checked
          ? `${inductive.length} inductive point${inductive.length === 1 ? '' : 's'} (Im Z > 0) excluded from the fit.`
          : `${inductive.length} point${inductive.length === 1 ? ' has' : 's have'} Im Z > 0, which this model cannot represent; they are in the fit and will bias it.`
      );
    }
    const fLo = used.freq[0];
    const fHi = used.freq[used.freq.length - 1];
    say(
      `${used.freq.length} points from ${siFormat(fLo, 'Hz')} to ${siFormat(fHi, 'Hz')}.` +
        (notes.length ? ' ' + notes.join(' ') : '')
    );
    draw();
    renderTable();
  });

  function drawEmpty(): void {
    drt = null;
    peaks = [];
    for (const p of [pNyq, pMag, pPhase, pDrt]) p.draw([]);
    peakBody.innerHTML = '<tr><td colspan="6">No spectrum loaded.</td></tr>';
    summary.textContent = '';
  }

  function draw(): void {
    if (!used || !drt || !parsed) return;
    const re = Float64Array.from(used.Z, (z) => z.re);
    const negIm = Float64Array.from(used.Z, (z) => -z.im);
    const n = used.freq.length;
    const fitRe = new Float64Array(n);
    const fitNegIm = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let a = drt.Rinf;
      let b = 0;
      for (let k = 0; k < drt.tau.length; k++) {
        const wt = used.omega[i] * drt.tau[k];
        // gamma is a density in ln τ, so the measure goes back in here
        const g = (drt.gamma[k] * drt.dlnTau) / (1 + wt * wt);
        a += g;
        b += g * wt;
      }
      fitRe[i] = a;
      fitNegIm[i] = b;
    }
    const excluded = dropped.map((i) => parsed!.data.Z[i]);
    pNyq.draw([
      { x: re, y: negIm, color: cData, marker: 2.5, width: 0, label: 'data' },
      { x: fitRe, y: fitNegIm, color: cFit, dash: [4, 3], width: 1.5, label: 'DRT fit' },
      ...(excluded.length
        ? [
            {
              x: excluded.map((z) => z.re),
              y: excluded.map((z) => -z.im),
              color: cDropped,
              marker: 2.5,
              width: 0,
              label: 'excluded',
            },
          ]
        : []),
    ]);
    const mag = Float64Array.from(used.Z, (z) => Math.hypot(z.re, z.im));
    const phase = Float64Array.from(used.Z, (z) => (-Math.atan2(z.im, z.re) * 180) / Math.PI);
    const fitMag = Float64Array.from(fitRe, (v, i) => Math.hypot(v, fitNegIm[i]));
    const fitPhase = Float64Array.from(fitRe, (v, i) => (Math.atan2(fitNegIm[i], v) * 180) / Math.PI);
    pMag.draw([
      { x: used.freq, y: mag, color: cData, marker: 2, width: 0, label: 'data' },
      { x: used.freq, y: fitMag, color: cFit, dash: [4, 3], width: 1.5, label: 'DRT fit' },
    ]);
    pPhase.draw([
      { x: used.freq, y: phase, color: cData, marker: 2, width: 0, label: 'data' },
      { x: used.freq, y: fitPhase, color: cFit, dash: [4, 3], width: 1.5, label: 'DRT fit' },
    ]);

    // the τ grid runs a decade past the data at each end; mark where measurement stops
    const wMax = used.omega[n - 1];
    const wMin = used.omega[0];
    const marks: Annotation[] = [
      { type: 'vline', x: 1 / wMax, dash: [2, 3] },
      { type: 'vline', x: 1 / wMin, dash: [2, 3] },
      ...peaks.map((p, i): Annotation => ({ type: 'vline', x: p.tau, color: cFit, dash: [1, 3], label: String(i + 1) })),
    ];
    pDrt.draw([{ x: drt.tau, y: drt.gamma, color: cFit, width: 1.75, fill: true }], marks);
  }

  function renderTable(): void {
    if (!drt || !used) return;
    const total = peaks.reduce((s, p) => s + p.resistance, 0);
    peakBody.innerHTML = '';
    if (peaks.length === 0) {
      peakBody.innerHTML = '<tr><td colspan="6">No peak found: the spectrum is flat at this λ.</td></tr>';
    }
    peaks.forEach((p, i) => {
      const tr = document.createElement('tr');
      const cells = [
        String(i + 1),
        siFormat(p.tau, 's'),
        siFormat(p.freq, 'Hz'),
        `${formatValue(p.resistance)} Ω`,
        siFormat(p.capacitance, 'F'),
        `${total > 0 ? ((100 * p.resistance) / total).toFixed(0) : '0'}%${p.outsideWindow ? ' · outside the measured window' : ''}`,
      ];
      cells.forEach((text, k) => {
        const td = document.createElement('td');
        td.textContent = text;
        if (k > 0 && k < 5) td.className = 'num';
        tr.appendChild(td);
      });
      if (p.outsideWindow) tr.className = 'is-extrapolated';
      peakBody.appendChild(tr);
    });
    summary.textContent =
      `R∞ = ${formatValue(drt.Rinf)} Ω · polarisation resistance Σ R = ${formatValue(total)} Ω · ` +
      `total ${formatValue(drt.Rinf + total)} Ω · misfit ${(drt.misfit * 100).toFixed(2)}% at λ = ${pLambda.format()}, ${pTau.format()} τ bins`;
  }

  /** The stability sweep is 17 inversions, so it runs off the main interaction path. */
  let sweepTimer = 0;
  function runSweep(): void {
    clearTimeout(sweepTimer);
    sweepTimer = window.setTimeout(() => {
      if (!used) {
        sweep = [];
        pMisfit.draw([]);
        pCount.draw([]);
        suggestOut.textContent = '';
        return;
      }
      sweep = lambdaSweep(used.omega, used.Z, SWEEP, { nTau: pTau.value });
      drawSweep();
    }, 60);
  }

  function drawSweep(): void {
    if (sweep.length === 0) return;
    const mark: Annotation[] = [{ type: 'vline', x: pLambda.value, dash: [3, 3], label: 'current λ' }];
    const lam = sweep.map((r) => r.lambda);
    pMisfit.draw([{ x: lam, y: sweep.map((r) => r.misfit * 100), color: cData, marker: 2.5, width: 1.5 }], mark);
    pCount.draw([{ x: lam, y: sweep.map((r) => r.peaks), color: cFit, marker: 2.5, width: 1.5 }], mark);
    const s = suggestLambda(sweep);
    suggestBtn.disabled = s === null;
    suggestOut.textContent =
      s === null
        ? 'No stable range found in this sweep.'
        : `Longest run with a constant peak count is centred on λ ≈ ${formatValue(s)}.`;
    suggestBtn.dataset.lambda = s === null ? '' : String(s);
  }

  const reload = (resetColumns: boolean) => {
    if (resetColumns) override = undefined;
    load();
    analyse();
    runSweep();
  };

  input.addEventListener('input', () => {
    source.textContent = 'pasted data';
    reload(true);
  });
  const readFile = (f: File) => {
    f.text().then((text) => {
      input.value = text;
      source.textContent = f.name;
      reload(true);
    });
  };
  file.addEventListener('change', () => {
    if (file.files?.[0]) readFile(file.files[0]);
  });
  input.addEventListener('dragover', (e) => {
    e.preventDefault();
    input.setAttribute('data-drop', '');
  });
  input.addEventListener('dragleave', () => input.removeAttribute('data-drop'));
  input.addEventListener('drop', (e) => {
    e.preventDefault();
    input.removeAttribute('data-drop');
    const f = e.dataTransfer?.files?.[0];
    if (f) readFile(f);
  });
  exampleBtn.addEventListener('click', () => {
    input.value = exampleText();
    source.textContent = 'built-in example: a synthetic cell, not a measurement';
    reload(true);
  });
  clearBtn.addEventListener('click', () => {
    input.value = '';
    source.textContent = '';
    reload(true);
  });
  const pickColumns = () => {
    override = {
      freq: Number(colFreq.value),
      re: Number(colRe.value),
      im: Number(colIm.value),
      imNegated: negated.checked,
    };
    reload(false);
  };
  for (const el of [colFreq, colRe, colIm, negated]) el.addEventListener('change', pickColumns);
  dropInductive.addEventListener('change', () => {
    analyse();
    runSweep();
  });
  suggestBtn.addEventListener('click', () => {
    const s = Number(suggestBtn.dataset.lambda);
    if (!(s > 0)) return;
    pLambda.value = s;
    analyse();
    drawSweep();
  });
  // keep the "current λ" marker on the sweep plots in step with the slider
  pLambda.slider.addEventListener('input', drawSweep);
  pLambda.number?.addEventListener('change', drawSweep);

  exportPeaks.addEventListener('click', () => {
    if (!drt) return;
    downloadText(
      'voltaire-drt-peaks.csv',
      columnsToCsv([
        { name: 'peak', values: peaks.map((_, i) => i + 1) },
        { name: 'tau / s', values: peaks.map((p) => p.tau) },
        { name: 'f / Hz', values: peaks.map((p) => p.freq) },
        { name: 'R / ohm', values: peaks.map((p) => p.resistance) },
        { name: 'C / F', values: peaks.map((p) => p.capacitance) },
        { name: 'outside measured window', values: peaks.map((p) => (p.outsideWindow ? 'yes' : 'no')) },
        { name: 'R_inf / ohm', values: [drt.Rinf] },
        { name: 'lambda', values: [pLambda.value] },
        { name: 'tau bins', values: [pTau.value] },
        { name: 'misfit', values: [drt.misfit] },
      ])
    );
  });
  sweepPng.addEventListener('click', async () => {
    const blob = await captureCanvases(sweepStage);
    if (blob) downloadBlob('voltaire-drt-lambda-sweep.png', blob);
  });

  addEventListener('resize', () => {
    draw();
    drawSweep();
  });

  setupShell(shell, {
    refresh: () => {
      analyse();
      drawSweep();
    },
    csv: () =>
      columnsToCsv([
        { name: 'f / Hz', values: used?.freq ?? [] },
        { name: 'Zre / ohm', values: used?.Z.map((z) => z.re) ?? [] },
        { name: 'Zim / ohm', values: used?.Z.map((z) => z.im) ?? [] },
        { name: 'tau / s', values: drt?.tau ?? [] },
        { name: 'gamma (density in ln tau) / ohm', values: drt?.gamma ?? [] },
      ]),
  });
  // A link can carry λ and the bin count but not the spectrum, so offering
  // "copy link" here would promise something it cannot deliver.
  const linkBtn = shell.root.querySelector<HTMLButtonElement>('[data-action="link"]');
  if (linkBtn) linkBtn.hidden = true;

  // start from a spectrum handed over by the impedance demo, else the example
  let handed: string | null = null;
  try {
    handed = sessionStorage.getItem(EIS_HANDOFF_KEY);
    sessionStorage.removeItem(EIS_HANDOFF_KEY);
  } catch {
    // storage unavailable: fall through to the example
  }
  if (handed) {
    input.value = handed;
    source.textContent = 'spectrum from the impedance demo (synthetic)';
  } else {
    input.value = exampleText();
    source.textContent = 'built-in example: a synthetic cell, not a measurement';
  }

  shell.stage.querySelector('img.poster')?.remove();
  enablePanel(shell);
  reload(true);
}
