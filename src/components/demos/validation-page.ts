import { Plot } from '../../lib/plot';
import { css } from '../../lib/colormaps';
import { gouyChapman, mmsConvergence, solvePNP } from '../../lib/pnp';
import { cottrellStep } from '../../lib/diffusion';
import { thermalVoltage } from '../../lib/constants';
import { impedance, omegaGrid, type CircuitParams } from '../../lib/eis';
import { computeDRT } from '../../lib/drt';

/**
 * Live computations for /validation/. Each block renders its plot and writes
 * its error metric into the page. Everything here runs in the visitor's
 * browser; nothing is prerecorded.
 */
export function initValidationPage(root: HTMLElement): void {
  const cNum = css('viridis', 0.45);
  const cNum2 = css('viridis', 0.75);
  const cRef = css('plasma', 0.55);
  const set = (id: string, text: string) => {
    const el = root.querySelector(`#${id}`);
    if (el) el.textContent = text;
  };

  // 1 — Gouy–Chapman
  {
    const canvas = root.querySelector<HTMLCanvasElement>('#vp-gc');
    if (canvas) {
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
    }
  }

  // 2 — Cottrell
  {
    const canvas = root.querySelector<HTMLCanvasElement>('#vp-cottrell');
    if (canvas) {
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
    }
  }

  // 3 — MMS convergence
  {
    const canvas = root.querySelector<HTMLCanvasElement>('#vp-mms');
    const tbody = root.querySelector<HTMLTableSectionElement>('#vp-mms-table');
    if (canvas && tbody) {
      const rows = mmsConvergence([21, 41, 81, 161, 321]);
      const orders: (number | null)[] = [null];
      for (let i = 1; i < rows.length; i++) {
        orders.push(Math.log(rows[i - 1].error / rows[i].error) / Math.log(rows[i - 1].h / rows[i].h));
      }
      tbody.innerHTML = rows
        .map(
          (r, i) =>
            `<tr><td class="num">${r.N}</td><td class="num">${r.h.toExponential(2)}</td><td class="num">${r.error.toExponential(3)}</td><td class="num">${orders[i] ? orders[i]!.toFixed(2) : '—'}</td></tr>`
        )
        .join('');
      const h = Float64Array.from(rows, (r) => r.h);
      const e = Float64Array.from(rows, (r) => r.error);
      const ref = Float64Array.from(h, (hi) => e[e.length - 1] * Math.pow(hi / h[h.length - 1], 2));
      new Plot(canvas, { xScale: 'log', yScale: 'log', xLabel: 'h', yLabel: 'L₂ error (ψ)', legend: 'tl' }).draw([
        { x: h, y: e, color: cNum, marker: 3, width: 1.75, label: 'measured' },
        { x: h, y: ref, color: cRef, dash: [5, 4], label: 'slope 2 reference' },
      ]);
      set('vp-mms-order', `observed order on the finest pair: ${orders[orders.length - 1]!.toFixed(2)}`);
    }
  }

  // 4 — Warburg 45°
  {
    const canvas = root.querySelector<HTMLCanvasElement>('#vp-warburg');
    if (canvas) {
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
    }
  }

  // 5 — DRT recovery of a known circuit
  {
    const canvas = root.querySelector<HTMLCanvasElement>('#vp-drt');
    if (canvas) {
      const p: CircuitParams = { Rohm: 10, Rct: 25, Cdl: 2e-5, Rd: 0, tauD: 1, Rsei: 0, Csei: 1e-4, age: 0 };
      const omega = omegaGrid(0.01, 1e5, 60);
      const Z = Array.from(omega, (w) => impedance(w, p));
      const drt = computeDRT(omega, Z, { nTau: 60, lambda: 1e-3 });
      let peakTau = 0;
      let peakVal = 0;
      let sum = 0;
      for (let k = 0; k < drt.tau.length; k++) {
        sum += drt.gamma[k];
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
        `Σγ = ${sum.toFixed(1)} Ω vs R_ct = ${p.Rct} Ω (${((100 * Math.abs(sum - p.Rct)) / p.Rct).toFixed(1)}% off); peak at τ = ${peakTau.toExponential(2)} s vs true ${tauTrue.toExponential(2)} s; R_∞ = ${drt.Rinf.toFixed(2)} Ω vs 10 Ω; misfit ${(drt.misfit * 100).toFixed(2)}%`
      );
    }
  }
}
