/**
 * Reading impedance data that people actually have: a text file or a pasted
 * block with one row per frequency. Pure and DOM-free.
 *
 * What it handles, because these are the shapes instrument exports and
 * spreadsheets take:
 *   - comma, semicolon, tab or whitespace separated columns;
 *   - an optional header row, used to find the columns by name;
 *   - decimal commas (when the separator is not itself a comma);
 *   - comment lines starting with #, %, ! or //, and blank lines;
 *   - an imaginary column stored either as Z″ (negative for a capacitive
 *     cell) or already negated as −Z″, which is how Nyquist plots are drawn
 *     and how several instruments export it.
 *
 * What it does not do: read binary or vendor-specific project files, or guess
 * units. Frequencies are taken to be in Hz and impedances in ohms (or Ω·cm²);
 * the inversion is linear in Z, so a consistent other unit only relabels the
 * axes.
 */
import type { C } from './complex';

export interface EisColumns {
  /** Zero-based column indices. */
  freq: number;
  re: number;
  im: number;
  /** True when the imaginary column holds −Z″ and must be negated on read. */
  imNegated: boolean;
}

export interface EisData {
  /** Frequency in Hz, sorted ascending. */
  freq: Float64Array;
  /** Angular frequency 2πf, same order. */
  omega: Float64Array;
  /** Complex impedance with the physical sign: Im Z < 0 for a capacitive response. */
  Z: C[];
}

export interface EisParse {
  data: EisData;
  columns: EisColumns;
  /** Header cells, when the file had a header row. */
  header: string[] | null;
  /** Number of columns in the data rows. */
  nColumns: number;
  /** Data rows that were skipped because a needed cell was not a number. */
  skipped: number;
  /** Things the user should know about how the file was read. */
  notes: string[];
}

export class EisParseError extends Error {}

/** sessionStorage key under which the impedance demo hands its spectrum to the analyser. */
export const EIS_HANDOFF_KEY = 'voltaire-eis-handoff';

const COMMENT = /^\s*(#|%|!|\/\/)/;

function splitRows(text: string): string[] {
  return text
    .split(/\r\n|\n|\r/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !COMMENT.test(l));
}

/** The separator that splits the most rows into the same number (≥ 2) of cells. */
function detectSeparator(rows: string[]): RegExp {
  const candidates: [string, RegExp][] = [
    ['tab', /\t/],
    ['semicolon', /;/],
    ['comma', /,/],
    ['space', /\s+/],
  ];
  let best = candidates[3][1];
  let bestScore = -1;
  for (const [, re] of candidates) {
    const counts = rows.slice(0, 40).map((r) => r.split(re).length);
    const mode = counts.sort((a, b) => a - b)[Math.floor(counts.length / 2)];
    if (mode < 2) continue;
    const score = counts.filter((c) => c === mode).length * 100 + mode;
    if (score > bestScore) {
      bestScore = score;
      best = re;
    }
  }
  return best;
}

function toNumber(cell: string, decimalComma: boolean): number {
  let t = cell.trim().replace(/^"|"$/g, '');
  if (decimalComma) t = t.replace(',', '.');
  // Unicode minus, which spreadsheets and typeset tables both produce
  t = t.replace(/−/g, '-');
  if (t === '') return NaN;
  return Number(t);
}

function classifyHeader(cell: string): 'freq' | 're' | 'im' | 'negim' | null {
  const h = cell
    .toLowerCase()
    .replace(/[″“”"]/g, "''")
    .replace(/[′’`]/g, "'")
    .replace(/−/g, '-')
    .replace(/\s+/g, '');
  if (/^(f|freq|frequency)([^a-z]|$)/.test(h) || h.startsWith('freq')) return 'freq';
  const negated = /^-/.test(h) || h.includes("-z''") || h.includes('-im') || h.includes('-zim') || h.includes('negim');
  if (h.includes("z''") || /(^|[^a-z])(zim|zimag|im\(z\)|imz|imag|zi|z_im|z_imag|zimg)([^a-z]|$)/.test(h) || h.includes('imag')) {
    return negated ? 'negim' : 'im';
  }
  if (h.includes("z'") || /(^|[^a-z])(zre|zreal|re\(z\)|rez|real|zr|z_re|z_real)([^a-z]|$)/.test(h) || h.includes('real')) {
    return 're';
  }
  return null;
}

/**
 * Parse a block of text into a spectrum. `override` forces the column
 * assignment, for when the guess is wrong; pass what `columns` reported with
 * the fields changed.
 */
export function parseEis(text: string, override?: Partial<EisColumns>): EisParse {
  const rows = splitRows(text);
  if (rows.length < 3) throw new EisParseError('Need at least three rows of data: frequency, Z′ and Z″ on each.');
  const sep = detectSeparator(rows);
  const cells = rows.map((r) => r.split(sep).map((c) => c.trim()));
  // decimal commas are only possible when the comma is not the separator
  const decimalComma = sep.source !== ',' && rows.some((r) => /\d,\d/.test(r)) && !rows.some((r) => /\d\.\d/.test(r));
  const notes: string[] = [];
  if (decimalComma) notes.push('Read commas as decimal points.');

  const isNumericRow = (row: string[]) => row.length >= 2 && row.every((c) => c === '' || isFinite(toNumber(c, decimalComma)));
  let header: string[] | null = null;
  let start = 0;
  // skip any leading non-numeric lines; the last of them is taken as the header
  while (start < cells.length && !isNumericRow(cells[start])) {
    header = cells[start];
    start++;
  }
  const body = cells.slice(start);
  if (body.length < 3) throw new EisParseError('Found fewer than three numeric rows.');
  const nColumns = Math.max(...body.map((r) => r.length));
  if (nColumns < 3) {
    throw new EisParseError('Need three columns: frequency, the real part and the imaginary part of Z.');
  }

  // column assignment: header names first, then the conventional f, Z′, Z″ order
  let freq = 0;
  let re = 1;
  let im = 2;
  let negatedByHeader: boolean | null = null;
  if (header && header.length >= 3) {
    const kinds = header.map(classifyHeader);
    const fi = kinds.indexOf('freq');
    const ri = kinds.indexOf('re');
    const ii = kinds.findIndex((k) => k === 'im' || k === 'negim');
    if (fi >= 0 && ri >= 0 && ii >= 0) {
      freq = fi;
      re = ri;
      im = ii;
      negatedByHeader = kinds[ii] === 'negim';
    } else {
      notes.push('Could not match the header to frequency, Z′ and Z″; assumed that column order.');
    }
  }
  freq = override?.freq ?? freq;
  re = override?.re ?? re;
  im = override?.im ?? im;

  const fRaw: number[] = [];
  const reRaw: number[] = [];
  const imRaw: number[] = [];
  let skipped = 0;
  for (const row of body) {
    const f = toNumber(row[freq] ?? '', decimalComma);
    const a = toNumber(row[re] ?? '', decimalComma);
    const b = toNumber(row[im] ?? '', decimalComma);
    if (!isFinite(f) || !isFinite(a) || !isFinite(b) || f <= 0) {
      skipped++;
      continue;
    }
    fRaw.push(f);
    reRaw.push(a);
    imRaw.push(b);
  }
  if (fRaw.length < 3) throw new EisParseError('Fewer than three rows had a positive frequency and two numeric impedance values.');
  if (skipped > 0) notes.push(`Skipped ${skipped} row${skipped === 1 ? '' : 's'} with a missing or non-numeric value.`);

  // Sign convention. An electrochemical cell is capacitive over almost all of
  // a spectrum, so Im Z is mostly negative. A column that is mostly positive
  // is therefore almost certainly −Z″, unless the header says otherwise.
  const positive = imRaw.filter((v) => v > 0).length;
  const guessNegated = positive > imRaw.length / 2;
  const imNegated = override?.imNegated ?? negatedByHeader ?? guessNegated;
  if (override?.imNegated === undefined && negatedByHeader === null && guessNegated) {
    notes.push('The imaginary column is mostly positive, so it was read as −Z″.');
  }

  const order = fRaw.map((_, i) => i).sort((a, b) => fRaw[a] - fRaw[b]);
  const f = Float64Array.from(order, (i) => fRaw[i]);
  const Z: C[] = order.map((i) => ({ re: reRaw[i], im: imNegated ? -imRaw[i] : imRaw[i] }));
  return {
    data: { freq: f, omega: Float64Array.from(f, (v) => 2 * Math.PI * v), Z },
    columns: { freq, re, im, imNegated },
    header,
    nColumns,
    skipped,
    notes,
  };
}

/**
 * Indices of points with Im Z > 0: inductive behaviour (cables, cell windings)
 * or artefacts. The DRT model is a sum of RC relaxations, every one of which
 * has Im Z ≤ 0, so it cannot represent these points and they bias the fit if
 * left in.
 */
export function inductivePoints(Z: C[]): number[] {
  const out: number[] = [];
  Z.forEach((z, i) => {
    if (z.im > 0) out.push(i);
  });
  return out;
}

/** The spectrum without the listed points. */
export function dropPoints(data: EisData, drop: number[]): EisData {
  const gone = new Set(drop);
  const keep = [...data.freq.keys()].filter((i) => !gone.has(i));
  return {
    freq: Float64Array.from(keep, (i) => data.freq[i]),
    omega: Float64Array.from(keep, (i) => data.omega[i]),
    Z: keep.map((i) => data.Z[i]),
  };
}
