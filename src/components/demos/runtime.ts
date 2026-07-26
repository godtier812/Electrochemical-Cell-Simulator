/**
 * Shared demo runtime: lazy init on visibility, poster swap, canvas
 * management, pause-when-hidden animation loop, formatting helpers.
 */

export interface Shell {
  root: HTMLElement;
  stage: HTMLElement;
  panel: HTMLFieldSetElement | null;
}

export function getShell(id: string): Shell | null {
  const root = document.getElementById(id);
  if (!root) return null;
  const stage = root.querySelector<HTMLElement>('.demo-stage');
  if (!stage) return null;
  return { root, stage, panel: root.querySelector<HTMLFieldSetElement>('fieldset.panel') };
}

/** Run init once, the first time the demo scrolls near the viewport. */
export function initWhenVisible(id: string, init: (shell: Shell) => void): void {
  const shell = getShell(id);
  if (!shell) return;
  const run = () => {
    try {
      init(shell);
    } catch (err) {
      showMessage(shell, 'This demo failed to start. Reload the page to retry; the poster above shows a precomputed result.');
      console.error(`[voltaire:${id}]`, err);
    }
  };
  if (!('IntersectionObserver' in window)) {
    run();
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        run();
      }
    },
    { rootMargin: '200px 0px' }
  );
  io.observe(shell.stage);
}

export function prefersReducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Create the working canvas behind the poster; call revealCanvas() after the first good frame. */
export function createCanvas(shell: Shell, label: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', label);
  canvas.style.opacity = '0';
  shell.stage.insertBefore(canvas, shell.stage.firstChild);
  return canvas;
}

export function revealCanvas(shell: Shell, canvas: HTMLCanvasElement): void {
  canvas.style.opacity = '1';
  shell.stage.querySelector<HTMLImageElement>('img.poster')?.remove();
}

export function enablePanel(shell: Shell): void {
  if (shell.panel) shell.panel.disabled = false;
}

export function showMessage(shell: Shell, text: string): void {
  const msg = shell.stage.querySelector<HTMLElement>('.demo-msg');
  if (msg) {
    msg.textContent = text;
    msg.setAttribute('data-show', '');
  }
}

/**
 * requestAnimationFrame loop that pauses when the stage leaves the viewport
 * or the tab is hidden, and stops for reduced-motion users after rendering
 * one frame (callers that animate decoratively should check
 * prefersReducedMotion themselves for their start state).
 */
export class Loop {
  private running = false;
  private visible = true;
  private raf = 0;
  private io: IntersectionObserver;
  private visHandler: () => void;

  constructor(
    target: Element,
    private tick: (dtMs: number) => void
  ) {
    this.io = new IntersectionObserver((entries) => {
      this.visible = entries.some((e) => e.isIntersecting);
      this.schedule();
    });
    this.io.observe(target);
    this.visHandler = () => this.schedule();
    document.addEventListener('visibilitychange', this.visHandler);
  }

  private last = 0;

  private schedule(): void {
    const active = this.running && this.visible && !document.hidden;
    if (active && !this.raf) {
      this.last = performance.now();
      const frame = (now: number) => {
        this.raf = 0;
        if (!this.running || !this.visible || document.hidden) return;
        const dt = Math.min(100, now - this.last);
        this.last = now;
        this.tick(dt);
        this.raf = requestAnimationFrame(frame);
      };
      this.raf = requestAnimationFrame(frame);
    } else if (!active && this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  start(): void {
    this.running = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    this.schedule();
  }

  get active(): boolean {
    return this.running;
  }

  dispose(): void {
    this.stop();
    this.io.disconnect();
    document.removeEventListener('visibilitychange', this.visHandler);
  }
}

/** Debounce recomputation to one per animation frame. */
export function rafDebounce(fn: () => void): () => void {
  let scheduled = false;
  return () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      fn();
    });
  };
}

/** Format with SI prefix, e.g. siFormat(3.2e-9, 'm') = "3.20 nm". */
export function siFormat(value: number, unit: string, digits = 3): string {
  if (value === 0 || !isFinite(value)) return `${value} ${unit}`;
  const prefixes: [number, string][] = [
    [1e9, 'G'],
    [1e6, 'M'],
    [1e3, 'k'],
    [1, ''],
    [1e-3, 'm'],
    [1e-6, 'µ'],
    [1e-9, 'n'],
    [1e-12, 'p'],
  ];
  for (const [scale, prefix] of prefixes) {
    if (Math.abs(value) >= scale * 0.9995) {
      return `${(value / scale).toPrecision(digits)} ${prefix}${unit}`;
    }
  }
  return `${value.toExponential(digits - 1)} ${unit}`;
}

/** Map a 0–100 slider to a log-scale value. */
export function sliderToLog(v: number, min: number, max: number): number {
  return Math.pow(10, Math.log10(min) + (Math.log10(max) - Math.log10(min)) * (v / 100));
}

export function logToSlider(value: number, min: number, max: number): number {
  return (100 * (Math.log10(value) - Math.log10(min))) / (Math.log10(max) - Math.log10(min));
}
