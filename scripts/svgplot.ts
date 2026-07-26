/**
 * Tiny SVG plot writer for the build-time poster fallbacks. Neutral greys for
 * furniture so the posters read on both themes; data colours come from the
 * same viridis/plasma tables as the live plots.
 */
export interface SvgSeries {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  color: string;
  width?: number;
  dash?: string;
}

export interface SvgPlotOpts {
  width: number;
  height: number;
  series: SvgSeries[];
  xLabel?: string;
  yLabel?: string;
  title?: string;
  xRange?: [number, number];
  yRange?: [number, number];
}

const AXIS = '#8a949e';
const GRID = '#8a949e33';

function niceTicks(min: number, max: number, target = 5): number[] {
  const span = max - min;
  if (span <= 0) return [min];
  const raw = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  let step = mag * 10;
  for (const m of [1, 2, 5, 10]) {
    if (mag * m >= raw) {
      step = mag * m;
      break;
    }
  }
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return out;
}

const fmt = (v: number): string => {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 10000 || a < 0.001) return v.toExponential(0).replace('+', '');
  return String(+v.toPrecision(3));
};

export function svgPlot(o: SvgPlotOpts): string {
  const ml = o.yLabel ? 52 : 40;
  const mb = o.xLabel ? 38 : 24;
  const mt = o.title ? 26 : 10;
  const mr = 12;
  const pw = o.width - ml - mr;
  const ph = o.height - mt - mb;

  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const s of o.series) {
    for (let i = 0; i < s.x.length; i++) {
      const xv = Number(s.x[i]);
      const yv = Number(s.y[i]);
      if (!isFinite(xv) || !isFinite(yv)) continue;
      x0 = Math.min(x0, xv);
      x1 = Math.max(x1, xv);
      y0 = Math.min(y0, yv);
      y1 = Math.max(y1, yv);
    }
  }
  if (o.xRange) [x0, x1] = o.xRange;
  if (o.yRange) [y0, y1] = o.yRange;
  const padY = (y1 - y0) * 0.05 || 1;
  if (!o.yRange) {
    y0 -= padY;
    y1 += padY;
  }
  const tx = (v: number) => ml + ((v - x0) / (x1 - x0)) * pw;
  const ty = (v: number) => mt + ph - ((v - y0) / (y1 - y0)) * ph;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${o.width} ${o.height}" font-family="'IBM Plex Mono', monospace" font-size="10">`
  );
  for (const v of niceTicks(x0, x1, 6)) {
    const p = tx(v);
    parts.push(`<line x1="${p.toFixed(1)}" y1="${mt}" x2="${p.toFixed(1)}" y2="${mt + ph}" stroke="${GRID}"/>`);
    parts.push(`<text x="${p.toFixed(1)}" y="${mt + ph + 14}" fill="${AXIS}" text-anchor="middle">${fmt(v)}</text>`);
  }
  for (const v of niceTicks(y0, y1, 5)) {
    const p = ty(v);
    parts.push(`<line x1="${ml}" y1="${p.toFixed(1)}" x2="${ml + pw}" y2="${p.toFixed(1)}" stroke="${GRID}"/>`);
    parts.push(`<text x="${ml - 5}" y="${(p + 3).toFixed(1)}" fill="${AXIS}" text-anchor="end">${fmt(v)}</text>`);
  }
  parts.push(`<rect x="${ml}" y="${mt}" width="${pw}" height="${ph}" fill="none" stroke="${AXIS}"/>`);
  for (const s of o.series) {
    const pts: string[] = [];
    let started = false;
    for (let i = 0; i < s.x.length; i++) {
      const xv = Number(s.x[i]);
      const yv = Number(s.y[i]);
      if (!isFinite(xv) || !isFinite(yv) || xv < x0 || xv > x1 || yv < y0 || yv > y1) {
        started = false;
        continue;
      }
      pts.push(`${started ? 'L' : 'M'}${tx(xv).toFixed(1)},${ty(yv).toFixed(1)}`);
      started = true;
    }
    parts.push(
      `<path d="${pts.join(' ')}" fill="none" stroke="${s.color}" stroke-width="${s.width ?? 2}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>`
    );
  }
  if (o.xLabel) {
    parts.push(`<text x="${ml + pw / 2}" y="${o.height - 6}" fill="${AXIS}" text-anchor="middle">${o.xLabel}</text>`);
  }
  if (o.yLabel) {
    parts.push(
      `<text transform="translate(12 ${mt + ph / 2}) rotate(-90)" fill="${AXIS}" text-anchor="middle">${o.yLabel}</text>`
    );
  }
  if (o.title) {
    parts.push(`<text x="${ml}" y="16" fill="${AXIS}" font-size="11" letter-spacing="1">${o.title}</text>`);
  }
  parts.push('</svg>');
  return parts.join('\n');
}
