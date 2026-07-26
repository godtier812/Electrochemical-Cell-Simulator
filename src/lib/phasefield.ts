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
 */
export function cpuStep(
  src: Float32Array,
  dst: Float32Array,
  nx: number,
  ny: number,
  P: PFParams,
  frame: number
): void {
  const get = (x: number, y: number, ch: 0 | 1): number => {
    const xx = ((x % nx) + nx) % nx;
    const yy = y < 0 ? 0 : y >= ny ? ny - 1 : y;
    return src[(yy * nx + xx) * 2 + ch];
  };
  const { kappa0, delta, omegaMode, theta0, W, Lsigma, Leta, alpha, etaA, D, lambdaC, noise, dt } =
    P;
  const expA = Math.exp((1 - alpha) * etaA);
  const expC = Math.exp(-alpha * etaA);

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
      if (pNew < 0) pNew = 0;
      else if (pNew > 1) pNew = 1;
      if (cNew < 0) cNew = 0;
      else if (cNew > 1.5) cNew = 1.5;
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
}

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
in vec2 vUV;
out vec4 fragColor;
void main() {
  vec2 s = texture(uState, vUV).rg;
  vec3 xiCol = texture(uLutXi, vec2(clamp(s.x, 0.0, 1.0), 0.5)).rgb;
  vec3 cCol = texture(uLutC, vec2(clamp(s.y, 0.0, 1.0), 0.5)).rgb;
  // overlay mode: metal keeps the ξ ramp, electrolyte shows C
  vec3 col = (uShowC > 0.5) ? mix(cCol, xiCol, smoothstep(0.35, 0.65, s.x)) : xiCol;
  fragColor = vec4(col, 1.0);
}`;
