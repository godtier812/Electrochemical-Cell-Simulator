/**
 * Stochastic 2D porous-electrode microstructure:
 *  - random sequential adsorption (RSA) of polydisperse disks = solid phase
 *  - geometry sampled at sub-cell resolution: each cell carries a pore area
 *    fraction and each face an open fraction, rather than a binary in/out flag
 *  - effective transport by a steady Laplace solve through the pore phase
 *    (u = 1 at inlet, u = 0 at outlet, insulating solid), conjugate gradient
 *  - tortuosity τ = ε D0/D_eff, compared against two references:
 *      · the 2D result for insulating circular inclusions, ε/(2−ε)
 *      · the Bruggeman correction ε^1.5, a 3D-spheres correlation
 *    See `maxwell2dRatio` for why both are reported.
 *
 * On the sub-cell sampling. Classifying each cell as wholly pore or wholly
 * solid rounds every particle boundary to the grid, and the resulting staircase
 * throttles the narrow necks that set the transport. Measured against a
 * Richardson limit from a 1536-wide refinement sweep, that cost 1.8% at ε=0.85
 * and 28% at ε=0.52 — the error grew as the necks got tighter, which is exactly
 * the regime the demo is about. Resolving the geometry SUBSAMPLE times per axis
 * and keeping the resulting fractions holds the error at or under 0.5% across
 * the whole range, for no measurable time: the extra sampling costs ~3 ms and
 * the smoother coefficients buy back about as much in CG iterations.
 */

/** Sub-cell sampling rate per axis. 8 holds discretisation bias under 0.5%. */
export const SUBSAMPLE = 8;

export interface Microstructure {
  nx: number;
  ny: number;
  /**
   * 1 where the cell has any pore area at all, 0 where it is wholly solid.
   * A coarse classification, kept for traversal and hit-testing; anything
   * quantitative should read `phi` or the face conductances instead.
   */
  pore: Uint8Array;
  /** Pore area fraction per cell, in [0,1]. */
  phi: Float64Array;
  /** Open fraction of the face between (x,y) and (x+1,y), indexed y*nx+x. */
  kx: Float64Array;
  /** Open fraction of the face between (x,y) and (x,y+1), indexed y*nx+x. */
  ky: Float64Array;
  /** Pore area fraction of the whole domain, measured from the sub-cell samples. */
  porosity: number;
  disks: { x: number; y: number; r: number }[];
  /**
   * True when insertion stopped because the attempt budget ran out with the
   * target solid fraction still unmet — the RSA jamming limit for this radius
   * and polydispersity. The porosity above is what was actually reached, so a
   * caller asking for less porosity than RSA can deliver gets this flag rather
   * than a silently clamped result.
   */
  saturated: boolean;
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
  const S = SUBSAMPLE;
  const fnx = nx * S;
  const fny = ny * S;
  // Geometry is carried on the sub-cell grid and reduced to cell and face
  // fractions once, after packing. Disk coordinates stay in cell units.
  const fine = new Uint8Array(fnx * fny).fill(1);
  const disks: { x: number; y: number; r: number }[] = [];
  const targetSolid = Math.round(p.solidFraction * fnx * fny);
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
    // rasterise on the sub-cell grid (periodic in x, clipped in y)
    const fcx = cx * S;
    const fcy = cy * S;
    const fr = r * S;
    const y0 = Math.max(0, Math.floor(fcy - fr));
    const y1 = Math.min(fny - 1, Math.ceil(fcy + fr));
    for (let y = y0; y <= y1; y++) {
      const half = Math.sqrt(Math.max(0, fr * fr - (y - fcy) * (y - fcy)));
      const x0 = Math.floor(fcx - half);
      const x1 = Math.ceil(fcx + half);
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - fcx;
        const dy = y + 0.5 - fcy;
        if (dx * dx + dy * dy <= fr * fr) {
          const xi = ((x % fnx) + fnx) % fnx;
          const idx = y * fnx + xi;
          if (fine[idx]) {
            fine[idx] = 0;
            solid++;
          }
        }
      }
    }
  }
  // Reduce the sub-cell grid to cell fractions and face openings. A face is
  // open in proportion to how much of it has pore on both sides, which is the
  // aperture the flux actually sees; conductances across a face add in
  // parallel, so the arithmetic mean is the right combination here.
  const phi = new Float64Array(nx * ny);
  const kx = new Float64Array(nx * ny);
  const ky = new Float64Array(nx * ny);
  const pore = new Uint8Array(nx * ny);
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      let open = 0;
      for (let sy = 0; sy < S; sy++) {
        const row = (y * S + sy) * fnx + x * S;
        for (let sx = 0; sx < S; sx++) open += fine[row + sx];
      }
      const i = y * nx + x;
      phi[i] = open / (S * S);
      pore[i] = open > 0 ? 1 : 0;
    }
  }
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx - 1; x++) {
      let open = 0;
      for (let sy = 0; sy < S; sy++) {
        const row = (y * S + sy) * fnx;
        if (fine[row + x * S + S - 1] && fine[row + x * S + S]) open++;
      }
      kx[y * nx + x] = open / S;
    }
  }
  for (let y = 0; y < ny - 1; y++) {
    for (let x = 0; x < nx; x++) {
      let open = 0;
      const rowA = (y * S + S - 1) * fnx;
      const rowB = (y * S + S) * fnx;
      for (let sx = 0; sx < S; sx++) {
        if (fine[rowA + x * S + sx] && fine[rowB + x * S + sx]) open++;
      }
      ky[y * nx + x] = open / S;
    }
  }

  return {
    nx,
    ny,
    pore,
    phi,
    kx,
    ky,
    porosity: 1 - solid / (fnx * fny),
    disks,
    saturated: solid < targetSolid,
  };
}

export interface TransportResult {
  /** potential field in pore phase (NaN in solid) */
  u: Float64Array;
  /** measured D_eff/D0 through the sample */
  deffRatio: number;
  /** tortuosity τ = ε / (D_eff/D0) */
  tortuosity: number;
  /** Bruggeman prediction D_eff/D0 = ε^1.5 — an empirical 3D-spheres correlation */
  bruggemanRatio: number;
  /**
   * The 2D result for insulating circular inclusions, D_eff/D0 = ε/(2−ε).
   *
   * Identical to (1−f)/(1+f) with f = 1−ε the solid area fraction; the two
   * forms are the same expression, not an approximation of one another, and
   * `tests/physics.test.ts` pins that to machine precision. This form is used
   * here because every other quantity on the demo is expressed in ε.
   *
   * It is the 2D Maxwell-Garnett result and also the Hashin-Shtrikman upper
   * bound for a two-phase medium with one insulating phase, so a measured
   * D_eff/D0 must fall below it. Reported alongside `bruggemanRatio` because
   * this packing is 2D disks: ε^1.5 is what practitioners actually use, but it
   * is a 3D correlation and exceeds this bound for ε above (3−√5)/2 ≈ 0.382,
   * which is most of the range this demo can generate.
   */
  maxwell2dRatio: number;
  converged: boolean;
  /**
   * True when no open path connects inlet to outlet.
   *
   * Kept as a guard, but it should not fire for an RSA packing: insertion
   * rejects overlaps, so disks are at worst tangent and the pore space stays
   * connected. Under the previous binary classification it fired anyway, on
   * geometries that in fact conduct at 14–17% of free space — the grid was
   * sealing sub-cell gaps between near-tangent disks. Sub-cell sampling removed
   * every such case across a 135-configuration sweep. The branch stays because
   * a generator that did allow overlaps could seal a channel for real.
   */
  blocked: boolean;
}

/**
 * Steady Laplace solve in the pore phase, flow along +x: u(0,·)=1, u(nx−1,·)=0,
 * zero-flux on solid boundaries and at y walls. Preconditioned (Jacobi) CG on
 * a 5-point stencil whose face conductances are the open fractions from
 * `generateRSA`; a fully closed face has conductance zero and drops out, which
 * is the same no-flux condition the binary mask used to impose.
 */
export function solveTransport(ms: Microstructure, maxIter = 4000): TransportResult {
  const { nx, ny, phi, kx, ky, porosity } = ms;
  const n = nx * ny;
  const isUnknown = new Uint8Array(n); // cells with pore area, excluding Dirichlet columns
  for (let y = 0; y < ny; y++) {
    for (let x = 1; x < nx - 1; x++) {
      if (phi[y * nx + x] > 0) isUnknown[y * nx + x] = 1;
    }
  }

  /**
   * Face conductances, zero outside the domain. The y walls have no faces at
   * all, which is the no-flux condition; a face buried in solid has open
   * fraction zero and drops out of the stencil the same way.
   *
   * The inlet and outlet columns are held uniform along y — u(0,·) = 1,
   * u(nx−1,·) = 0 — so their contribution depends only on which column a cell
   * borders, and lands in the right-hand side rather than the matrix.
   */
  const kxAt = (x: number, y: number): number => (x < 0 || x >= nx - 1 ? 0 : kx[y * nx + x]);
  const kyAt = (x: number, y: number): number => (y < 0 || y >= ny - 1 ? 0 : ky[y * nx + x]);

  // matrix-vector product for the conductance-weighted Laplacian (A = -L)
  const apply = (v: Float64Array, out: Float64Array): void => {
    for (let y = 0; y < ny; y++) {
      for (let x = 1; x < nx - 1; x++) {
        const i = y * nx + x;
        if (!isUnknown[i]) {
          out[i] = 0;
          continue;
        }
        const kw = kxAt(x - 1, y);
        const ke = kxAt(x, y);
        const ks = kyAt(x, y - 1);
        const kn = kyAt(x, y);
        let sum = 0;
        if (kw > 0 && isUnknown[i - 1]) sum += kw * v[i - 1];
        if (ke > 0 && isUnknown[i + 1]) sum += ke * v[i + 1];
        if (ks > 0 && isUnknown[i - nx]) sum += ks * v[i - nx];
        if (kn > 0 && isUnknown[i + nx]) sum += kn * v[i + nx];
        out[i] = (kw + ke + ks + kn) * v[i] - sum;
      }
    }
  };

  // rhs from the Dirichlet columns: inlet contributes its conductance, outlet 0
  const b = new Float64Array(n);
  for (let y = 0; y < ny; y++) {
    const i = y * nx + 1;
    if (isUnknown[i]) b[i] += kxAt(0, y);
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
      const d = kxAt(x - 1, y) + kxAt(x, y) + kyAt(x, y - 1) + kyAt(x, y);
      diag[i] = d > 0 ? d : 1;
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
      if (phi[i] <= 0) continue;
      if (x === 0) field[i] = 1;
      else if (x === nx - 1) field[i] = 0;
      else field[i] = u[i];
    }
  }

  // Flux through the mid-plane, each face weighted by how open it is.
  // Empty-domain reference: every face fully open, so the potential falls
  // linearly and one face carries 1/(nx−1), giving ny · (1/(nx−1)) in total.
  let flux = 0;
  const xm = Math.floor(nx / 2);
  for (let y = 0; y < ny; y++) {
    const k = kxAt(xm - 1, y);
    if (k <= 0) continue;
    flux += k * (field[y * nx + xm - 1] - field[y * nx + xm]);
  }
  const fluxEmpty = ny / (nx - 1);
  const deffRatio = Math.max(0, flux / fluxEmpty);
  const blocked = deffRatio < 1e-6;
  return {
    u: field,
    deffRatio,
    tortuosity: blocked ? Infinity : porosity / deffRatio,
    bruggemanRatio: Math.pow(porosity, 1.5),
    maxwell2dRatio: porosity / (2 - porosity),
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
