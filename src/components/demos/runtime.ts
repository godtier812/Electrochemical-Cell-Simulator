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

/* ---------------- parameters: slider + numeric entry --------------------- */

export interface ParamSpec {
  /** Physical bounds, in the units named by the control's label. */
  min: number;
  max: number;
  /** How slider travel maps onto value: evenly, or evenly in decades. */
  scale: 'linear' | 'log';
  /** Rounding applied to typed and dragged values; null leaves them continuous. */
  step: number | null;
  /** Slider detents between min and max. */
  positions: number;
}

/** Decimal places implied by a step like 0.05, used to format the readout. */
function decimalsFor(step: number | null): number {
  if (step === null) return 0;
  const s = String(step);
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

/**
 * One physical quantity presented twice: a slider for sweeping and a number
 * input for typing an exact value. The physical range lives in the markup (see
 * Control.astro) so each quantity is declared once, and the slider stays in
 * abstract detents underneath.
 */
export class Param {
  readonly spec: ParamSpec;
  private readonly initial: number;
  private value_: number;

  constructor(
    readonly slider: HTMLInputElement,
    readonly number: HTMLInputElement | null,
    spec: ParamSpec,
    private readonly onChange: () => void
  ) {
    this.spec = spec;
    this.value_ = this.fromPosition(Number(slider.value));
    this.initial = this.value_;

    slider.addEventListener('input', () => {
      this.value_ = this.fromPosition(Number(slider.value));
      this.render();
      this.onChange();
    });

    if (number) {
      // Apply while typing only when the entry is already a sensible number, so
      // a half-typed "0.0" on the way to "0.05" does not snap to the minimum.
      number.addEventListener('input', () => {
        const v = Number(number.value);
        if (number.value.trim() === '' || !isFinite(v)) return;
        if (v < spec.min || v > spec.max) return;
        this.value_ = this.round(v);
        this.syncSlider();
        this.onChange();
      });
      // On commit, clamp whatever is there and normalise how it reads.
      number.addEventListener('change', () => {
        const v = Number(number.value);
        this.value = isFinite(v) && number.value.trim() !== '' ? v : this.value_;
      });
    }
    this.render();
  }

  get value(): number {
    return this.value_;
  }

  /** Set from code: clamps into range, then updates both controls. */
  set value(v: number) {
    const clamped = Math.min(this.spec.max, Math.max(this.spec.min, isFinite(v) ? v : this.initial));
    this.value_ = this.round(clamped);
    this.syncSlider();
    this.render();
  }

  /** Restore the value the markup shipped with. Does not fire onChange. */
  reset(): void {
    this.value = this.initial;
  }

  private round(v: number): number {
    const { step, min, max } = this.spec;
    if (step === null) return v;
    return Math.min(max, Math.max(min, min + Math.round((v - min) / step) * step));
  }

  /**
   * Position and value increase together, always. A quantity whose physical
   * sign runs the other way (a cathodic overpotential) is declared as a
   * magnitude and negated where it enters the physics, not flipped here.
   */
  private fromPosition(pos: number): number {
    const { min, max, scale, positions } = this.spec;
    const f = positions === 0 ? 0 : pos / positions;
    const raw =
      scale === 'log'
        ? Math.pow(10, Math.log10(min) + (Math.log10(max) - Math.log10(min)) * f)
        : min + (max - min) * f;
    return this.round(raw);
  }

  private toPosition(v: number): number {
    const { min, max, scale, positions } = this.spec;
    const raw =
      scale === 'log'
        ? (Math.log10(v) - Math.log10(min)) / (Math.log10(max) - Math.log10(min))
        : (v - min) / (max - min);
    return Math.round(Math.min(1, Math.max(0, raw)) * positions);
  }

  private syncSlider(): void {
    this.slider.value = String(this.toPosition(this.value_));
  }

  /** Canonical display text: step decimals if stepped, else 3 significant figures. */
  format(): string {
    const { step } = this.spec;
    return step === null
      ? String(Number(this.value_.toPrecision(3)))
      : this.value_.toFixed(decimalsFor(step));
  }

  private render(): void {
    if (this.number && this.number !== document.activeElement) {
      this.number.value = this.format();
    }
  }
}

/**
 * Wire the slider/number pair emitted by Control.astro. The spec is read from
 * the data- attributes the component wrote, so the range is declared in one
 * place and cannot drift between the two inputs.
 */
export function bindParam(shell: Shell, id: string, onChange: () => void): Param {
  const slider = shell.root.querySelector<HTMLInputElement>(`#${id}`);
  if (!slider) throw new Error(`bindParam: no slider #${id}`);
  const number = shell.root.querySelector<HTMLInputElement>(`#${id}-num`);
  const stepAttr = slider.dataset.step;
  return new Param(
    slider,
    number,
    {
      min: Number(slider.dataset.min),
      max: Number(slider.dataset.max),
      scale: slider.dataset.scale === 'log' ? 'log' : 'linear',
      step: stepAttr === undefined || stepAttr === '' ? null : Number(stepAttr),
      positions: Number(slider.max),
    },
    onChange
  );
}
