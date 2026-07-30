import { PF_DEFAULTS, type PFParams } from '../../lib/phasefield';
import { F, R as Rgas } from '../../lib/constants';
import { createEngine } from './pf-engine';
import {
  bindParam,
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
  const omegaInputs = shell.root.querySelectorAll<HTMLInputElement>('input[name="d3-omega"]');
  const morphSlider = $<HTMLInputElement>('#d3-morph');
  const showC = $<HTMLInputElement>('#d3-showc');
  const pauseBtn = $<HTMLButtonElement>('#d3-pause');
  const resetBtn = $<HTMLButtonElement>('#d3-reset');
  const outs = {
    morph: $<HTMLOutputElement>('#d3-morph-out'),
    aeta: $<HTMLOutputElement>('#d3-aeta'),
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
    const T = pT.value;
    // The only sign conversion in the demo, and the only place the control's
    // units meet the physics. The slider carries the applied cathodic
    // overpotential as a positive magnitude in millivolts — monotonic, and the
    // quantity a potentiostat actually sets. What the model needs is the signed
    // dimensionless group aη = Fη/RT, because it goes straight into the
    // Butler–Volmer exponentials exp((1−α)aη) and exp(−α·aη) in phasefield.ts.
    // Deriving it here rather than storing it is what makes the temperature
    // coupling real: the same millivolts give a smaller |aη| in a hotter cell.
    const etaVolts = -pEtaMag.value / 1000;
    params.etaA = (F * etaVolts) / (Rgas * T);
    const omega = [...omegaInputs].find((r) => r.checked)?.value === '6' ? 6 : 4;
    params.omegaMode = omega;
    const deltaMax = omega === 6 ? 0.028 : 0.06; // keeps κ + κ'' > 0 (well-posed)
    // Six-fold anisotropy is well-posed over a narrower band, so clamp the
    // control itself rather than silently using a value it does not show.
    if (pDelta.value > deltaMax) pDelta.value = deltaMax;
    params.delta = pDelta.value;
    params.Leta = sliderToLog(Number(morphSlider.value), 0.01, 0.15);
    // higher drive needs the sharper-interface regime found in tuning
    const drive01 = Number(morphSlider.value) / 100;
    params.W = 1.2 - 0.4 * drive01;
    params.kappa0 = 0.9 - 0.25 * drive01;
    params.noise = 0.1 + 0.25 * drive01;
    params.D = 0.8;
    params.lambdaC = 3.0 + drive01;
    params.dt = 0.045;

    outs.aeta.value = params.etaA.toFixed(2);
    outs.morph.value =
      drive01 < 0.33 ? `mossy (L_η=${params.Leta.toFixed(3)})` : drive01 < 0.7 ? `needle (L_η=${params.Leta.toFixed(3)})` : `dendritic (L_η=${params.Leta.toFixed(3)})`;
  };

  const pEtaMag = bindParam(shell, 'd3-eta', () => readControls());
  const pDelta = bindParam(shell, 'd3-delta', () => readControls());
  const pT = bindParam(shell, 'd3-T', () => readControls());
  const pNuc = bindParam(shell, 'd3-nuc', () => readControls());

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
    engine.seed(pNuc.value);
    steps = 0;
    stepsAtStamp = 0;
    stepStamp = performance.now();
    engine.render(showC.checked);
  });
  morphSlider.addEventListener('input', readControls);
  omegaInputs.forEach((r) => r.addEventListener('change', readControls));
  showC.addEventListener('change', () => engine.render(showC.checked));
  addEventListener('pagehide', () => {
    loop.dispose();
    engine.dispose();
  });

  readControls();
  engine.seed(pNuc.value);
  engine.render(showC.checked);
  revealCanvas(shell, canvas);
  enablePanel(shell);
  // reduced motion: start paused on a seeded frame; the run button still works
  setPaused(prefersReducedMotion());
}
