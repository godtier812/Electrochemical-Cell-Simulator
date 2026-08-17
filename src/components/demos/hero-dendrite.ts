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

export function initHero(container: HTMLElement): void {
  if (prefersReducedMotion()) return; // poster stays
  const seedCanvas = document.createElement('canvas');
  seedCanvas.className = 'hero-canvas';
  seedCanvas.setAttribute('aria-hidden', 'true');
  let engine: PFEngine | null = null;
  engine = createEngine(seedCanvas, [576, 288], [224, 112]);
  if (!engine) return; // poster stays

  // A CPU fallback swaps the element; this one is not yet in the DOM, so the
  // swap has no parent to act on and the engine's canvas is what to insert.
  const canvas = engine.canvas;
  container.insertBefore(canvas, container.firstChild);
  engine.seed(5);

  let fade = 0; // 0 = normal, >0 counts down a reseed crossfade
  let sinceMetrics = 0;
  const loop = new Loop(container, () => {
    if (!engine) return;
    const sub = engine.info.backend === 'webgl2' ? 9 : 3;
    engine.step(HERO_PARAMS, sub);
    engine.render(false);
    sinceMetrics += sub;
    if (fade > 0) {
      fade--;
      canvas.style.opacity = String(Math.min(1, 1 - fade / 40));
      return;
    }
    if (sinceMetrics > 400) {
      sinceMetrics = 0;
      const m = engine.metrics();
      // reseed once the forest has consumed most of the frame
      if (m.solidFraction > 0.5) {
        engine.seed(3 + Math.floor(Math.random() * 4));
        fade = 40;
        canvas.style.opacity = '0';
      }
    }
  });

  // fade the canvas in over the poster once the first frames exist
  requestAnimationFrame(() => {
    canvas.style.opacity = '1';
    const poster = container.querySelector<HTMLImageElement>('img.hero-poster');
    if (poster) poster.style.opacity = '0';
  });
  loop.start();
  addEventListener('pagehide', () => {
    loop.dispose();
    engine?.dispose();
    engine = null;
  });
}
