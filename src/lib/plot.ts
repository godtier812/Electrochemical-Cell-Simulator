/**
 * Minimal canvas plotting: framed axes with inward ticks, linear/log scales,
 * legends, dashed lines, markers, annotations, equal-aspect mode (Nyquist),
 * and device-pixel-ratio aware rendering. Colours come from the page theme
 * via CSS custom properties, so plots re-render correctly in both themes.
 */

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
  legend?: 'tl' | 'tr' | 'bl' | 'br' | 'none';
  /** extra fractional padding applied to auto ranges */
  pad?: number;
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

export function formatTick(v: number): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 10000 || a < 0.001) {
    const e = Math.floor(Math.log10(a));
    const mant = v / Math.pow(10, e);
    const m = Math.abs(mant - 1) < 1e-9 ? '' : `${+mant.toPrecision(3)}×`;
    return `${m}1e${e}`;
  }
  return String(+v.toPrecision(4));
}

export class Plot {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private opts: PlotOptions;
  private area = { x: 0, y: 0, w: 1, h: 1 };
  private range = { x0: 0, x1: 1, y0: 0, y1: 1 };
  private lastSeries: Series[] = [];
  private lastAnnotations: Annotation[] = [];
  private themeHandler: () => void;

  constructor(canvas: HTMLCanvasElement, opts: PlotOptions = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.opts = opts;
    this.themeHandler = () => this.redraw();
    addEventListener('voltaire-theme', this.themeHandler);
  }

  dispose(): void {
    removeEventListener('voltaire-theme', this.themeHandler);
  }

  setOptions(partial: Partial<PlotOptions>): void {
    Object.assign(this.opts, partial);
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

  draw(series: Series[], annotations: Annotation[] = []): void {
    this.lastSeries = series;
    this.lastAnnotations = annotations;
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
    const ml = opts.yLabel ? 58 : 44;
    const mb = opts.xLabel ? 40 : 26;
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

    const font = '11px "IBM Plex Mono", monospace';
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
        // label
        ctx.fillStyle = colors.axis;
        if (axis === 'x') {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(formatTick(v), p, this.area.y + this.area.h + 5);
        } else {
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText(formatTick(v), this.area.x - 6, p);
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
      if (s.fill) {
        ctx.globalAlpha = 0.25;
        ctx.beginPath();
        const yZero = this.ty(Math.max(this.range.y0, 0));
        ctx.moveTo(this.tx(Number(s.x[0])), yZero);
        for (let i = 0; i < n; i++) ctx.lineTo(this.tx(Number(s.x[i])), this.ty(Number(s.y[i])));
        ctx.lineTo(this.tx(Number(s.x[n - 1])), yZero);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }
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
    }
    ctx.restore();

    // legend
    const labelled = series.filter((s) => s.label);
    const legendPos = opts.legend ?? (labelled.length > 1 ? 'tr' : 'none');
    if (legendPos !== 'none' && labelled.length > 0) {
      ctx.font = font;
      const lh = 16;
      const wMax = Math.max(...labelled.map((s) => ctx.measureText(s.label!).width));
      const bw = wMax + 34;
      const bh = labelled.length * lh + 8;
      const bx =
        legendPos === 'tl' || legendPos === 'bl'
          ? this.area.x + 8
          : this.area.x + this.area.w - bw - 8;
      const by =
        legendPos === 'tl' || legendPos === 'tr'
          ? this.area.y + 8
          : this.area.y + this.area.h - bh - 8;
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
        ctx.beginPath();
        ctx.moveTo(bx + 6, y);
        ctx.lineTo(bx + 24, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = colors.fg;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(s.label!, bx + 30, y);
      });
    }
  }
}
