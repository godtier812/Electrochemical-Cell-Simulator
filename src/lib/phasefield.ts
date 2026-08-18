/**
 * Electrochemical phase-field (Allen–Cahn) dendrite model, Kobayashi-style
 * anisotropy with a Butler–Volmer driving force:
 *
 *   ∂ξ/∂t = L_σ [ ∇·(κ²∇ξ) − ∂x(κκ' ξ_y) + ∂y(κκ' ξ_x) − f'_ch(ξ) ]
 *           − L_η h'(ξ) [ e^{(1−α)aη} − (C/C₀) e^{−αaη} ] + noise
 *   ∂C/∂t = ∇·(D(ξ)∇C) − λ ∂ξ/∂t
 *
 * with κ(θ) = κ₀(1 + δ cos ω(θ−θ₀)), f_ch = W ξ²(1−ξ)²,
 * h(ξ) = ξ³(6ξ² − 15ξ + 10), D(ξ) = D₀(1 − h(ξ)), θ = atan2(ξ_y, ξ_x).
 * Nondimensional units: dx = 1 lattice unit, aη = Fη/RT. Deposition means
 * aη < 0 (cathodic), which makes the bracket negative and grows the metal.
 *
 * The same update is implemented twice — once in GLSL for the WebGL2
 * ping-pong demo/hero, once on typed arrays for the canvas-2D fallback and
 * for the build-time poster generator — so every rendering of this model on
 * the site is the actual physics.
 */

export interface PFParams {
  kappa0: number;
  delta: number;
  omegaMode: number;
  theta0: number;
  W: number;
  Lsigma: number;
  Leta: number;
  alpha: number;
  /** nondimensional overpotential argument aη = Fη/RT; negative deposits */
  etaA: number;
  D: number;
  lambdaC: number;
  noise: number;
  dt: number;
}

export const PF_DEFAULTS: PFParams = {
  kappa0: 1.1,
  delta: 0.04,
  omegaMode: 4,
  theta0: Math.PI / 2,
  W: 1.8,
  Lsigma: 1.0,
  Leta: 0.02,
  alpha: 0.5,
  etaA: -6,
  D: 1.6,
  lambdaC: 1.6,
  noise: 0.02,
  dt: 0.06,
};

/**
 * The diffusion-only stability bound: min over the two fields of 1/(4a).
 *
 * NECESSARY, NOT SUFFICIENT. Exceeding this is unstable outright — no reaction
 * term can rescue an explicit Laplacian past its own limit — so a warning built
 * on it never cries wolf. Staying inside it is not a guarantee, because the
 * reaction terms tighten the true bound further; cflLimit accounts for those.
 */
export function cflLimitDiffusive(P: PFParams): number {
  const kappaMax = P.kappa0 * (1 + Math.abs(P.delta));
  const aXi = P.Lsigma * kappaMax * kappaMax;
  const dtXi = aXi > 0 ? 1 / (4 * aXi) : Infinity;
  const dtC = P.D > 0 ? 1 / (4 * P.D) : Infinity;
  return Math.min(dtXi, dtC);
}

/**
 * Largest guaranteed-stable timestep for these parameters, derived rather than
 * tabulated.
 *
 * Explicit Euler on u' = a∇²u − r u with the 5-point Laplacian at dx = 1: the
 * discrete Laplacian's eigenvalues span [−8, 0], so the amplification factor
 * 1 + dt(aλ − r) stays inside the unit circle only while dt ≤ 2/(8a + r). Both
 * evolved fields get that treatment and the smaller bound wins:
 *
 *   ξ:  a = L_σ κ_max²,  κ_max = κ₀(1 + δ)
 *       r = L_σ |f″_ch|_max + L_η |h″|_max |drive|_max
 *         = L_σ · 2W      + L_η · 60·max|p(1−p)(1−2p)| · |e^{(1−α)aη} − C_max e^{−αaη}|
 *   C:  a = D₀, no reaction term of its own (the λ_C coupling enters through ξ)
 *
 * At PF_DEFAULTS this gives 0.1140 from ξ and 0.1563 from C, so ξ binds and the
 * shipped dt = 0.06 sits 1.9x inside it. Checked against the kernel with the
 * clamps disabled: ξ first goes negative at dt = 0.12, just past the ξ bound,
 * and the run diverges to NaN at dt = 0.16, just past the C bound. Quoting only
 * the C bound — the more obvious 1/(4D) — would overstate the margin as 2.6x.
 *
 * SUFFICIENT, NOT NECESSARY. Being inside this bound guarantees stability;
 * being outside it does not imply instability, and at strong drive it turns
 * conservative. |drive|_max assumes C sits at its ceiling in the same cell
 * where |h″| peaks, but the reaction depletes C exactly where the interface is,
 * so that product is never realised. Swept over D3's own control space, the
 * bound calls two reachable settings unstable by up to 1.7x that in fact run at
 * 3.6% and 5.5% clamp activity — indistinguishable from normal operation. It
 * does correctly flag the one setting that genuinely degenerates (full drive,
 * 205 mV, 250 K: 3.5x over, 48% clamped). So use cflLimitDiffusive where a
 * false alarm is unacceptable, this for a guarantee, and the measured clamp
 * fraction to tell which case you are actually in.
 */
export function cflLimit(P: PFParams): number {
  const kappaMax = P.kappa0 * (1 + Math.abs(P.delta));
  const aXi = P.Lsigma * kappaMax * kappaMax;
  // |f″| of W p²(1−p)² peaks at the wells, where it is 2W
  const fppMax = 2 * Math.abs(P.W);
  // h′(p) = 30p²(1−p)², so h″ = 60p(1−p)(1−2p). That peaks at p = (3±√3)/6,
  // where |p(1−p)(1−2p)| = 1/(6√3), giving |h″|_max = 60/(6√3) = 10/√3.
  const hppMax = 10 / Math.sqrt(3);
  // the reaction bracket is largest when C sits at its own ceiling
  const driveMax = Math.abs(
    Math.exp((1 - P.alpha) * P.etaA) - C_MAX * Math.exp(-P.alpha * P.etaA)
  );
  const rXi = P.Lsigma * fppMax + Math.abs(P.Leta) * hppMax * driveMax;
  const dtXi = 2 / (8 * aXi + rXi);
  const dtC = P.D > 0 ? 1 / (4 * P.D) : Infinity;
  return Math.min(dtXi, dtC);
}

/** Upper bound the C field is held to; also the worst case for the drive term. */
export const C_MAX = 1.5;

/** Interleaved RG state (ξ, C) seeded with an electrode strip + nuclei. */
export function seedState(
  nx: number,
  ny: number,
  nuclei: number,
  rng: () => number = Math.random
): Float32Array {
  const s = new Float32Array(nx * ny * 2);
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const i = (y * nx + x) * 2;
      const metal = y < 3 ? 1 : 0;
      s[i] = metal;
      s[i + 1] = metal ? 0 : 1;
    }
  }
  const rad = Math.max(3, Math.round(nx / 90));
  for (let k = 0; k < nuclei; k++) {
    const cx = Math.floor(((k + 0.25 + 0.5 * rng()) / nuclei) * nx);
    for (let dy = 0; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (dx * dx + dy * dy > rad * rad) continue;
        const x = (cx + dx + nx) % nx;
        const y = 2 + dy;
        if (y >= ny) continue;
        const i = (y * nx + x) * 2;
        s[i] = 1;
        s[i + 1] = 0;
      }
    }
  }
  return s;
}

const hPrime = (p: number) => 30 * p * p * (1 - p) * (1 - p);
const hInterp = (p: number) => p * p * p * (6 * p * p - 15 * p + 10);

/**
 * One explicit Euler step on the CPU. src and dst are interleaved RG buffers.
 * Periodic in x, fixed rows at y=0 (electrode, ξ=1) and y=ny−1 (bulk, C=1).
 *
 * Returns the number of interior cells where a clamp fired this step. That is
 * the only signal an unstable run gives: the clamps below keep ξ in [0,1] and C
 * in [0,C_MAX] whatever the timestep, so a run past the stability limit still
 * produces a finite, plausible-looking picture with no NaN to notice. Some
 * clamping is normal — the bulk phases sit exactly on the bounds and noise
 * pushes them across, about 5% of cells per step at the shipped defaults — so
 * it is the rate, not the presence, that distinguishes the two. See
 * CLAMP_ALARM_FRACTION.
 */
export function cpuStep(
  src: Float32Array,
  dst: Float32Array,
  nx: number,
  ny: number,
  P: PFParams,
  frame: number
): number {
  const get = (x: number, y: number, ch: 0 | 1): number => {
    const xx = ((x % nx) + nx) % nx;
    const yy = y < 0 ? 0 : y >= ny ? ny - 1 : y;
    return src[(yy * nx + xx) * 2 + ch];
  };
  const { kappa0, delta, omegaMode, theta0, W, Lsigma, Leta, alpha, etaA, D, lambdaC, noise, dt } =
    P;
  const expA = Math.exp((1 - alpha) * etaA);
  const expC = Math.exp(-alpha * etaA);
  let clamped = 0;

  const epsOf = (gx: number, gy: number): [number, number] => {
    const theta = Math.atan2(gy, gx);
    const arg = omegaMode * (theta - theta0);
    const e = kappa0 * (1 + delta * Math.cos(arg));
    const de = -kappa0 * delta * omegaMode * Math.sin(arg);
    return [e, de];
  };

  for (let y = 1; y < ny - 1; y++) {
    for (let x = 0; x < nx; x++) {
      const i = (y * nx + x) * 2;
      const p = src[i];
      const c = src[i + 1];
      const pE = get(x + 1, y, 0);
      const pW = get(x - 1, y, 0);
      const pN = get(x, y + 1, 0);
      const pS = get(x, y - 1, 0);
      const px = (pE - pW) / 2;
      const py = (pN - pS) / 2;

      // gradients at the four neighbours (5-point supports)
      const pxE = (get(x + 2, y, 0) - p) / 2;
      const pyE = (get(x + 1, y + 1, 0) - get(x + 1, y - 1, 0)) / 2;
      const pxW = (p - get(x - 2, y, 0)) / 2;
      const pyW = (get(x - 1, y + 1, 0) - get(x - 1, y - 1, 0)) / 2;
      const pxN = (get(x + 1, y + 1, 0) - get(x - 1, y + 1, 0)) / 2;
      const pyN = (get(x, y + 2, 0) - p) / 2;
      const pxS = (get(x + 1, y - 1, 0) - get(x - 1, y - 1, 0)) / 2;
      const pyS = (p - get(x, y - 2, 0)) / 2;

      const [epsC] = epsOf(px, py);
      const [eE, dE] = epsOf(pxE, pyE);
      const [eW, dW] = epsOf(pxW, pyW);
      const [eN, dN] = epsOf(pxN, pyN);
      const [eS, dS] = epsOf(pxS, pyS);

      const aniso = (-(eE * dE * pyE - eW * dW * pyW) + (eN * dN * pxN - eS * dS * pxS)) / 2;
      const lap = pE + pW + pN + pS - 4 * p;
      const gradEps2 =
        ((eE * eE - eW * eW) / 2) * px + ((eN * eN - eS * eS) / 2) * py;
      const iso = epsC * epsC * lap + gradEps2;

      const fprime = 2 * W * p * (1 - p) * (1 - 2 * p);
      const drive = expA - c * expC;
      // deterministic hash noise so CPU and GPU behave alike
      const hval = fract(Math.sin(x * 127.1 + y * 311.7 + frame * 0.37) * 43758.5453) - 0.5;
      const dpdt =
        Lsigma * (iso + aniso - fprime) - Leta * hPrime(p) * drive + noise * p * (1 - p) * hval;

      // concentration: face diffusivities blocked inside the metal
      const cE = get(x + 1, y, 1);
      const cW = get(x - 1, y, 1);
      const cN = get(x, y + 1, 1);
      const cS = get(x, y - 1, 1);
      const DE = D * (1 - hInterp((p + pE) / 2));
      const DW = D * (1 - hInterp((p + pW) / 2));
      const DN = D * (1 - hInterp((p + pN) / 2));
      const DS = D * (1 - hInterp((p + pS) / 2));
      const dcdt = DE * (cE - c) - DW * (c - cW) + DN * (cN - c) - DS * (c - cS) - lambdaC * dpdt;

      let pNew = p + dt * dpdt;
      let cNew = c + dt * dcdt;
      let pinned = false;
      if (pNew < 0) {
        pNew = 0;
        pinned = true;
      } else if (pNew > 1) {
        pNew = 1;
        pinned = true;
      }
      if (cNew < 0) {
        cNew = 0;
        pinned = true;
      } else if (cNew > C_MAX) {
        cNew = C_MAX;
        pinned = true;
      }
      if (pinned) clamped++;
      dst[i] = pNew;
      dst[i + 1] = cNew;
    }
  }
  // fixed rows
  for (let x = 0; x < nx; x++) {
    dst[x * 2] = 1;
    dst[x * 2 + 1] = 0;
    const top = ((ny - 1) * nx + x) * 2;
    dst[top] = 0;
    dst[top + 1] = 1;
  }
  return clamped;
}

/**
 * Fraction of interior cells clamped in a step above which the timestep is
 * past the stability limit and the picture is no longer a solution of the
 * stated equation.
 *
 * Measured on a 224x112 run, averaged over the last 50 of 400 steps: 5.3% at
 * the shipped dt = 0.06, rising smoothly to 12.0% at dt = 0.12 — still stable —
 * then jumping to 30.4% at dt = 0.13, which is unstable and would reach NaN
 * without the clamps. Nothing was observed between 12.0% and 30.4%; the
 * discontinuity straddles cflLimit(PF_DEFAULTS) = 0.114. This value is the
 * geometric mean of the two, sqrt(0.1195 * 0.3042), which is the widest-margin
 * point in that empty band: 3.6x above normal operation and 1.6x below the
 * first unstable reading.
 */
export const CLAMP_ALARM_FRACTION = 0.19;

function fract(v: number): number {
  return v - Math.floor(v);
}

/** Interface length (in cells) and solid fraction — the demo's live readouts. */
export function surfaceMetrics(
  state: Float32Array,
  nx: number,
  ny: number
): { interfaceCells: number; solidFraction: number; roughness: number } {
  let iface = 0;
  let solid = 0;
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const p = state[(y * nx + x) * 2];
      if (p > 0.5) solid++;
      if (p > 0.15 && p < 0.85) iface++;
    }
  }
  return { interfaceCells: iface, solidFraction: solid / (nx * ny), roughness: iface / nx };
}

/* ------------------------------------------------------------------ */
/* GLSL sources (WebGL2)                                               */
/* ------------------------------------------------------------------ */

export const VERT_SRC = `#version 300 es
in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export const STEP_SRC = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uDt, uKappa0, uDelta, uOmega, uTheta0, uWchem, uLsigma, uLeta, uAlpha, uEtaA, uDdiff, uLambdaC, uNoise, uFrame;
in vec2 vUV;
out vec4 outState;

vec2 st(vec2 uv) {
  uv.x = fract(uv.x);
  uv.y = clamp(uv.y, 0.5 * uTexel.y, 1.0 - 0.5 * uTexel.y);
  return texture(uState, uv).rg;
}

vec2 epsOf(vec2 g) {
  float theta = atan(g.y, g.x);
  float arg = uOmega * (theta - uTheta0);
  return vec2(uKappa0 * (1.0 + uDelta * cos(arg)), -uKappa0 * uDelta * uOmega * sin(arg));
}

float hp(float p) { return 30.0 * p * p * (1.0 - p) * (1.0 - p); }
float hInterp(float p) { return p * p * p * (6.0 * p * p - 15.0 * p + 10.0); }
float hash(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7)) + uFrame * 0.37) * 43758.5453); }

void main() {
  vec2 e = uTexel;
  if (vUV.y < e.y) { outState = vec4(1.0, 0.0, 0.0, 0.0); return; }
  if (vUV.y > 1.0 - e.y) { outState = vec4(0.0, 1.0, 0.0, 0.0); return; }

  vec2 S = st(vUV);
  float p = S.x, c = S.y;
  vec2 SE = st(vUV + vec2(e.x, 0.0)), SW = st(vUV - vec2(e.x, 0.0));
  vec2 SN = st(vUV + vec2(0.0, e.y)), SS = st(vUV - vec2(0.0, e.y));
  float pE = SE.x, pW = SW.x, pN = SN.x, pS = SS.x;
  float px = 0.5 * (pE - pW);
  float py = 0.5 * (pN - pS);

  float pE2 = st(vUV + vec2(2.0 * e.x, 0.0)).x;
  float pW2 = st(vUV - vec2(2.0 * e.x, 0.0)).x;
  float pN2 = st(vUV + vec2(0.0, 2.0 * e.y)).x;
  float pS2 = st(vUV - vec2(0.0, 2.0 * e.y)).x;
  float pNE = st(vUV + vec2(e.x, e.y)).x;
  float pNW = st(vUV + vec2(-e.x, e.y)).x;
  float pSE = st(vUV + vec2(e.x, -e.y)).x;
  float pSW = st(vUV + vec2(-e.x, -e.y)).x;

  vec2 gE = vec2(0.5 * (pE2 - p), 0.5 * (pNE - pSE));
  vec2 gW = vec2(0.5 * (p - pW2), 0.5 * (pNW - pSW));
  vec2 gN = vec2(0.5 * (pNE - pNW), 0.5 * (pN2 - p));
  vec2 gS = vec2(0.5 * (pSE - pSW), 0.5 * (p - pS2));

  vec2 eC = epsOf(vec2(px, py));
  vec2 eE = epsOf(gE), eW = epsOf(gW), eN = epsOf(gN), eS = epsOf(gS);

  float aniso = 0.5 * (-(eE.x * eE.y * gE.y - eW.x * eW.y * gW.y)
                       + (eN.x * eN.y * gN.x - eS.x * eS.y * gS.x));
  float lap = pE + pW + pN + pS - 4.0 * p;
  float gradEps2 = 0.5 * (eE.x * eE.x - eW.x * eW.x) * px
                 + 0.5 * (eN.x * eN.x - eS.x * eS.x) * py;
  float iso = eC.x * eC.x * lap + gradEps2;

  float fprime = 2.0 * uWchem * p * (1.0 - p) * (1.0 - 2.0 * p);
  float drive = exp((1.0 - uAlpha) * uEtaA) - c * exp(-uAlpha * uEtaA);
  float nz = uNoise * p * (1.0 - p) * (hash(vUV / uTexel) - 0.5);
  float dpdt = uLsigma * (iso + aniso - fprime) - uLeta * hp(p) * drive + nz;

  float DE = uDdiff * (1.0 - hInterp(0.5 * (p + pE)));
  float DW = uDdiff * (1.0 - hInterp(0.5 * (p + pW)));
  float DN = uDdiff * (1.0 - hInterp(0.5 * (p + pN)));
  float DS = uDdiff * (1.0 - hInterp(0.5 * (p + pS)));
  float dcdt = DE * (SE.y - c) - DW * (c - SW.y) + DN * (SN.y - c) - DS * (c - SS.y)
             - uLambdaC * dpdt;

  float pNew = clamp(p + uDt * dpdt, 0.0, 1.0);
  float cNew = clamp(c + uDt * dcdt, 0.0, 1.5);
  outState = vec4(pNew, cNew, 0.0, 0.0);
}`;

export const DISPLAY_SRC = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform sampler2D uLutXi;
uniform sampler2D uLutC;
uniform float uShowC;
/**
 * Cover fit. The canvas is sized to its CSS box, so its aspect rarely matches
 * the simulation grid's, and mapping the field straight across it stretches the
 * dendrites. uFit shrinks the sampled range on whichever axis has to give,
 * cropping like object-fit: cover rather than distorting — which is also how
 * the poster underneath is fitted, so the two line up when they cross-fade.
 */
uniform vec2 uFit;
in vec2 vUV;
out vec4 fragColor;
void main() {
  vec2 uv = clamp((vUV - 0.5) * uFit + 0.5, 0.0, 1.0);
  vec2 s = texture(uState, uv).rg;
  vec3 xiCol = texture(uLutXi, vec2(clamp(s.x, 0.0, 1.0), 0.5)).rgb;
  vec3 cCol = texture(uLutC, vec2(clamp(s.y, 0.0, 1.0), 0.5)).rgb;
  // overlay mode: metal keeps the ξ ramp, electrolyte shows C
  vec3 col = (uShowC > 0.5) ? mix(cCol, xiCol, smoothstep(0.35, 0.65, s.x)) : xiCol;
  fragColor = vec4(col, 1.0);
}`;
