/**
 * Small dense/banded linear algebra used by the in-browser solvers.
 * No dependencies; everything operates on Float64Array.
 */

/**
 * Thomas algorithm for a tridiagonal system.
 * a: sub-diagonal (a[0] unused), b: diagonal, c: super-diagonal (c[n-1] unused), d: rhs.
 * Returns the solution; inputs are not modified.
 */
export function solveTridiagonal(
  a: Float64Array,
  b: Float64Array,
  c: Float64Array,
  d: Float64Array
): Float64Array {
  const n = b.length;
  const cp = new Float64Array(n);
  const dp = new Float64Array(n);
  const x = new Float64Array(n);
  let beta = b[0];
  if (beta === 0) throw new Error('solveTridiagonal: zero pivot at row 0');
  cp[0] = c[0] / beta;
  dp[0] = d[0] / beta;
  for (let i = 1; i < n; i++) {
    beta = b[i] - a[i] * cp[i - 1];
    if (beta === 0) throw new Error(`solveTridiagonal: zero pivot at row ${i}`);
    cp[i] = c[i] / beta;
    dp[i] = (d[i] - a[i] * dp[i - 1]) / beta;
  }
  x[n - 1] = dp[n - 1];
  for (let i = n - 2; i >= 0; i--) {
    x[i] = dp[i] - cp[i] * x[i + 1];
  }
  return x;
}

/**
 * Block-tridiagonal solve with m×m blocks (used by the coupled PNP Newton
 * update, m = 3: C+, C−, φ per node). A, B, C are arrays of n blocks stored
 * row-major (A[0] and C[n-1] unused); d is length n·m. Solves in-place copies
 * and returns x. Standard block Thomas with dense partial-pivot LU per block.
 */
export function solveBlockTridiagonal(
  A: Float64Array[],
  B: Float64Array[],
  C: Float64Array[],
  d: Float64Array,
  m: number
): Float64Array {
  const n = B.length;
  const Bw = B.map((blk) => blk.slice());
  const Cw = C.map((blk) => blk.slice());
  const dw = d.slice();

  // forward elimination
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      // B[i] -= A[i] * Cw[i-1];  d[i] -= A[i] * dprev
      const Ai = A[i];
      const Cp = Cw[i - 1];
      const Bi = Bw[i];
      for (let r = 0; r < m; r++) {
        for (let ccol = 0; ccol < m; ccol++) {
          let s = 0;
          for (let k = 0; k < m; k++) s += Ai[r * m + k] * Cp[k * m + ccol];
          Bi[r * m + ccol] -= s;
        }
        let s = 0;
        for (let k = 0; k < m; k++) s += Ai[r * m + k] * dw[(i - 1) * m + k];
        dw[i * m + r] -= s;
      }
    }
    // factor Bw[i], then Cw[i] = B^-1 C, dw_i = B^-1 d_i
    const { lu, piv } = luFactor(Bw[i], m);
    if (i < n - 1) {
      const Ci = Cw[i];
      const col = new Float64Array(m);
      for (let ccol = 0; ccol < m; ccol++) {
        for (let r = 0; r < m; r++) col[r] = Ci[r * m + ccol];
        luSolveFactored(lu, piv, col, m);
        for (let r = 0; r < m; r++) Ci[r * m + ccol] = col[r];
      }
    }
    const rhs = dw.subarray(i * m, (i + 1) * m);
    const tmp = Float64Array.from(rhs);
    luSolveFactored(lu, piv, tmp, m);
    rhs.set(tmp);
  }

  // back substitution: x_i = d_i - Cw[i] x_{i+1}
  for (let i = n - 2; i >= 0; i--) {
    const Ci = Cw[i];
    for (let r = 0; r < m; r++) {
      let s = 0;
      for (let k = 0; k < m; k++) s += Ci[r * m + k] * dw[(i + 1) * m + k];
      dw[i * m + r] -= s;
    }
  }
  return dw;
}

function luFactor(Ain: Float64Array, n: number): { lu: Float64Array; piv: Int32Array } {
  const lu = Ain.slice();
  const piv = new Int32Array(n);
  for (let i = 0; i < n; i++) piv[i] = i;
  for (let k = 0; k < n; k++) {
    let p = k;
    let maxv = Math.abs(lu[k * n + k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(lu[i * n + k]);
      if (v > maxv) {
        maxv = v;
        p = i;
      }
    }
    if (maxv === 0) throw new Error('luFactor: singular block');
    if (p !== k) {
      for (let j = 0; j < n; j++) {
        const t = lu[k * n + j];
        lu[k * n + j] = lu[p * n + j];
        lu[p * n + j] = t;
      }
      const t = piv[k];
      piv[k] = piv[p];
      piv[p] = t;
    }
    const pivot = lu[k * n + k];
    for (let i = k + 1; i < n; i++) {
      const f = (lu[i * n + k] /= pivot);
      for (let j = k + 1; j < n; j++) lu[i * n + j] -= f * lu[k * n + j];
    }
  }
  return { lu, piv };
}

function luSolveFactored(lu: Float64Array, piv: Int32Array, b: Float64Array, n: number): void {
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = b[piv[i]];
  for (let i = 1; i < n; i++) {
    let s = x[i];
    for (let j = 0; j < i; j++) s -= lu[i * n + j] * x[j];
    x[i] = s;
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = x[i];
    for (let j = i + 1; j < n; j++) s -= lu[i * n + j] * x[j];
    x[i] = s / lu[i * n + i];
  }
  b.set(x);
}

/** Dense partial-pivot LU solve of A x = b for small n. A is n×n row-major. */
export function solveDense(A: Float64Array, b: Float64Array): Float64Array {
  const n = b.length;
  const { lu, piv } = luFactor(A, n);
  const x = b.slice();
  luSolveFactored(lu, piv, x, n);
  return x;
}

/**
 * Non-negative least squares: min ‖Ax − b‖₂ subject to x ≥ 0.
 * Lawson–Hanson active-set algorithm operating on the normal equations
 * (adequate for the ~60-column DRT systems this site solves).
 * A is m×n row-major.
 */
export function nnls(
  A: Float64Array,
  b: Float64Array,
  m: number,
  n: number,
  opts: { maxIter?: number; tol?: number } = {}
): Float64Array {
  const maxIter = opts.maxIter ?? 3 * n;
  // Gram matrix and A'b
  const AtA = new Float64Array(n * n);
  const Atb = new Float64Array(n);
  for (let i = 0; i < m; i++) {
    const row = i * n;
    for (let j = 0; j < n; j++) {
      const aij = A[row + j];
      if (aij === 0) continue;
      Atb[j] += aij * b[i];
      for (let k = j; k < n; k++) AtA[j * n + k] += aij * A[row + k];
    }
  }
  for (let j = 0; j < n; j++) {
    for (let k = 0; k < j; k++) AtA[j * n + k] = AtA[k * n + j];
  }
  let maxDiag = 0;
  for (let j = 0; j < n; j++) maxDiag = Math.max(maxDiag, AtA[j * n + j]);
  const tol = opts.tol ?? 1e-10 * (maxDiag || 1);

  const x = new Float64Array(n);
  const passive: boolean[] = new Array(n).fill(false);
  const w = new Float64Array(n);

  const solvePassive = (): Float64Array | null => {
    const idx: number[] = [];
    for (let j = 0; j < n; j++) if (passive[j]) idx.push(j);
    const k = idx.length;
    if (k === 0) return new Float64Array(0);
    const M = new Float64Array(k * k);
    const rhs = new Float64Array(k);
    for (let a2 = 0; a2 < k; a2++) {
      rhs[a2] = Atb[idx[a2]];
      for (let b2 = 0; b2 < k; b2++) M[a2 * k + b2] = AtA[idx[a2] * n + idx[b2]];
      M[a2 * k + a2] += 1e-12 * (maxDiag || 1); // guards near-singular subsets
    }
    try {
      return solveDense(M, rhs);
    } catch {
      return null;
    }
  };

  for (let iter = 0; iter < maxIter; iter++) {
    // w = A'(b − Ax) = Atb − AtA x
    for (let j = 0; j < n; j++) {
      let s = Atb[j];
      for (let k = 0; k < n; k++) s -= AtA[j * n + k] * x[k];
      w[j] = s;
    }
    let best = -1;
    let bestW = tol;
    for (let j = 0; j < n; j++) {
      if (!passive[j] && w[j] > bestW) {
        bestW = w[j];
        best = j;
      }
    }
    if (best < 0) break; // KKT satisfied
    passive[best] = true;

    // inner loop: keep passive-set solution feasible
    for (;;) {
      const idx: number[] = [];
      for (let j = 0; j < n; j++) if (passive[j]) idx.push(j);
      const z = solvePassive();
      if (z === null) {
        passive[best] = false;
        break;
      }
      let allPositive = true;
      for (let a2 = 0; a2 < idx.length; a2++) {
        if (z[a2] <= 0) {
          allPositive = false;
          break;
        }
      }
      if (allPositive) {
        x.fill(0);
        for (let a2 = 0; a2 < idx.length; a2++) x[idx[a2]] = z[a2];
        break;
      }
      // step toward z until the first variable hits zero
      let alpha = Infinity;
      for (let a2 = 0; a2 < idx.length; a2++) {
        if (z[a2] <= 0) {
          const xi = x[idx[a2]];
          const denom = xi - z[a2];
          if (denom > 0) alpha = Math.min(alpha, xi / denom);
        }
      }
      if (!isFinite(alpha)) alpha = 0;
      for (let a2 = 0; a2 < idx.length; a2++) {
        const j = idx[a2];
        x[j] += alpha * (z[a2] - x[j]);
        if (x[j] <= tol * 1e-2) {
          x[j] = 0;
          passive[j] = false;
        }
      }
    }
  }
  return x;
}
