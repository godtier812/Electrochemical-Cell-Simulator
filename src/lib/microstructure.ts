/**
 * Stochastic 2D porous-electrode microstructure:
 *  - random sequential adsorption (RSA) of polydisperse disks = solid phase
 *  - porosity measured by pixel count
 *  - effective transport by a steady Laplace solve through the pore phase
 *    (u = 1 at inlet, u = 0 at outlet, insulating solid), conjugate gradient
 *  - tortuosity τ = ε D0/D_eff compared against Bruggeman D_eff = D0 ε^1.5
 */

export interface Microstructure {
  nx: number;
  ny: number;
  /** 1 = pore, 0 = solid */
  pore: Uint8Array;
  porosity: number;
  disks: { x: number; y: number; r: number }[];
}

export interface RSAParams {
  nx: number;
  ny: number;
  /** target solid fraction (1 − porosity) */
  solidFraction: number;
  /** mean particle radius in pixels */
  radius: number;
  /** relative polydispersity, 0–0.6 */
  spread: number;
  /** RNG in [0,1); pass a seeded generator for reproducible figures */
  rng?: () => number;
  /** max insertion attempts */
  maxAttempts?: number;
}

export function generateRSA(p: RSAParams): Microstructure {
  const { nx, ny } = p;
  const rng = p.rng ?? Math.random;
  const pore = new Uint8Array(nx * ny).fill(1);
  const disks: { x: number; y: number; r: number }[] = [];
  const targetSolid = Math.round(p.solidFraction * nx * ny);
  let solid = 0;
  const maxAttempts = p.maxAttempts ?? 40000;
  let attempts = 0;
  while (solid < targetSolid && attempts < maxAttempts) {
    attempts++;
    const r = Math.max(2, p.radius * (1 + p.spread * (2 * rng() - 1)));
    const cx = rng() * nx;
    const cy = rng() * ny;
    // RSA: reject overlap with existing disks
    let overlaps = false;
    for (const d of disks) {
      const dx = Math.min(Math.abs(cx - d.x), nx - Math.abs(cx - d.x)); // periodic in x
      const dy = cy - d.y;
      if (dx * dx + dy * dy < (r + d.r) * (r + d.r)) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;
    disks.push({ x: cx, y: cy, r });
    // rasterise (periodic in x, clipped in y)
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(ny - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      const half = Math.sqrt(Math.max(0, r * r - (y - cy) * (y - cy)));
      const x0 = Math.floor(cx - half);
      const x1 = Math.ceil(cx + half);
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) {
          const xi = ((x % nx) + nx) % nx;
          const idx = y * nx + xi;
          if (pore[idx]) {
            pore[idx] = 0;
            solid++;
          }
        }
      }
    }
  }
  return { nx, ny, pore, porosity: 1 - solid / (nx * ny), disks };
}

export interface TransportResult {
  /** potential field in pore phase (NaN in solid) */
  u: Float64Array;
  /** measured D_eff/D0 through the sample */
  deffRatio: number;
  /** tortuosity τ = ε / (D_eff/D0) */
  tortuosity: number;
  /** Bruggeman prediction D_eff/D0 = ε^1.5 */
  bruggemanRatio: number;
  converged: boolean;
  /** true when no percolating pore path connects inlet to outlet */
  blocked: boolean;
}

/**
 * Steady Laplace solve in the pore phase, flow along +x: u(0,·)=1, u(nx−1,·)=0,
 * zero-flux on solid boundaries and at y walls. Preconditioned (Jacobi) CG on
 * the masked 5-point stencil.
 */
export function solveTransport(ms: Microstructure, maxIter = 4000): TransportResult {
  const { nx, ny, pore, porosity } = ms;
  const n = nx * ny;
  const isUnknown = new Uint8Array(n); // pore cells excluding Dirichlet columns
  for (let y = 0; y < ny; y++) {
    for (let x = 1; x < nx - 1; x++) {
      if (pore[y * nx + x]) isUnknown[y * nx + x] = 1;
    }
  }
  /**
   * Dirichlet value for the two fixed columns. It depends only on which column
   * you are in, because both walls are held uniform along y: u(0,·) = 1 at the
   * inlet, u(nx−1,·) = 0 at the outlet. The other boundaries are no-flux and
   * are handled where the stencil is assembled — a y-wall or solid neighbour is
   * skipped rather than coupled, which is exactly a zero-flux condition — so
   * there is no y-dependence for this function to carry.
   */
  const bnd = (x: number): number => (x <= 0 ? 1 : 0);

  // matrix-vector product for masked Laplacian (negative definite form: A = -L)
  const apply = (v: Float64Array, out: Float64Array): void => {
    for (let y = 0; y < ny; y++) {
      for (let x = 1; x < nx - 1; x++) {
        const i = y * nx + x;
        if (!isUnknown[i]) {
          out[i] = 0;
          continue;
        }
        let diag = 0;
        let sum = 0;
        // neighbours: pore → coupled; Dirichlet column → contributes diag only
        // solid or y-wall → no flux (skip)
        const nb = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ];
        for (const [xn, yn] of nb) {
          if (yn < 0 || yn >= ny) continue;
          const j = yn * nx + xn;
          if (!pore[j]) continue;
          diag++;
          if (isUnknown[j]) sum += v[j];
          // Dirichlet neighbours handled in rhs
        }
        out[i] = diag * v[i] - sum;
      }
    }
  };

  // rhs from Dirichlet columns
  const b = new Float64Array(n);
  for (let y = 0; y < ny; y++) {
    for (const x of [1, nx - 2]) {
      const i = y * nx + x;
      if (!isUnknown[i]) continue;
      const xn = x === 1 ? 0 : nx - 1;
      const j = y * nx + xn;
      if (pore[j]) b[i] += bnd(xn);
    }
  }

  const u = new Float64Array(n);
  const r = new Float64Array(n);
  const z = new Float64Array(n);
  const pv = new Float64Array(n);
  const Ap = new Float64Array(n);

  // diag for Jacobi preconditioner
  const diag = new Float64Array(n);
  for (let y = 0; y < ny; y++) {
    for (let x = 1; x < nx - 1; x++) {
      const i = y * nx + x;
      if (!isUnknown[i]) continue;
      let d = 0;
      const nb = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ];
      for (const [xn, yn] of nb) {
        if (yn < 0 || yn >= ny) continue;
        if (pore[yn * nx + xn]) d++;
      }
      diag[i] = d || 1;
    }
  }

  apply(u, Ap);
  let rz = 0;
  for (let i = 0; i < n; i++) {
    if (!isUnknown[i]) continue;
    r[i] = b[i] - Ap[i];
    z[i] = r[i] / diag[i];
    pv[i] = z[i];
    rz += r[i] * z[i];
  }
  let converged = rz < 1e-20;
  const b2 = Math.max(1e-30, dotMasked(b, b, isUnknown));
  for (let it = 0; it < maxIter && !converged; it++) {
    apply(pv, Ap);
    const pAp = dotMasked(pv, Ap, isUnknown);
    if (pAp <= 0) break;
    const alpha = rz / pAp;
    let rz2 = 0;
    for (let i = 0; i < n; i++) {
      if (!isUnknown[i]) continue;
      u[i] += alpha * pv[i];
      r[i] -= alpha * Ap[i];
      z[i] = r[i] / diag[i];
      rz2 += r[i] * z[i];
    }
    if (dotMasked(r, r, isUnknown) / b2 < 1e-12) {
      converged = true;
      break;
    }
    const beta = rz2 / rz;
    rz = rz2;
    for (let i = 0; i < n; i++) {
      if (!isUnknown[i]) continue;
      pv[i] = z[i] + beta * pv[i];
    }
  }

  // fill Dirichlet columns for rendering / flux measurement
  const field = new Float64Array(n).fill(NaN);
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const i = y * nx + x;
      if (!pore[i]) continue;
      if (x === 0) field[i] = 1;
      else if (x === nx - 1) field[i] = 0;
      else field[i] = u[i];
    }
  }

  // flux through mid-plane; empty-domain reference flux = ny · (1/(nx−1))
  let flux = 0;
  const xm = Math.floor(nx / 2);
  for (let y = 0; y < ny; y++) {
    const iL = y * nx + xm - 1;
    const iR = y * nx + xm;
    if (pore[iL] && pore[iR]) flux += field[iL] - field[iR];
  }
  const fluxEmpty = ny / (nx - 1);
  const deffRatio = Math.max(0, flux / fluxEmpty);
  const blocked = deffRatio < 1e-6;
  return {
    u: field,
    deffRatio,
    tortuosity: blocked ? Infinity : porosity / deffRatio,
    bruggemanRatio: Math.pow(porosity, 1.5),
    converged,
    blocked,
  };
}

function dotMasked(a: Float64Array, b: Float64Array, mask: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) if (mask[i]) s += a[i] * b[i];
  return s;
}

/** Trace a streamline of −∇u from (x0,y0) by RK2; returns polyline points. */
export function streamline(
  ms: Microstructure,
  field: Float64Array,
  x0: number,
  y0: number,
  maxSteps = 4000
): { x: number; y: number }[] {
  const { nx, ny, pore } = ms;
  const grad = (x: number, y: number): [number, number] | null => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    if (xi < 1 || xi >= nx - 1 || yi < 1 || yi >= ny - 1) return null;
    const i = yi * nx + xi;
    if (!pore[i]) return null;
    const uc = field[i];
    const ux1 = pore[i + 1] ? field[i + 1] : uc;
    const ux0 = pore[i - 1] ? field[i - 1] : uc;
    const uy1 = pore[i + nx] ? field[i + nx] : uc;
    const uy0 = pore[i - nx] ? field[i - nx] : uc;
    return [-(ux1 - ux0) / 2, -(uy1 - uy0) / 2];
  };
  const pts: { x: number; y: number }[] = [{ x: x0, y: y0 }];
  let x = x0;
  let y = y0;
  for (let s = 0; s < maxSteps; s++) {
    const g1 = grad(x, y);
    if (!g1) break;
    const m1 = Math.hypot(g1[0], g1[1]);
    if (m1 < 1e-9) break;
    const hx = x + (g1[0] / m1) * 0.75;
    const hy = y + (g1[1] / m1) * 0.75;
    const g2 = grad(hx, hy) ?? g1;
    const m2 = Math.hypot(g2[0], g2[1]);
    if (m2 < 1e-9) break;
    x += (g2[0] / m2) * 1.5;
    y += (g2[1] / m2) * 1.5;
    pts.push({ x, y });
    if (x >= nx - 1.5) break;
  }
  return pts;
}

/** Small deterministic RNG (mulberry32) for reproducible posters/figures. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
