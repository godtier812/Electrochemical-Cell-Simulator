import { PF_DEFAULTS, type PFParams } from '../../lib/phasefield';
import { createEngine, type PFEngine } from './pf-engine';
import { Loop, prefersReducedMotion } from './runtime';

/**
 * The landing hero: the phase-field solver itself, running full-bleed behind
 * the headline. Grows a competing needle/dendrite forest from a flat
 * electrode, and reseeds with a soft crossfade once the domain fills.
 * Reduced-motion users and browsers without WebGL2/canvas keep the poster.
 */
const HERO_PARAMS: PFParams = {
  ...PF_DEFAULTS,
  Leta: 0.1,
  D: 0.7,
  lambdaC: 3.5,
  W: 0.8,
  kappa0: 0.65,
  delta: 0.06,
  omegaMode: 4,
  noise: 0.35,
  dt: 0.045,
};

/**
 * Steps run behind the poster before the live field is shown. A freshly
 * seeded field is a flat electrode with a few specks on it; fading from a
 * grown poster to that made the page's first impression an empty purple
 * rectangle for several seconds. The poster now stays until the live field
 * has something to show.
 */
const WARM_STEPS = { webgl2: 2600, cpu: 200 } as const;
const WARM_CHUNK = { webgl2: 130, cpu: 20 } as const;

export function initHero(container: HTMLElement): void {
  const readout = container.querySelector<HTMLElement>('.hero-readout');
  const outRate = container.querySelector<HTMLElement>('#hero-rate');
  const outSolid = container.querySelector<HTMLElement>('#hero-solid');
  const outBackend = container.querySelector<HTMLElement>('#hero-backend');
  const pauseBtn = container.querySelector<HTMLButtonElement>('#hero-pause');
  const still = (why: string) => {
    // No live field: say what the picture is instead of showing dead readouts.
    if (outBackend) outBackend.textContent = why;
    readout?.setAttribute('data-still', '');
    if (readout) readout.hidden = false;
  };

  if (prefersReducedMotion()) {
    still('precomputed frame (reduced motion)');
    return; // poster stays
  }
  const seedCanvas = document.createElement('canvas');
  seedCanvas.className = 'hero-canvas';
  seedCanvas.setAttribute('aria-hidden', 'true');
  let engine: PFEngine | null = null;
  // 768x384 rather than 576x288: on a 1440px-wide hero at dpr 2 the old field
  // was magnified 5x per axis, which reads soft. This brings it to 3.75x for
  // 1.8x the cell count. The CPU fallback stays where it is; it is already the
  // slow path and is only reached when WebGL2 is unavailable.
  engine = createEngine(seedCanvas, [768, 384], [224, 112]);
  if (!engine) {
    still('precomputed frame');
    return; // poster stays
  }

  // A CPU fallback swaps the element; this one is not yet in the DOM, so the
  // swap has no parent to act on and the engine's canvas is what to insert.
  const canvas = engine.canvas;
  container.insertBefore(canvas, container.firstChild);
  engine.seed(5);
  const backend = engine.info.backend === 'webgl2' ? 'webgl2' : 'cpu';
  if (outBackend) {
    outBackend.textContent = `${backend === 'webgl2' ? 'WebGL2' : 'CPU'} ${engine.info.nx}×${engine.info.ny}`;
  }

  let fade = 0; // 0 = normal, >0 counts down a reseed crossfade
  let sinceMetrics = 0;
  let steps = 0;
  let stamp = performance.now();
  let stepsAtStamp = 0;
  const loop = new Loop(container, () => {
    if (!engine) return;
    const sub = backend === 'webgl2' ? 9 : 3;
    engine.step(HERO_PARAMS, sub);
    engine.render(false);
    sinceMetrics += sub;
    steps += sub;
    if (fade > 0) {
      fade--;
      canvas.style.opacity = String(Math.min(1, 1 - fade / 40));
      return;
    }
    if (sinceMetrics > 300) {
      sinceMetrics = 0;
      const now = performance.now();
      if (outRate) outRate.textContent = `${Math.round(((steps - stepsAtStamp) / (now - stamp)) * 1000)} steps/s`;
      stamp = now;
      stepsAtStamp = steps;
      const m = engine.metrics();
      if (outSolid) outSolid.textContent = `${(m.solidFraction * 100).toFixed(0)}%`;
      // reseed once the forest has consumed most of the frame
      if (m.solidFraction > 0.5) {
        engine.seed(3 + Math.floor(Math.random() * 4));
        fade = 40;
        canvas.style.opacity = '0';
      }
    }
  });

  // WCAG 2.2.2: anything that moves for more than five seconds needs a way to
  // stop it. The loop already pauses off-screen; this is the on-screen control.
  pauseBtn?.addEventListener('click', () => {
    const pausing = loop.active;
    if (pausing) loop.stop();
    else {
      stamp = performance.now();
      stepsAtStamp = steps;
      loop.start();
    }
    pauseBtn.textContent = pausing ? 'run' : 'pause';
    pauseBtn.setAttribute('aria-pressed', String(pausing));
    if (pausing && outRate) outRate.textContent = 'paused';
  });

  let warmed = 0;
  const warm = () => {
    if (!engine) return;
    engine.step(HERO_PARAMS, WARM_CHUNK[backend]);
    warmed += WARM_CHUNK[backend];
    if (warmed < WARM_STEPS[backend]) {
      requestAnimationFrame(warm);
      return;
    }
    // the live field now has a deposit worth looking at: swap it in for the poster
    engine.render(false);
    canvas.style.opacity = '1';
    const poster = container.querySelector<HTMLImageElement>('img.hero-poster');
    if (poster) poster.style.opacity = '0';
    if (readout) readout.hidden = false;
    if (pauseBtn) pauseBtn.hidden = false;
    steps = warmed;
    stepsAtStamp = warmed;
    stamp = performance.now();
    loop.start();
  };
  requestAnimationFrame(warm);

  addEventListener('pagehide', () => {
    loop.dispose();
    engine?.dispose();
    engine = null;
  });
}
