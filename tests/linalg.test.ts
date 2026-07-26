import { describe, expect, it } from 'vitest';
import { nnls, solveBlockTridiagonal, solveDense, solveTridiagonal } from '../src/lib/linalg';

describe('solveTridiagonal', () => {
  it('solves a known system exactly', () => {
    // [2 1 0; 1 2 1; 0 1 2] x = [4; 8; 8] -> x = [1; 2; 3]
    const a = Float64Array.from([0, 1, 1]);
    const b = Float64Array.from([2, 2, 2]);
    const c = Float64Array.from([1, 1, 0]);
    const d = Float64Array.from([4, 8, 8]);
    const x = solveTridiagonal(a, b, c, d);
    expect(x[0]).toBeCloseTo(1, 12);
    expect(x[1]).toBeCloseTo(2, 12);
    expect(x[2]).toBeCloseTo(3, 12);
  });

  it('matches a dense solve on a random diagonally dominant system', () => {
    const n = 50;
    const a = new Float64Array(n);
    const b = new Float64Array(n);
    const c = new Float64Array(n);
    const d = new Float64Array(n);
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < n; i++) {
      a[i] = i > 0 ? -rand() : 0;
      c[i] = i < n - 1 ? -rand() : 0;
      b[i] = 3 + rand();
      d[i] = rand() * 2 - 1;
    }
    const x = solveTridiagonal(a, b, c, d);
    // verify residual
    for (let i = 0; i < n; i++) {
      let r = b[i] * x[i] - d[i];
      if (i > 0) r += a[i] * x[i - 1];
      if (i < n - 1) r += c[i] * x[i + 1];
      expect(Math.abs(r)).toBeLessThan(1e-10);
    }
  });
});

describe('solveDense', () => {
  it('solves with partial pivoting where naive elimination would fail', () => {
    // leading zero pivot forces a row swap
    const A = Float64Array.from([0, 1, 1, 0]);
    const b = Float64Array.from([2, 3]);
    const x = solveDense(A, b);
    expect(x[0]).toBeCloseTo(3, 12);
    expect(x[1]).toBeCloseTo(2, 12);
  });
});

describe('solveBlockTridiagonal', () => {
  it('reduces to scalar Thomas for 1x1 blocks', () => {
    const n = 20;
    const A = [] as Float64Array[];
    const B = [] as Float64Array[];
    const C = [] as Float64Array[];
    const a = new Float64Array(n);
    const bDiag = new Float64Array(n);
    const cSup = new Float64Array(n);
    const d = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      a[i] = i > 0 ? -1 : 0;
      bDiag[i] = 2.5;
      cSup[i] = i < n - 1 ? -1 : 0;
      d[i] = Math.sin(i);
      A.push(Float64Array.from([a[i]]));
      B.push(Float64Array.from([bDiag[i]]));
      C.push(Float64Array.from([cSup[i]]));
    }
    const xBlock = solveBlockTridiagonal(A, B, C, d, 1);
    const xScalar = solveTridiagonal(a, bDiag, cSup, d);
    for (let i = 0; i < n; i++) expect(xBlock[i]).toBeCloseTo(xScalar[i], 10);
  });

  it('solves a 3x3-block system against a manufactured solution', () => {
    const n = 8;
    const m = 3;
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648 - 0.5;
    };
    const A: Float64Array[] = [];
    const B: Float64Array[] = [];
    const C: Float64Array[] = [];
    for (let i = 0; i < n; i++) {
      const mk = (dom: number) => {
        const blk = new Float64Array(m * m);
        for (let k = 0; k < m * m; k++) blk[k] = rand();
        for (let k = 0; k < m; k++) blk[k * m + k] += dom;
        return blk;
      };
      A.push(i > 0 ? mk(0) : new Float64Array(m * m));
      B.push(mk(8)); // diagonally dominant blocks
      C.push(i < n - 1 ? mk(0) : new Float64Array(m * m));
    }
    const xTrue = new Float64Array(n * m);
    for (let i = 0; i < n * m; i++) xTrue[i] = Math.cos(i * 0.7);
    // d = T x
    const d = new Float64Array(n * m);
    for (let i = 0; i < n; i++) {
      for (let r = 0; r < m; r++) {
        let s = 0;
        for (let k = 0; k < m; k++) {
          s += B[i][r * m + k] * xTrue[i * m + k];
          if (i > 0) s += A[i][r * m + k] * xTrue[(i - 1) * m + k];
          if (i < n - 1) s += C[i][r * m + k] * xTrue[(i + 1) * m + k];
        }
        d[i * m + r] = s;
      }
    }
    const x = solveBlockTridiagonal(A, B, C, d, m);
    for (let i = 0; i < n * m; i++) expect(x[i]).toBeCloseTo(xTrue[i], 8);
  });
});

describe('nnls', () => {
  it('matches unconstrained least squares when the solution is positive', () => {
    // A x = b with exact positive solution x = [1, 2]
    const A = Float64Array.from([1, 0, 0, 1, 1, 1]);
    const b = Float64Array.from([1, 2, 3]);
    const x = nnls(A, b, 3, 2);
    expect(x[0]).toBeCloseTo(1, 8);
    expect(x[1]).toBeCloseTo(2, 8);
  });

  it('clamps to zero when the unconstrained solution is negative', () => {
    // min ||[1;1] x1 + [1;-1] x2 - [1; 2]||: unconstrained x2 < 0
    const A = Float64Array.from([1, 1, 1, -1]);
    const b = Float64Array.from([1, 2]);
    const x = nnls(A, b, 2, 2);
    expect(x[1]).toBe(0);
    expect(x[0]).toBeCloseTo(1.5, 8);
  });

  it('recovers a sparse non-negative spike train', () => {
    // dictionary of Gaussian bumps; ground truth uses bumps 3 and 12
    const nCols = 20;
    const mRows = 60;
    const A = new Float64Array(mRows * nCols);
    for (let i = 0; i < mRows; i++) {
      for (let j = 0; j < nCols; j++) {
        const center = (j / (nCols - 1)) * (mRows - 1);
        A[i * nCols + j] = Math.exp(-((i - center) ** 2) / 18);
      }
    }
    const xTrue = new Float64Array(nCols);
    xTrue[3] = 2;
    xTrue[12] = 0.7;
    const b = new Float64Array(mRows);
    for (let i = 0; i < mRows; i++) {
      for (let j = 0; j < nCols; j++) b[i] += A[i * nCols + j] * xTrue[j];
    }
    const x = nnls(A, b, mRows, nCols);
    let err = 0;
    for (let i = 0; i < mRows; i++) {
      let s = 0;
      for (let j = 0; j < nCols; j++) s += A[i * nCols + j] * x[j];
      err += (s - b[i]) ** 2;
    }
    expect(Math.sqrt(err)).toBeLessThan(1e-6);
    for (const v of x) expect(v).toBeGreaterThanOrEqual(0);
  });
});
