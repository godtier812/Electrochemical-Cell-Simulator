/**
 * CSV building for the export buttons. Pure and DOM-free so it can be unit
 * tested: the demos hand over the arrays they just plotted, and what lands in
 * the file is exactly those numbers, at full double precision.
 */

export interface CsvColumn {
  name: string;
  values: ArrayLike<number | string>;
}

export interface CsvSeries {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  label?: string;
}

function cell(v: number | string): string {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Columns side by side. Shorter columns are padded with empty cells. */
export function columnsToCsv(cols: CsvColumn[]): string {
  const rows = Math.max(0, ...cols.map((c) => c.values.length));
  const lines = [cols.map((c) => cell(c.name)).join(',')];
  for (let i = 0; i < rows; i++) {
    lines.push(cols.map((c) => (i < c.values.length ? cell(c.values[i]) : '')).join(','));
  }
  return lines.join('\n') + '\n';
}

function sameAbscissa(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    // NaN marks a gap in a curve; two gaps in the same place still match
    if (a[i] !== b[i] && !(Number.isNaN(a[i]) && Number.isNaN(b[i]))) return false;
  }
  return true;
}

/**
 * Plotted series as a table. Series that share an abscissa become one wide
 * table (x, then one column per series); otherwise each series keeps its own
 * x column, side by side, so nothing is interpolated to make the rows line up.
 */
export function seriesToCsv(series: CsvSeries[], xName = 'x', yName = 'y'): string {
  if (series.length === 0) return `${cell(xName)}\n`;
  const names = series.map((s, i) => s.label ?? (series.length === 1 ? yName : `${yName} [${i + 1}]`));
  const shared = series.every((s) => sameAbscissa(s.x, series[0].x));
  if (shared) {
    return columnsToCsv([
      { name: xName, values: series[0].x },
      ...series.map((s, i) => ({ name: names[i], values: s.y })),
    ]);
  }
  return columnsToCsv(
    series.flatMap((s, i) => [
      { name: `${xName} (${names[i]})`, values: s.x },
      { name: names[i], values: s.y },
    ])
  );
}
