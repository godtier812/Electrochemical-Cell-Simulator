/**
 * Minimal canvas plotting: framed axes with inward ticks, linear/log scales,
 * legends, dashed lines, markers, annotations, equal-aspect mode (Nyquist),
 * a pointer readout, held comparison traces, CSV export, and
 * device-pixel-ratio aware rendering. Colours come from the page theme via CSS
 * custom properties, so plots re-render correctly in both themes.
 */
import { seriesToCsv } from './csv';

export interface Series {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  color?: string;
  width?: number;
  dash?: number[];
  label?: string;
  /** marker radius in px; 0 = line only */
  marker?: number;
  /** fill down to y=0 (used by the DRT spectrum) */
  fill?: boolean;
  /** stroke opacity, 0–1; held traces are drawn faint */
  alpha?: number;
}

export type Annotation =
  | { type: 'vline'; x: number; color?: string; dash?: number[]; label?: string }
  | { type: 'hline'; y: number; color?: string; dash?: number[]; label?: string }
  | { type: 'text'; x: number; y: number; text: string; color?: string; align?: CanvasTextAlign }
  | { type: 'segment'; x1: number; y1: number; x2: number; y2: number; color?: string; dash?: number[] };

export interface PlotOptions {
  xLabel?: string;
  yLabel?: string;
  xScale?: 'linear' | 'log';
  yScale?: 'linear' | 'log';
  xRange?: [number, number];
  yRange?: [number, number];
  equalAspect?: boolean;
  /** 'auto' (the default for two or more labelled series) picks the corner covering the least data. */
  legend?: 'auto' | 'tl' | 'tr' | 'bl' | 'br' | 'none';
  /** extra fractional padding applied to auto ranges */
  pad?: number;
  /**
   * Pointer readout. 'x' (default) drops a vertical cursor and reports every
   * series at that abscissa; 'nearest' reports the single closest point, for
   * curves that are not functions of x (Nyquist); false turns it off.
   */
  hover?: 'x' | 'nearest' | false;
}

interface ThemeColors {
  grid: string;
  axis: string;
  fg: string;
  surface: string;
}

function themeColors(el: HTMLElement): ThemeColors {
  const cs = getComputedStyle(el);
  return {
    grid: cs.getPropertyValue('--plot-grid').trim() || '#ddd',
    axis: cs.getPropertyValue('--plot-axis').trim() || '#667',
    fg: cs.getPropertyValue('--fg').trim() || '#111',
    surface: cs.getPropertyValue('--surface').trim() || '#fff',
  };
}

/** "Nice" tick positions covering [min, max]. */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!isFinite(min) || !isFinite(max) || min === max) return [min];
  const span = max - min;
  const raw = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  let step = mag;
  for (const mult of [1, 2, 5, 10]) {
    if (mag * mult >= raw) {
      step = mag * mult;
      break;
    }
  }
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 1e-9; v += step) {
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return ticks;
}

function logTicks(min: number, max: number): { major: number[]; minor: number[] } {
  const lo = Math.floor(Math.log10(min));
  const hi = Math.ceil(Math.log10(max));
  const major: number[] = [];
  const minor: number[] = [];
  for (let e = lo; e <= hi; e++) {
    const d = Math.pow(10, e);
    if (d >= min * 0.999 && d <= max * 1.001) major.push(d);
    for (let m = 2; m <= 9; m++) {
      const v = m * d;
      if (v >= min && v <= max) minor.push(v);
    }
  }
  return { major, minor };
}

const SUPERSCRIPT: Record<string, string> = {
  '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
};

/** 10 raised to an integer power, typeset: pow10(-4) = "10⁻⁴". */
export function pow10(e: number): string {
  return '10' + String(e).replace(/[-0-9]/g, (ch) => SUPERSCRIPT[ch]);
}

/** Axis-tick text: plain decimals in the readable range, m×10ⁿ outside it. */
export function formatTick(v: number): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 10000 || a < 0.001) {
    let e = Math.floor(Math.log10(a));
    let mant = +(v / Math.pow(10, e)).toPrecision(3);
    if (Math.abs(mant) >= 10) {
      mant /= 10;
      e += 1;
    }
    if (mant === 1) return pow10(e);
    if (mant === -1) return `−${pow10(e)}`;
    return `${mant}×${pow10(e)}`;
  }
  return String(+v.toPrecision(4));
}

/** Readout text: like a tick label, with one more significant figure. */
export function formatValue(v: number): string {
  if (!isFinite(v)) return '—';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 10000 || a < 0.001) return formatTick(+v.toPrecision(3));
  return String(+v.toPrecision(4));
}

/** The quantity in an axis label, without its unit: "φ / mV" -> "φ". */
function quantityOf(label: string | undefined, fallback: string): string {
  if (!label) return fallback;
  const q = label.split(' / ')[0].trim();
  return q.length > 0 && q.length <= 14 ? q : fallback;
}

const MAX_HELD = 3;

export class Plot {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private opts: PlotOptions;
  private area = { x: 0, y: 0, w: 1, h: 1 };
  private range = { x0: 0, x1: 1, y0: 0, y1: 1 };
  private lastSeries: Series[] = [];
  private lastAnnotations: Annotation[] = [];
  private held: Series[][] = [];
  private hoverPx: [number, number] | null = null;
  private themeHandler: () => void;
  private moveHandler: (e: PointerEvent) => void;
  private leaveHandler: () => void;

  constructor(canvas: HTMLCanvasElement, opts: PlotOptions = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.opts = opts;
    this.themeHandler = () => this.redraw();
    addEventListener('voltaire-theme', this.themeHandler);
    this.moveHandler = (e) => {
      if (this.opts.hover === false) return;
      const rect = canvas.getBoundingClientRect();
      this.hoverPx = [e.clientX - rect.left, e.clientY - rect.top];
      this.redraw();
    };
    this.leaveHandler = () => {
      if (!this.hoverPx) return;
      this.hoverPx = null;
      this.redraw();
    };
    canvas.addEventListener('pointermove', this.moveHandler);
    canvas.addEventListener('pointerleave', this.leaveHandler);
  }

  dispose(): void {
    removeEventListener('voltaire-theme', this.themeHandler);
    this.canvas.removeEventListener('pointermove', this.moveHandler);
    this.canvas.removeEventListener('pointerleave', this.leaveHandler);
  }

  setOptions(partial: Partial<PlotOptions>): void {
    // A held trace was drawn against the old axes; on a different scale it
    // would be a curve of something else, so it does not survive the change.
    if (
      ('xScale' in partial && partial.xScale !== this.opts.xScale) ||
      ('yScale' in partial && partial.yScale !== this.opts.yScale)
    ) {
      this.held = [];
    }
    Object.assign(this.opts, partial);
  }

  /**
   * Pin the curves currently on screen as faint traces, to compare the next
   * setting against. Only solid lines are held: by this site's convention a
   * dashed line is an analytic reference, which does not need remembering.
   */
  hold(label: string): void {
    const snap = this.lastSeries
      .filter((s) => !s.dash)
      .map((s, i) => ({
        x: Float64Array.from(s.x as ArrayLike<number>),
        y: Float64Array.from(s.y as ArrayLike<number>),
        color: s.color,
        width: 1.25,
        marker: 0,
        alpha: 0.5,
        label: i === 0 ? label : undefined,
      }));
    if (snap.length === 0) return;
    this.held.push(snap);
    if (this.held.length > MAX_HELD) this.held.shift();
    this.redraw();
  }

  clearHeld(): void {
    if (this.held.length === 0) return;
    this.held = [];
    this.redraw();
  }

  get heldCount(): number {
    return this.held.length;
  }

  /** What is on screen, as CSV: live series first, then any held traces. */
  csv(): string {
    const named = (list: Series[], prefix: string) =>
      list.map((s, i) => ({ x: s.x, y: s.y, label: s.label ?? `${prefix}${list.length > 1 ? ` ${i + 1}` : ''}` }));
    const live = named(this.lastSeries, quantityOf(this.opts.yLabel, 'y'));
    const held = this.held.flatMap((group, g) => named(group, `held ${g + 1}`));
    return seriesToCsv([...live, ...held], this.opts.xLabel ?? 'x', this.opts.yLabel ?? 'y');
  }

  private tx(v: number): number {
    const { x0, x1 } = this.range;
    const t =
      this.opts.xScale === 'log'
        ? (Math.log10(v) - Math.log10(x0)) / (Math.log10(x1) - Math.log10(x0))
        : (v - x0) / (x1 - x0);
    return this.area.x + t * this.area.w;
  }

  private ty(v: number): number {
    const { y0, y1 } = this.range;
    const t =
      this.opts.yScale === 'log'
        ? (Math.log10(v) - Math.log10(y0)) / (Math.log10(y1) - Math.log10(y0))
        : (v - y0) / (y1 - y0);
    return this.area.y + this.area.h - t * this.area.h;
  }

  /** Data coords -> CSS pixel coords of the last draw (for hit-testing). */
  dataToPx(x: number, y: number): [number, number] {
    return [this.tx(x), this.ty(y)];
  }

  pxToData(px: number, py: number): [number, number] {
    const tx = (px - this.area.x) / this.area.w;
    const ty = (this.area.y + this.area.h - py) / this.area.h;
    const { x0, x1, y0, y1 } = this.range;
    const x =
      this.opts.xScale === 'log'
        ? Math.pow(10, Math.log10(x0) + tx * (Math.log10(x1) - Math.log10(x0)))
        : x0 + tx * (x1 - x0);
    const y =
      this.opts.yScale === 'log'
        ? Math.pow(10, Math.log10(y0) + ty * (Math.log10(y1) - Math.log10(y0)))
        : y0 + ty * (y1 - y0);
    return [x, y];
  }

  redraw(): void {
    this.draw(this.lastSeries, this.lastAnnotations);
  }

  draw(live: Series[], annotations: Annotation[] = []): void {
    this.lastSeries = live;
    this.lastAnnotations = annotations;
    // held traces go underneath, and count towards the auto range so they stay in frame
    const series = [...this.held.flat(), ...live];
    const { canvas, ctx, opts } = this;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const cw = canvas.clientWidth || 300;
    const ch = canvas.clientHeight || 200;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const colors = themeColors(canvas);
    ctx.clearRect(0, 0, cw, ch);

    // margins
    const ml = opts.yLabel ? 62 : 46;
    const mb = opts.xLabel ? 42 : 28;
    const mt = 10;
    const mr = 12;
    this.area = { x: ml, y: mt, w: Math.max(10, cw - ml - mr), h: Math.max(10, ch - mt - mb) };

    // ranges
    let { xRange, yRange } = opts;
    const pad = opts.pad ?? 0.04;
    const auto = (get: (s: Series, i: number) => number, log: boolean): [number, number] => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const s of series) {
        const n = s.x.length;
        for (let i = 0; i < n; i++) {
          const v = get(s, i);
          if (!isFinite(v) || (log && v <= 0)) continue;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      if (!isFinite(lo)) return [0, 1];
      if (lo === hi) return log ? [lo / 2, hi * 2] : [lo - 1, hi + 1];
      if (log) {
        const f = Math.pow(hi / lo, pad);
        return [lo / f, hi * f];
      }
      const p = (hi - lo) * pad;
      return [lo - p, hi + p];
    };
    let [x0, x1] = xRange ?? auto((s, i) => Number(s.x[i]), opts.xScale === 'log');
    let [y0, y1] = yRange ?? auto((s, i) => Number(s.y[i]), opts.yScale === 'log');

    if (opts.equalAspect && opts.xScale !== 'log' && opts.yScale !== 'log') {
      // expand the smaller unit-per-px axis so scales match
      const sx = (x1 - x0) / this.area.w;
      const sy = (y1 - y0) / this.area.h;
      if (sx > sy) {
        const c = (y0 + y1) / 2;
        const half = (sx * this.area.h) / 2;
        y0 = c - half;
        y1 = c + half;
      } else {
        const c = (x0 + x1) / 2;
        const half = (sy * this.area.w) / 2;
        x0 = c - half;
        x1 = c + half;
      }
    }
    this.range = { x0, x1, y0, y1 };

    const font = '12px "IBM Plex Mono", monospace';
    ctx.font = font;
    ctx.lineJoin = 'round';

    // grid + ticks
    const drawAxis = (axis: 'x' | 'y') => {
      const log = (axis === 'x' ? opts.xScale : opts.yScale) === 'log';
      const lo = axis === 'x' ? x0 : y0;
      const hi = axis === 'x' ? x1 : y1;
      let major: number[];
      let minor: number[] = [];
      if (log) {
        const t = logTicks(lo, hi);
        major = t.major;
        minor = t.minor;
        if (major.length <= 1) {
          major = major.concat(minor.filter((_, i) => i % 2 === 0));
          minor = [];
        }
      } else {
        major = niceTicks(lo, hi, axis === 'x' ? 6 : 5);
      }
      for (const v of minor) {
        const p = axis === 'x' ? this.tx(v) : this.ty(v);
        ctx.strokeStyle = colors.axis;
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (axis === 'x') {
          ctx.moveTo(p, this.area.y + this.area.h);
          ctx.lineTo(p, this.area.y + this.area.h - 3);
        } else {
          ctx.moveTo(this.area.x, p);
          ctx.lineTo(this.area.x + 3, p);
        }
        ctx.stroke();
      }
      // Labels that would overprint the previous one are skipped (the tick and
      // gridline stay). On a narrow plot a log axis has more decades than room,
      // and "10⁻⁷10⁻⁶10⁻⁵" run together reads as one number.
      let lastEdge = NaN;
      for (const v of major) {
        const p = axis === 'x' ? this.tx(v) : this.ty(v);
        // gridline
        ctx.strokeStyle = colors.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (axis === 'x') {
          ctx.moveTo(p, this.area.y);
          ctx.lineTo(p, this.area.y + this.area.h);
        } else {
          ctx.moveTo(this.area.x, p);
          ctx.lineTo(this.area.x + this.area.w, p);
        }
        ctx.stroke();
        // tick
        ctx.strokeStyle = colors.axis;
        ctx.beginPath();
        if (axis === 'x') {
          ctx.moveTo(p, this.area.y + this.area.h);
          ctx.lineTo(p, this.area.y + this.area.h - 5);
        } else {
          ctx.moveTo(this.area.x, p);
          ctx.lineTo(this.area.x + 5, p);
        }
        ctx.stroke();
        // label, unless it would collide with the last one drawn
        const text = formatTick(v);
        ctx.fillStyle = colors.axis;
        if (axis === 'x') {
          const half = ctx.measureText(text).width / 2;
          if (!(p - half < lastEdge + 6)) {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(text, p, this.area.y + this.area.h + 5);
            lastEdge = p + half;
          }
        } else if (!(Math.abs(p - lastEdge) < 14)) {
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, this.area.x - 6, p);
          lastEdge = p;
        }
      }
    };
    drawAxis('x');
    drawAxis('y');

    // frame
    ctx.strokeStyle = colors.axis;
    ctx.lineWidth = 1;
    ctx.strokeRect(this.area.x + 0.5, this.area.y + 0.5, this.area.w - 1, this.area.h - 1);

    // axis labels
    ctx.fillStyle = colors.fg;
    if (opts.xLabel) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(opts.xLabel, this.area.x + this.area.w / 2, ch - 4);
    }
    if (opts.yLabel) {
      ctx.save();
      ctx.translate(12, this.area.y + this.area.h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(opts.yLabel, 0, 0);
      ctx.restore();
    }

    // clip to plot area for data
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.area.x, this.area.y, this.area.w, this.area.h);
    ctx.clip();

    for (const ann of annotations) {
      ctx.strokeStyle = ann.type === 'text' ? 'transparent' : (ann.color ?? colors.axis);
      ctx.setLineDash(('dash' in ann ? ann.dash : undefined) ?? []);
      ctx.lineWidth = 1;
      if (ann.type === 'vline') {
        const p = this.tx(ann.x);
        ctx.beginPath();
        ctx.moveTo(p, this.area.y);
        ctx.lineTo(p, this.area.y + this.area.h);
        ctx.stroke();
        if (ann.label) {
          ctx.fillStyle = ann.color ?? colors.axis;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(ann.label, p + 4, this.area.y + 4);
        }
      } else if (ann.type === 'hline') {
        const p = this.ty(ann.y);
        ctx.beginPath();
        ctx.moveTo(this.area.x, p);
        ctx.lineTo(this.area.x + this.area.w, p);
        ctx.stroke();
        if (ann.label) {
          ctx.fillStyle = ann.color ?? colors.axis;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'bottom';
          ctx.fillText(ann.label, this.area.x + 6, p - 3);
        }
      } else if (ann.type === 'segment') {
        ctx.beginPath();
        ctx.moveTo(this.tx(ann.x1), this.ty(ann.y1));
        ctx.lineTo(this.tx(ann.x2), this.ty(ann.y2));
        ctx.stroke();
      } else {
        ctx.fillStyle = ann.color ?? colors.fg;
        ctx.textAlign = ann.align ?? 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(ann.text, this.tx(ann.x), this.ty(ann.y));
      }
      ctx.setLineDash([]);
    }

    for (const s of series) {
      const color = s.color ?? colors.fg;
      const n = Math.min(s.x.length, s.y.length);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = s.width ?? 1.75;
      ctx.setLineDash(s.dash ?? []);
      const alpha = s.alpha ?? 1;
      if (s.fill) {
        ctx.globalAlpha = 0.25 * alpha;
        ctx.beginPath();
        const yZero = this.ty(Math.max(this.range.y0, 0));
        ctx.moveTo(this.tx(Number(s.x[0])), yZero);
        for (let i = 0; i < n; i++) ctx.lineTo(this.tx(Number(s.x[i])), this.ty(Number(s.y[i])));
        ctx.lineTo(this.tx(Number(s.x[n - 1])), yZero);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = alpha;
      let started = false;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const xv = Number(s.x[i]);
        const yv = Number(s.y[i]);
        if (
          !isFinite(xv) ||
          !isFinite(yv) ||
          (this.opts.xScale === 'log' && xv <= 0) ||
          (this.opts.yScale === 'log' && yv <= 0)
        ) {
          started = false;
          continue;
        }
        const px = this.tx(xv);
        const py = this.ty(yv);
        if (started) ctx.lineTo(px, py);
        else {
          ctx.moveTo(px, py);
          started = true;
        }
      }
      if ((s.width ?? 1.75) > 0) ctx.stroke();
      ctx.setLineDash([]);
      if (s.marker) {
        for (let i = 0; i < n; i++) {
          const xv = Number(s.x[i]);
          const yv = Number(s.y[i]);
          if (!isFinite(xv) || !isFinite(yv)) continue;
          ctx.beginPath();
          ctx.arc(this.tx(xv), this.ty(yv), s.marker, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // legend
    const labelled = series.filter((s) => s.label);
    let legendPos = opts.legend ?? (labelled.length > 1 ? 'auto' : 'none');
    if (legendPos !== 'none' && labelled.length > 0) {
      ctx.font = font;
      const lh = 17;
      const wMax = Math.max(...labelled.map((s) => ctx.measureText(s.label!).width));
      const bw = wMax + 34;
      const bh = labelled.length * lh + 8;
      const corner = (pos: 'tl' | 'tr' | 'bl' | 'br'): [number, number] => [
        pos === 'tl' || pos === 'bl' ? this.area.x + 8 : this.area.x + this.area.w - bw - 8,
        pos === 'tl' || pos === 'tr' ? this.area.y + 8 : this.area.y + this.area.h - bh - 8,
      ];
      if (legendPos === 'auto') {
        // the corner whose box covers the fewest plotted points; ties go to
        // the earlier entry, so top-right stays the default on an empty plot
        let best: 'tl' | 'tr' | 'bl' | 'br' = 'tr';
        let bestCount = Infinity;
        for (const pos of ['tr', 'tl', 'br', 'bl'] as const) {
          const [cx, cy] = corner(pos);
          let count = 0;
          for (const s of series) {
            const n = Math.min(s.x.length, s.y.length);
            for (let i = 0; i < n; i++) {
              const px = this.tx(Number(s.x[i]));
              const py = this.ty(Number(s.y[i]));
              if (px >= cx - 4 && px <= cx + bw + 4 && py >= cy - 4 && py <= cy + bh + 4) count++;
            }
          }
          // annotation labels sit at the top of a vline and the left of an
          // hline; covering one hides text, which is worse than covering a point
          for (const ann of annotations) {
            if (!('label' in ann) || !ann.label) continue;
            const lw = ctx.measureText(ann.label).width;
            const [lx, ly] =
              ann.type === 'vline' ? [this.tx(ann.x) + 4, this.area.y + 4] : [this.area.x + 6, this.ty(ann.y) - 15];
            if (lx < cx + bw && lx + lw > cx && ly < cy + bh && ly + 12 > cy) count += 40;
          }
          if (count < bestCount) {
            bestCount = count;
            best = pos;
          }
        }
        legendPos = best;
      }
      const [bx, by] = corner(legendPos);
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = colors.surface;
      ctx.fillRect(bx, by, bw, bh);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colors.grid;
      ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
      labelled.forEach((s, i) => {
        const y = by + 4 + i * lh + lh / 2;
        ctx.strokeStyle = s.color ?? colors.fg;
        ctx.lineWidth = s.width ?? 1.75;
        ctx.setLineDash(s.dash ?? []);
        ctx.globalAlpha = s.alpha ?? 1;
        if ((s.width ?? 1.75) > 0) {
          ctx.beginPath();
          ctx.moveTo(bx + 6, y);
          ctx.lineTo(bx + 24, y);
          ctx.stroke();
        }
        if (s.marker) {
          // a points-only series is keyed by its marker, not by a line it does not have
          ctx.fillStyle = s.color ?? colors.fg;
          ctx.beginPath();
          ctx.arc(bx + 15, y, s.marker, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
        ctx.fillStyle = colors.fg;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(s.label!, bx + 30, y);
      });
    }

    this.drawHover(live, colors, font);
  }

  /** Pointer readout over the live series (held traces are for the eye only). */
  private drawHover(series: Series[], colors: ThemeColors, font: string): void {
    const mode = this.opts.hover ?? 'x';
    if (mode === false || !this.hoverPx || series.length === 0) return;
    const [hx, hy] = this.hoverPx;
    const { x: ax, y: ay, w: aw, h: ah } = this.area;
    if (hx < ax || hx > ax + aw || hy < ay || hy > ay + ah) return;
    const { ctx, opts } = this;
    const usable = (xv: number, yv: number) =>
      isFinite(xv) && isFinite(yv) && !(opts.xScale === 'log' && xv <= 0) && !(opts.yScale === 'log' && yv <= 0);

    // nearest sample per series: by abscissa in 'x' mode, by distance otherwise
    const hits: { s: Series; i: number; px: number; py: number; d: number }[] = [];
    for (const s of series) {
      const n = Math.min(s.x.length, s.y.length);
      let best = -1;
      let bestD = Infinity;
      let bpx = 0;
      let bpy = 0;
      for (let i = 0; i < n; i++) {
        const xv = Number(s.x[i]);
        const yv = Number(s.y[i]);
        if (!usable(xv, yv)) continue;
        const px = this.tx(xv);
        const py = this.ty(yv);
        const d = mode === 'x' ? Math.abs(px - hx) : Math.hypot(px - hx, py - hy);
        if (d < bestD) {
          bestD = d;
          best = i;
          bpx = px;
          bpy = py;
        }
      }
      // a series with no sample near the cursor (a clipped overlay) says nothing
      if (best >= 0 && bestD <= (mode === 'x' ? 12 : 40) && bpy >= ay && bpy <= ay + ah) {
        hits.push({ s, i: best, px: bpx, py: bpy, d: bestD });
      }
    }
    if (hits.length === 0) return;
    const shown = mode === 'x' ? hits : [hits.reduce((a, b) => (b.d < a.d ? b : a))];

    ctx.save();
    ctx.font = font;
    const cursorX = mode === 'x' ? shown[0].px : hx;
    if (mode === 'x') {
      ctx.strokeStyle = colors.axis;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(cursorX, ay);
      ctx.lineTo(cursorX, ay + ah);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const h of shown) {
      ctx.fillStyle = colors.surface;
      ctx.beginPath();
      ctx.arc(h.px, h.py, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = h.s.color ?? colors.fg;
      ctx.beginPath();
      ctx.arc(h.px, h.py, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    const xName = quantityOf(opts.xLabel, 'x');
    const yName = quantityOf(opts.yLabel, 'y');
    const lines: { text: string; color?: string }[] = [
      { text: `${xName} = ${formatValue(Number(shown[0].s.x[shown[0].i]))}` },
      ...shown.slice(0, 5).map((h) => ({
        text: `${shown.length > 1 && h.s.label ? h.s.label : yName} = ${formatValue(Number(h.s.y[h.i]))}`,
        color: h.s.color,
      })),
    ];
    const lh = 16;
    const bw = Math.max(...lines.map((l) => ctx.measureText(l.text).width)) + (shown.length > 1 ? 30 : 16);
    const bh = lines.length * lh + 8;
    const anchorY = mode === 'x' ? hy : shown[0].py;
    let bx = cursorX + 12;
    if (bx + bw > ax + aw) bx = cursorX - 12 - bw;
    bx = Math.max(ax + 2, bx);
    const by = Math.min(ay + ah - bh - 2, Math.max(ay + 2, anchorY - bh - 8));
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = colors.surface;
    ctx.fillRect(bx, by, bw, bh);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = colors.axis;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    lines.forEach((l, k) => {
      const y = by + 4 + k * lh + lh / 2;
      let tx = bx + 8;
      if (shown.length > 1 && k > 0) {
        ctx.fillStyle = l.color ?? colors.fg;
        ctx.fillRect(bx + 8, y - 1, 12, 2);
        tx = bx + 26;
      }
      ctx.fillStyle = colors.fg;
      ctx.fillText(l.text, tx, y);
    });
    ctx.restore();
  }
}
