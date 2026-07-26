import { PF_DEFAULTS, type PFParams } from '../../lib/phasefield';
import { createEngine } from './pf-engine';
import {
  createCanvas,
  enablePanel,
  Loop,
  prefersReducedMotion,
  revealCanvas,
  showMessage,
  sliderToLog,
  type Shell,
} from './runtime';

export function init(shell: Shell): void {
  const $ = <T extends HTMLElement>(sel: string) => shell.root.querySelector<T>(sel)!;
  const etaSlider = $<HTMLInputElement>('#d3-eta');
  const deltaSlider = $<HTMLInputElement>('#d3-delta');
  const omegaInputs = shell.root.querySelectorAll<HTMLInputElement>('input[name="d3-omega"]');
  const morphSlider = $<HTMLInputElement>('#d3-morph');
  const tSlider = $<HTMLInputElement>('#d3-T');
  const nucSlider = $<HTMLInputElement>('#d3-nuc');
  const showC = $<HTMLInputElement>('#d3-showc');
  const pauseBtn = $<HTMLButtonElement>('#d3-pause');
  const resetBtn = $<HTMLButtonElement>('#d3-reset');
  const outs = {
    eta: $<HTMLOutputElement>('#d3-eta-out'),
    delta: $<HTMLOutputElement>('#d3-delta-out'),
    morph: $<HTMLOutputElement>('#d3-morph-out'),
    T: $<HTMLOutputElement>('#d3-T-out'),
    nuc: $<HTMLOutputElement>('#d3-nuc-out'),
    solid: $<HTMLOutputElement>('#d3-solid'),
    rough: $<HTMLOutputElement>('#d3-rough'),
    rate: $<HTMLOutputElement>('#d3-rate'),
    backend: $<HTMLOutputElement>('#d3-backend'),
  };

  const canvas = createCanvas(
    shell,
    'Metal dendrites growing upward from a flat electrode, rendered with the viridis colormap; branch shape responds to the anisotropy and overpotential controls'
  );
  const engine = createEngine(canvas, [448, 252], [192, 108]);
  if (!engine) {
    showMessage(
      shell,
      'Neither WebGL2 nor 2D canvas is available here, so the live model cannot run. The poster shows a frame computed with identical physics.'
    );
    return;
  }
  outs.backend.value = engine.info.backend === 'webgl2' ? `WebGL2 ${engine.info.nx}×${engine.info.ny}` : `CPU ${engine.info.nx}×${engine.info.ny}`;

  const params: PFParams = { ...PF_DEFAULTS };
  let steps = 0;
  let stepStamp = performance.now();
  let stepsAtStamp = 0;

  const readControls = () => {
    const etaA = -Number(etaSlider.value) / 10; // slider 20..80 -> -2..-8
    const T = Number(tSlider.value);
    params.etaA = etaA * (298 / T); // aη = Fη/RT: colder means a larger argument
    const omega = [...omegaInputs].find((r) => r.checked)?.value === '6' ? 6 : 4;
    params.omegaMode = omega;
    const deltaMax = omega === 6 ? 0.028 : 0.06; // keeps κ + κ'' > 0 (well-posed)
    params.delta = (Number(deltaSlider.value) / 100) * deltaMax;
    params.Leta = sliderToLog(Number(morphSlider.value), 0.01, 0.15);
    // higher drive needs the sharper-interface regime found in tuning
    const drive01 = Number(morphSlider.value) / 100;
    params.W = 1.2 - 0.4 * drive01;
    params.kappa0 = 0.9 - 0.25 * drive01;
    params.noise = 0.1 + 0.25 * drive01;
    params.D = 0.8;
    params.lambdaC = 3.0 + drive01;
    params.dt = 0.045;

    // report both the nondimensional argument and the equivalent mV at T
    const mV = params.etaA * ((8.314462618 * T) / 96485.33212) * 1000;
    outs.eta.value = `aη=${params.etaA.toFixed(1)} (${mV.toFixed(0)} mV)`;
    outs.delta.value = params.delta.toFixed(3);
    outs.morph.value =
      drive01 < 0.33 ? `mossy (L_η=${params.Leta.toFixed(3)})` : drive01 < 0.7 ? `needle (L_η=${params.Leta.toFixed(3)})` : `dendritic (L_η=${params.Leta.toFixed(3)})`;
    outs.T.value = `${T} K`;
    outs.nuc.value = nucSlider.value;
  };

  const loop = new Loop(shell.stage, () => {
    const sub = engine.info.backend === 'webgl2' ? 10 : 4;
    engine.step(params, sub);
    steps += sub;
    engine.render(showC.checked);
    if (steps - stepsAtStamp >= 200) {
      const now = performance.now();
      outs.rate.value = `${Math.round(((steps - stepsAtStamp) / (now - stepStamp)) * 1000)} steps/s`;
      stepStamp = now;
      stepsAtStamp = steps;
      const m = engine.metrics();
      outs.solid.value = `${(m.solidFraction * 100).toFixed(1)}%`;
      outs.rough.value = m.roughness.toFixed(2);
    }
  });

  const setPaused = (paused: boolean) => {
    if (paused) {
      loop.stop();
      pauseBtn.textContent = 'run';
      pauseBtn.setAttribute('aria-pressed', 'true');
    } else {
      loop.start();
      pauseBtn.textContent = 'pause';
      pauseBtn.setAttribute('aria-pressed', 'false');
    }
  };

  pauseBtn.addEventListener('click', () => setPaused(loop.active));
  resetBtn.addEventListener('click', () => {
    engine.seed(Number(nucSlider.value));
    steps = 0;
    stepsAtStamp = 0;
    stepStamp = performance.now();
    engine.render(showC.checked);
  });
  for (const el of [etaSlider, deltaSlider, morphSlider, tSlider, nucSlider]) {
    el.addEventListener('input', readControls);
  }
  omegaInputs.forEach((r) => r.addEventListener('change', readControls));
  showC.addEventListener('change', () => engine.render(showC.checked));
  addEventListener('pagehide', () => {
    loop.dispose();
    engine.dispose();
  });

  readControls();
  engine.seed(Number(nucSlider.value));
  engine.render(showC.checked);
  revealCanvas(shell, canvas);
  enablePanel(shell);
  // reduced motion: start paused on a seeded frame; the run button still works
  setPaused(prefersReducedMotion());
}
