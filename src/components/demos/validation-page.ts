import { Plot } from '../../lib/plot';
import { css } from '../../lib/colormaps';
import { gouyChapman, mmsConvergence, solvePNP } from '../../lib/pnp';
import { cottrellStep } from '../../lib/diffusion';
import { thermalVoltage } from '../../lib/constants';
import { impedance, omegaGrid, type CircuitParams } from '../../lib/eis';
import { computeDRT } from '../../lib/drt';

/**
 * Live computations for /validation/. Each block renders its plot, writes its
 * error metric into the page, and returns a verdict. Everything here runs in
 * the visitor's browser; nothing is prerecorded.
 *
 * The tolerances below are the same ones the unit tests in tests/ assert, so
 * the summary at the top of the page cannot disagree with CI about whether a
 * check passes. If you loosen one here, loosen it there too — or the page will
 * claim green while the build is red.
 */

interface CheckResult {
  /** Short name, used in the summary when this check fails. */
  name: string;
  ok: boolean;
  /** Why it failed. Required when ok is false, unused otherwise. */
  reason?: string;
  /** Observed order of accuracy; only the MMS check reports one. */
  order?: number;
}

export function initValidationPage(root: HTMLElement): void {
  // Every plot on this page is one computed curve against one analytic
  // reference, so two colours is the whole palette it needs.
  const cNum = css('viridis', 0.45);
  const cRef = css('plasma', 0.55);
  const set = (id: string, text: string) => {
    const el = root.querySelector(`#${id}`);
    if (el) el.textContent = text;
  };

  const results: CheckResult[] = [];

  /**
   * Run one check. A check that throws, or whose canvas is missing, counts as
   * a failure rather than quietly vanishing from the tally — a summary that
   * omits what it could not run is worse than no summary.
   */
  const check = (name: string, fn: () => CheckResult | null) => {
    try {
      const r = fn();
      results.push(r ?? { name, ok: false, reason: 'did not run' });
    } catch (err) {
      results.push({ name, ok: false, reason: 'threw an error' });
      console.error(`[voltaire:validation] ${name}`, err);
    }
  };

  // 1 — Gouy–Chapman
  check('Gouy–Chapman', () => {
    const canvas = root.querySelector<HTMLCanvasElement>('#vp-gc');
    if (!canvas) return null;
    const T = 298.15;
    const Vapp = 0.1;
    const L = 60e-9;
    const sol = solvePNP({ L, c0: 100, epsR: 78.5, T, Vapp, N: 220 });
    const psi0 = Vapp / thermalVoltage(T);
    const gc = gouyChapman(sol.xHat, psi0, sol.lambdaD / L);
    let maxErr = 0;
    for (let i = 0; i < sol.xHat.length; i++) {
      if (sol.xHat[i] > 0.5) break;
      maxErr = Math.max(maxErr, Math.abs(sol.psi[i] - gc.psi[i]));
    }
    const xnm = Float64Array.from(sol.xHat, (v) => v * L * 1e9);
    const mV = 1000 * thermalVoltage(T);
    new Plot(canvas, { xLabel: 'x / nm', yLabel: 'φ / mV', xRange: [0, 10], legend: 'tr' }).draw([
      { x: xnm, y: Float64Array.from(sol.psi, (v) => v * mV), color: cNum, width: 2, label: 'PNP numeric (N=220)' },
      { x: xnm, y: Float64Array.from(gc.psi, (v) => v * mV), color: cRef, dash: [5, 4], label: 'Gouy–Chapman analytic' },
    ]);
    set('vp-gc-err', `max |ψ_num − ψ_GC| = ${(maxErr * 25.7).toFixed(3)} mV over the first half of the gap (${sol.newtonIterations} Newton iterations, ‖R‖ = ${sol.residualNorm.toExponential(1)})`);

    // tolerance: tests/physics.test.ts — maxErr < 2% of ψ₀, and Newton converged
    if (!sol.converged) return { name: 'Gouy–Chapman', ok: false, reason: 'Newton did not converge' };
    const rel = maxErr / psi0;
    return rel < 0.02
      ? { name: 'Gouy–Chapman', ok: true }
      : { name: 'Gouy–Chapman', ok: false, reason: `profile error ${(rel * 100).toFixed(1)}% of ψ₀, tolerance 2%` };
  });

  // 2 — Cottrell
  check('Cottrell step', () => {
    const canvas = root.querySelector<HTMLCanvasElement>('#vp-cottrell');
    if (!canvas) return null;
    const run = cottrellStep({ D: 1e-9, cStar: 1, A: 1e-4, nElectrons: 1, L: 400e-6, N: 600, tEnd: 5, nSteps: 300 });
    let worst = 0;
    for (let k = 0; k < run.t.length; k++) {
      if (run.t[k] < 0.05 || run.t[k] > 2) continue;
      worst = Math.max(worst, Math.abs(run.i[k] - run.iCottrell[k]) / run.iCottrell[k]);
    }
    new Plot(canvas, { xScale: 'log', yScale: 'log', xLabel: 't / s', yLabel: 'i / A', legend: 'tr' }).draw([
      { x: run.t, y: run.i, color: cNum, width: 2, label: 'implicit Euler FD' },
      { x: run.t, y: run.iCottrell, color: cRef, dash: [5, 4], label: 'i = nFAc*√(D/πt)' },
    ]);
    set('vp-cottrell-err', `max relative error ${(worst * 100).toFixed(2)}% for 0.05 s ≤ t ≤ 2 s (early points carry step-response discretisation error; late points feel the far wall)`);

    // tolerance: tests/physics.test.ts — under 2% across the same time window
    return worst < 0.02
      ? { name: 'Cottrell step', ok: true }
      : { name: 'Cottrell step', ok: false, reason: `max error ${(worst * 100).toFixed(1)}%, tolerance 2%` };
  });

  // 3 — MMS convergence
  check('Manufactured solutions', () => {
    const canvas = root.querySelector<HTMLCanvasElement>('#vp-mms');
    const tbody = root.querySelector<HTMLTableSectionElement>('#vp-mms-table');
    if (!canvas || !tbody) return null;
    const Ns = [21, 41, 81, 161, 321];
    // Two configurations: the smooth uniform case, and the graded mesh at the
    // epsHat a shipped demo actually runs, so the page reports the scheme where
    // it lives rather than only where it is easiest to measure.
    const cases = [
      { label: 'uniform', rows: mmsConvergence(Ns), color: cNum },
      { label: 'graded r=1.0084, ε̂=2.6e-4', rows: mmsConvergence(Ns, { ratio: 1.0084, epsHat: 2.571e-4 }), color: cRef },
    ];
    const orderPairs = cases.map((c) => {
      const o: (number | null)[] = [null];
      for (let i = 1; i < c.rows.length; i++) {
        o.push(Math.log(c.rows[i - 1].error / c.rows[i].error) / Math.log(c.rows[i - 1].h / c.rows[i].h));
      }
      return o;
    });
    tbody.innerHTML = cases
      .map((c, ci) =>
        c.rows
          .map(
            (r, i) =>
              `<tr><td>${i === 0 ? c.label : ''}</td><td class="num">${r.N}</td><td class="num">${r.h.toExponential(2)}</td><td class="num">${r.error.toExponential(3)}</td><td class="num">${orderPairs[ci][i] ? orderPairs[ci][i]!.toFixed(2) : '—'}</td></tr>`
          )
          .join('')
      )
      .join('');
    const series = cases.map((c) => ({
      x: Float64Array.from(c.rows, (r) => r.h),
      y: Float64Array.from(c.rows, (r) => r.error),
      color: c.color,
      marker: 3,
      width: 1.75,
      label: c.label,
    }));
    const h0 = series[0].x;
    const e0 = series[0].y;
    const ref = Float64Array.from(h0, (hi) => e0[e0.length - 1] * Math.pow(hi / h0[h0.length - 1], 2));
    new Plot(canvas, { xScale: 'log', yScale: 'log', xLabel: 'h_max', yLabel: 'mesh-weighted L₂ error (ψ)', legend: 'tl' }).draw([
      ...series,
      { x: h0, y: ref, color: cRef, dash: [5, 4], label: 'slope 2 reference' },
    ]);
    const finest = orderPairs[0][orderPairs[0].length - 1]!;
    const finestGraded = orderPairs[1][orderPairs[1].length - 1]!;
    set(
      'vp-mms-order',
      `observed order on the finest pair: ${finest.toFixed(2)} uniform, ${finestGraded.toFixed(2)} graded. Both are measured against the largest cell in the mesh and a mesh-weighted norm; measuring against 1/(N−1) and an unweighted norm makes the graded case appear to fall below first order, which is an artefact of those two choices and not a property of the scheme.`
    );

    // tolerance: tests/physics.test.ts — finest observed order in [1.8, 2.4]
    const bad = [finest, finestGraded].filter((o) => !(o > 1.8 && o < 2.4));
    return bad.length === 0
      ? { name: 'Manufactured solutions', ok: true, order: finest }
      : { name: 'Manufactured solutions', ok: false, order: finest, reason: `observed order ${bad.map((o) => o.toFixed(2)).join(' and ')}, expected between 1.8 and 2.4` };
  });

  // 4 — Warburg 45°
  check('Warburg 45° limit', () => {
    const canvas = root.querySelector<HTMLCanvasElement>('#vp-warburg');
    if (!canvas) return null;
    const p: CircuitParams = { Rohm: 0, Rct: 1e-9, Cdl: 1e-12, Rd: 50, tauD: 2, Rsei: 0, Csei: 1e-4, age: 0 };
    const omega = omegaGrid(0.05, 2000, 90);
    const re: number[] = [];
    const im: number[] = [];
    for (const w of omega) {
      const z = impedance(w, p);
      re.push(z.re);
      im.push(-z.im);
    }
    // measure the high-frequency phase angle
    const zHi = impedance(400 / p.tauD, p);
    const angle = (Math.atan2(-zHi.im, zHi.re) * 180) / Math.PI;
    const lim = Math.max(...re) * 0.55;
    new Plot(canvas, {
      equalAspect: true,
      xLabel: "Z' / Ω", yLabel: "−Z'' / Ω",
      xRange: [0, lim], yRange: [0, lim],
      legend: 'tl',
    }).draw(
      [
        { x: Float64Array.from(re), y: Float64Array.from(im), color: cNum, width: 2, label: 'finite-length Warburg' },
        { x: Float64Array.from([0, lim]), y: Float64Array.from([0, lim]), color: cRef, dash: [5, 4], width: 1, label: '45° line' },
      ]
    );
    set('vp-warburg-err', `phase at ω ≫ 1/τ_d: ${angle.toFixed(2)}° (semi-infinite limit: 45°)`);

    // tolerance: tests/physics.test.ts — phase within 40°–50° deep in the semi-infinite regime
    return angle > 40 && angle < 50
      ? { name: 'Warburg 45° limit', ok: true }
      : { name: 'Warburg 45° limit', ok: false, reason: `phase ${angle.toFixed(1)}°, expected between 40° and 50°` };
  });

  // 5 — DRT recovery of a known circuit
  check('DRT recovery', () => {
    const canvas = root.querySelector<HTMLCanvasElement>('#vp-drt');
    if (!canvas) return null;
    const p: CircuitParams = { Rohm: 10, Rct: 25, Cdl: 2e-5, Rd: 0, tauD: 1, Rsei: 0, Csei: 1e-4, age: 0 };
    const omega = omegaGrid(0.01, 1e5, 60);
    const Z = Array.from(omega, (w) => impedance(w, p));
    const drt = computeDRT(omega, Z, { nTau: 60, lambda: 1e-3 });
    let peakTau = 0;
    let peakVal = 0;
    // gamma is a density in ln τ, so the resistance is the integral, not the sum
    let area = 0;
    for (let k = 0; k < drt.tau.length; k++) {
      area += drt.gamma[k] * drt.dlnTau;
      if (drt.gamma[k] > peakVal) {
        peakVal = drt.gamma[k];
        peakTau = drt.tau[k];
      }
    }
    const tauTrue = p.Rct * p.Cdl;
    new Plot(canvas, { xScale: 'log', xLabel: 'τ / s', yLabel: 'γ(τ) / Ω', legend: 'tr' }).draw(
      [{ x: drt.tau, y: drt.gamma, color: cNum, width: 2, fill: true, label: 'recovered γ(τ)' }],
      [{ type: 'vline', x: tauTrue, color: cRef, dash: [5, 4], label: 'true τ = RC' }]
    );
    set(
      'vp-drt-err',
      `∫γ dlnτ = ${area.toFixed(1)} Ω vs R_ct = ${p.Rct} Ω (${((100 * Math.abs(area - p.Rct)) / p.Rct).toFixed(1)}% off); peak at τ = ${peakTau.toExponential(2)} s vs true ${tauTrue.toExponential(2)} s; R_∞ = ${drt.Rinf.toFixed(2)} Ω vs 10 Ω; misfit ${(drt.misfit * 100).toFixed(2)}%`
    );

    // tolerances: tests/physics.test.ts — misfit under 2%, ∫γ dlnτ within 10% of
    // R_ct, and the peak within 0.35 decades of the true RC time constant
    const areaOff = Math.abs(area - p.Rct) / p.Rct;
    const decades = Math.abs(Math.log10(peakTau / tauTrue));
    if (drt.misfit >= 0.02) return { name: 'DRT recovery', ok: false, reason: `misfit ${(drt.misfit * 100).toFixed(1)}%, tolerance 2%` };
    if (areaOff >= 0.1) return { name: 'DRT recovery', ok: false, reason: `∫γ dlnτ off by ${(areaOff * 100).toFixed(1)}%, tolerance 10%` };
    if (decades >= 0.35) return { name: 'DRT recovery', ok: false, reason: `peak off by ${decades.toFixed(2)} decades, tolerance 0.35` };
    return { name: 'DRT recovery', ok: true };
  });

  renderSummary(root, results);
}

/**
 * Write the tally at the top of the page. Never omits a check: anything that
 * failed, threw, or did not run is named here.
 */
function renderSummary(root: HTMLElement, results: CheckResult[]): void {
  const box = root.querySelector<HTMLElement>('#vp-summary');
  const text = root.querySelector<HTMLElement>('#vp-summary-text');
  if (!box || !text) return;

  const failed = results.filter((r) => !r.ok);
  const passed = results.length - failed.length;
  const order = results.find((r) => r.order !== undefined)?.order;

  const parts: string[] = [`${passed} / ${results.length} live checks passing.`];

  if (failed.length > 0) {
    parts.push(
      `FAILING: ${failed.map((f) => `${f.name} — ${f.reason ?? 'no reason recorded'}`).join('; ')}.`
    );
  }

  // The order is the page's headline number, so report it either way; a check
  // that failed on its order still has an order worth showing.
  if (order !== undefined && isFinite(order)) {
    parts.push(`Observed order of accuracy ${order.toFixed(2)} against a design claim of 2.`);
  } else {
    parts.push('Observed order of accuracy unavailable — the convergence check did not report one.');
  }

  parts.push(
    'Computed in your browser on this page load, at the same tolerances the unit tests use. Two further benchmarks below have not been run.'
  );

  text.textContent = parts.join(' ');
  box.dataset.state = failed.length === 0 ? 'pass' : 'fail';
}
