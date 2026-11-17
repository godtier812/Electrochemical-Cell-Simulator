/**
 * Shared demo runtime: lazy init on visibility, poster swap, canvas
 * management, pause-when-hidden animation loop, formatting helpers, and the
 * toolbar every demo carries (reset, hold, copy link, CSV, PNG).
 */
import { decodeState, encodeState, formatStateNumber, readStateNumber, type DemoState } from '../../lib/urlstate';

export interface Shell {
  root: HTMLElement;
  stage: HTMLElement;
  panel: HTMLFieldSetElement | null;
  /** Every Control-backed parameter in this demo, by slider id. Filled by bindParam. */
  params: Map<string, Param>;
}

export function getShell(id: string): Shell | null {
  const root = document.getElementById(id);
  if (!root) return null;
  const stage = root.querySelector<HTMLElement>('.demo-stage');
  if (!stage) return null;
  return {
    root,
    stage,
    panel: root.querySelector<HTMLFieldSetElement>('fieldset.panel'),
    params: new Map(),
  };
}

/** State carried in the page URL, read once: a link is a starting point, not a live binding. */
let urlState: DemoState | null = null;
export function pageState(): DemoState {
  if (!urlState) urlState = decodeState(location.search);
  return urlState;
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
    // The markup declares an exact starting value, which the number field
    // carries as its default. Reading it back off the slider instead rounded
    // it to the nearest detent — on a log scale R_ct = 25 ran as 25.1189 —
    // so the value is taken from the field and the slider merely follows it.
    const declared = number && number.defaultValue.trim() !== '' ? Number(number.defaultValue) : NaN;
    this.value_ = Number.isFinite(declared)
      ? this.round(Math.min(spec.max, Math.max(spec.min, declared)))
      : this.fromPosition(Number(slider.value));
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
  const param = new Param(
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
  // A shared link overrides the shipped value. Applied after construction, so
  // reset() still returns to what the markup declared, not to the link.
  const linked = readStateNumber(pageState(), id, param.spec.min, param.spec.max);
  if (linked !== null) param.value = linked;
  shell.params.set(id, param);
  return param;
}

/* ---------------- toolbar: reset, hold, link, export --------------------- */

export interface ShellHandlers {
  /** Recompute and redraw from whatever the controls currently say. */
  refresh: () => void;
  /** The numbers behind the picture, as CSV text. Omit to hide the button. */
  csv?: () => string;
  /** Pin the current curves for comparison. Omit to hide the button. */
  hold?: () => void;
  clearHold?: () => void;
  /** Runs synchronously before the stage is captured; WebGL needs a fresh frame. */
  beforeCapture?: () => void;
  /** State that lives outside the form controls, e.g. a random seed. */
  extraState?: () => DemoState;
  /** Runs after the controls have been put back, before refresh. */
  onReset?: () => void;
}

/** Controls in the panel that are not half of a Control.astro slider/number pair. */
function looseInputs(shell: Shell): HTMLInputElement[] {
  if (!shell.panel) return [];
  return [...shell.panel.querySelectorAll<HTMLInputElement>('input')].filter(
    (el) => !shell.params.has(el.id) && !el.id.endsWith('-num') && ['checkbox', 'radio', 'range'].includes(el.type)
  );
}

/** Everything needed to reproduce the demo's current state. */
export function serialiseShell(shell: Shell, extra: DemoState = {}): DemoState {
  const state: DemoState = {};
  shell.params.forEach((p, id) => {
    state[id] = formatStateNumber(p.value);
  });
  for (const el of looseInputs(shell)) {
    if (el.type === 'checkbox') state[el.id] = el.checked ? '1' : '0';
    else if (el.type === 'radio') {
      if (el.checked) state[el.name] = el.value;
    } else state[el.id] = el.value;
  }
  return { ...state, ...extra };
}

/** Put a state onto the controls. Keys that are not this demo's are ignored. */
export function applyState(shell: Shell, state: DemoState): void {
  shell.params.forEach((p, id) => {
    const v = readStateNumber(state, id, p.spec.min, p.spec.max);
    if (v !== null) p.value = v;
  });
  for (const el of looseInputs(shell)) {
    if (el.type === 'checkbox') {
      if (state[el.id] !== undefined) el.checked = state[el.id] === '1';
    } else if (el.type === 'radio') {
      if (state[el.name] !== undefined) el.checked = state[el.name] === el.value;
    } else if (state[el.id] !== undefined) {
      const v = Number(state[el.id]);
      if (isFinite(v)) el.value = String(Math.min(Number(el.max), Math.max(Number(el.min), v)));
    }
  }
}

function resetControls(shell: Shell): void {
  shell.params.forEach((p) => p.reset());
  for (const el of looseInputs(shell)) {
    if (el.type === 'range') el.value = el.defaultValue;
    else el.checked = el.defaultChecked;
  }
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(filename: string, text: string, type = 'text/csv'): void {
  downloadBlob(filename, new Blob([text], { type: `${type};charset=utf-8` }));
}

/**
 * Flatten every canvas in an element into one PNG on the element's own
 * background, so a saved figure looks like the stage did, in either theme.
 */
export function captureCanvases(host: HTMLElement): Promise<Blob | null> {
  const rect = host.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(rect.width * dpr));
  out.height = Math.max(1, Math.round(rect.height * dpr));
  const ctx = out.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  ctx.fillStyle = getComputedStyle(host).backgroundColor;
  ctx.fillRect(0, 0, out.width, out.height);
  for (const c of host.querySelectorAll('canvas')) {
    const r = c.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || c.width === 0 || c.height === 0) continue;
    ctx.drawImage(c, (r.left - rect.left) * dpr, (r.top - rect.top) * dpr, r.width * dpr, r.height * dpr);
  }
  return new Promise((resolve) => out.toBlob(resolve, 'image/png'));
}

/** Briefly swap a button's label to confirm an action that has no other visible effect. */
export function flash(btn: HTMLElement, text: string): void {
  const original = btn.dataset.label ?? btn.textContent ?? '';
  btn.dataset.label = original;
  btn.textContent = text;
  btn.setAttribute('data-copied', '');
  setTimeout(() => {
    btn.textContent = original;
    btn.removeAttribute('data-copied');
  }, 1400);
}

/**
 * Wire the toolbar and the "try this" presets, and apply any state the page
 * URL carries. Call it once every bindParam and listener is in place, before
 * the first refresh: it only moves controls, and leaves computing to the demo.
 */
export function setupShell(shell: Shell, handlers: ShellHandlers): void {
  const slug = shell.root.id.replace(/^demo-/, '');
  applyState(shell, pageState());

  const tools = shell.root.querySelector<HTMLElement>('.demo-tools');
  const button = (action: string) => tools?.querySelector<HTMLButtonElement>(`[data-action="${action}"]`) ?? null;

  button('reset')?.addEventListener('click', () => {
    resetControls(shell);
    handlers.clearHold?.();
    handlers.onReset?.();
    handlers.refresh();
  });

  const hold = button('hold');
  if (hold && handlers.hold) {
    hold.hidden = false;
    hold.addEventListener('click', () => handlers.hold!());
  }

  const link = button('link');
  link?.addEventListener('click', async () => {
    const query = encodeState(serialiseShell(shell, handlers.extraState?.()));
    const url = `${location.origin}${location.pathname}?${query}#${shell.root.id}`;
    try {
      history.replaceState(null, '', url);
      await navigator.clipboard.writeText(url);
      flash(link, 'link copied');
    } catch {
      // clipboard refused (insecure context, permissions): the address bar has it
      flash(link, 'link is in the address bar');
    }
  });

  const csv = button('csv');
  if (csv && handlers.csv) {
    csv.hidden = false;
    csv.addEventListener('click', () => downloadText(`voltaire-${slug}.csv`, handlers.csv!()));
  }

  button('png')?.addEventListener('click', async () => {
    handlers.beforeCapture?.();
    const blob = await captureCanvases(shell.stage);
    if (blob) downloadBlob(`voltaire-${slug}.png`, blob);
  });

  shell.root.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((btn) => {
    btn.disabled = false;
    btn.addEventListener('click', () => {
      try {
        applyState(shell, JSON.parse(btn.dataset.preset ?? '{}') as DemoState);
      } catch {
        return;
      }
      handlers.refresh();
    });
  });

  if (tools) tools.hidden = false;
}
