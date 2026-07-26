import {
  cpuStep,
  DISPLAY_SRC,
  seedState,
  STEP_SRC,
  surfaceMetrics,
  VERT_SRC,
  type PFParams,
} from '../../lib/phasefield';
import { fieldToRGBA, lut } from '../../lib/colormaps';

/**
 * Phase-field engine with two backends behind one interface:
 * WebGL2 ping-pong float textures, or a typed-array CPU fallback at reduced
 * resolution. Both run the identical update rule from src/lib/phasefield.ts.
 */
export interface PFEngineInfo {
  backend: 'webgl2' | 'cpu';
  nx: number;
  ny: number;
}

export interface PFMetrics {
  solidFraction: number;
  roughness: number;
}

export abstract class PFEngine {
  abstract readonly info: PFEngineInfo;
  abstract seed(nuclei: number): void;
  abstract step(params: PFParams, substeps: number): void;
  abstract render(showC: boolean): void;
  abstract metrics(): PFMetrics;
  abstract dispose(): void;
}

/** Try WebGL2 first, fall back to CPU. Returns null only if canvas 2D also fails. */
export function createEngine(
  canvas: HTMLCanvasElement,
  gpuRes: [number, number],
  cpuRes: [number, number]
): PFEngine | null {
  try {
    const gpu = new GPUEngine(canvas, gpuRes[0], gpuRes[1]);
    return gpu;
  } catch {
    try {
      return new CPUEngine(canvas, cpuRes[0], cpuRes[1]);
    } catch {
      return null;
    }
  }
}

class GPUEngine extends PFEngine {
  readonly info: PFEngineInfo;
  private gl: WebGL2RenderingContext;
  private stepProg: WebGLProgram;
  private dispProg: WebGLProgram;
  private metricProg: WebGLProgram;
  private tex: [WebGLTexture, WebGLTexture];
  private fbo: [WebGLFramebuffer, WebGLFramebuffer];
  private metricTex: WebGLTexture;
  private metricFbo: WebGLFramebuffer;
  private lutXi: WebGLTexture;
  private lutC: WebGLTexture;
  private vao: WebGLVertexArrayObject;
  private cur = 0;
  private nx: number;
  private ny: number;
  private mw: number;
  private mh: number;
  private uniformsStep: Record<string, WebGLUniformLocation | null> = {};
  private frame = 0;

  constructor(canvas: HTMLCanvasElement, nx: number, ny: number) {
    super();
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: false,
      powerPreference: 'low-power',
    });
    if (!gl) throw new Error('WebGL2 unavailable');
    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('float render targets unavailable');
    }
    this.gl = gl;
    this.nx = nx;
    this.ny = ny;
    this.mw = Math.floor(nx / 2);
    this.mh = Math.floor(ny / 2);
    this.info = { backend: 'webgl2', nx, ny };

    const compile = (type: number, src: string): WebGLShader => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error(`shader compile failed: ${gl.getShaderInfoLog(sh)}`);
      }
      return sh;
    };
    const link = (fs: string): WebGLProgram => {
      const prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT_SRC));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error(`program link failed: ${gl.getProgramInfoLog(prog)}`);
      }
      return prog;
    };

    this.stepProg = link(STEP_SRC);
    this.dispProg = link(DISPLAY_SRC);
    this.metricProg = link(`#version 300 es
precision highp float;
uniform sampler2D uState;
in vec2 vUV;
out vec4 o;
void main() {
  float p = texture(uState, vUV).r;
  o = vec4(p > 0.15 && p < 0.85 ? 1.0 : 0.0, p > 0.5 ? 1.0 : 0.0, 0.0, 1.0);
}`);

    // fullscreen triangle-strip quad
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.stepProg, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.vao = vao;

    const makeStateTex = (): WebGLTexture => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, nx, ny, 0, gl.RG, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    const makeFbo = (t: WebGLTexture): WebGLFramebuffer => {
      const f = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('framebuffer incomplete');
      }
      return f;
    };
    this.tex = [makeStateTex(), makeStateTex()];
    this.fbo = [makeFbo(this.tex[0]), makeFbo(this.tex[1])];
    // linear magnification smooths the upscaled display; safe for the sim
    // pass because all sim-pass reads land exactly on texel centres
    if (gl.getExtension('OES_texture_float_linear')) {
      for (const t of this.tex) {
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      }
    }

    this.metricTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.metricTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.mw, this.mh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.metricFbo = makeFbo(this.metricTex);

    const makeLut = (name: 'viridis' | 'inferno'): WebGLTexture => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      const data = lut(name);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, 256, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.lutXi = makeLut('viridis');
    this.lutC = makeLut('inferno');

    for (const name of [
      'uState', 'uTexel', 'uDt', 'uKappa0', 'uDelta', 'uOmega', 'uTheta0', 'uWchem',
      'uLsigma', 'uLeta', 'uAlpha', 'uEtaA', 'uDdiff', 'uLambdaC', 'uNoise', 'uFrame',
    ]) {
      this.uniformsStep[name] = gl.getUniformLocation(this.stepProg, name);
    }
  }

  seed(nuclei: number): void {
    const { gl, nx, ny } = this;
    const state = seedState(nx, ny, nuclei);
    for (const t of this.tex) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, nx, ny, gl.RG, gl.FLOAT, state);
    }
    this.frame = 0;
  }

  step(P: PFParams, substeps: number): void {
    const { gl } = this;
    gl.useProgram(this.stepProg);
    gl.bindVertexArray(this.vao);
    gl.viewport(0, 0, this.nx, this.ny);
    const U = this.uniformsStep;
    gl.uniform2f(U.uTexel, 1 / this.nx, 1 / this.ny);
    gl.uniform1f(U.uDt, P.dt);
    gl.uniform1f(U.uKappa0, P.kappa0);
    gl.uniform1f(U.uDelta, P.delta);
    gl.uniform1f(U.uOmega, P.omegaMode);
    gl.uniform1f(U.uTheta0, P.theta0);
    gl.uniform1f(U.uWchem, P.W);
    gl.uniform1f(U.uLsigma, P.Lsigma);
    gl.uniform1f(U.uLeta, P.Leta);
    gl.uniform1f(U.uAlpha, P.alpha);
    gl.uniform1f(U.uEtaA, P.etaA);
    gl.uniform1f(U.uDdiff, P.D);
    gl.uniform1f(U.uLambdaC, P.lambdaC);
    gl.uniform1f(U.uNoise, P.noise);
    gl.uniform1i(U.uState, 0);
    gl.activeTexture(gl.TEXTURE0);
    for (let s = 0; s < substeps; s++) {
      const src = this.cur;
      const dst = 1 - this.cur;
      gl.uniform1f(U.uFrame, this.frame++);
      gl.bindTexture(gl.TEXTURE_2D, this.tex[src]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[dst]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      this.cur = dst;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  render(showC: boolean): void {
    const { gl } = this;
    const canvas = gl.canvas as HTMLCanvasElement;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round((canvas.clientWidth || 640) * dpr);
    const h = Math.round((canvas.clientHeight || 360) * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.useProgram(this.dispProg);
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.uniform1i(gl.getUniformLocation(this.dispProg, 'uState'), 0);
    gl.uniform1i(gl.getUniformLocation(this.dispProg, 'uLutXi'), 1);
    gl.uniform1i(gl.getUniformLocation(this.dispProg, 'uLutC'), 2);
    gl.uniform1f(gl.getUniformLocation(this.dispProg, 'uShowC'), showC ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[this.cur]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lutXi);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.lutC);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.activeTexture(gl.TEXTURE0);
  }

  metrics(): PFMetrics {
    const { gl } = this;
    gl.useProgram(this.metricProg);
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.metricFbo);
    gl.viewport(0, 0, this.mw, this.mh);
    gl.uniform1i(gl.getUniformLocation(this.metricProg, 'uState'), 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[this.cur]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const px = new Uint8Array(this.mw * this.mh * 4);
    gl.readPixels(0, 0, this.mw, this.mh, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    let iface = 0;
    let solid = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] > 127) iface++;
      if (px[i + 1] > 127) solid++;
    }
    return { solidFraction: solid / (this.mw * this.mh), roughness: iface / this.mw };
  }

  dispose(): void {
    const { gl } = this;
    this.tex.forEach((t) => gl.deleteTexture(t));
    this.fbo.forEach((f) => gl.deleteFramebuffer(f));
    gl.deleteTexture(this.metricTex);
    gl.deleteFramebuffer(this.metricFbo);
    gl.deleteTexture(this.lutXi);
    gl.deleteTexture(this.lutC);
    gl.deleteProgram(this.stepProg);
    gl.deleteProgram(this.dispProg);
    gl.deleteProgram(this.metricProg);
  }
}

class CPUEngine extends PFEngine {
  readonly info: PFEngineInfo;
  private ctx: CanvasRenderingContext2D;
  private off: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  private img: ImageData;
  private a: Float32Array;
  private b: Float32Array;
  private nx: number;
  private ny: number;
  private frame = 0;
  private field: Float32Array;

  constructor(canvas: HTMLCanvasElement, nx: number, ny: number) {
    super();
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.nx = nx;
    this.ny = ny;
    this.info = { backend: 'cpu', nx, ny };
    this.a = seedState(nx, ny, 3);
    this.b = new Float32Array(this.a.length);
    this.off = document.createElement('canvas');
    this.off.width = nx;
    this.off.height = ny;
    this.offCtx = this.off.getContext('2d')!;
    this.img = this.offCtx.createImageData(nx, ny);
    this.field = new Float32Array(nx * ny);
  }

  seed(nuclei: number): void {
    this.a = seedState(this.nx, this.ny, nuclei);
    this.b.fill(0);
    this.frame = 0;
  }

  step(P: PFParams, substeps: number): void {
    // CPU backend runs fewer, larger effective steps to stay interactive
    const n = Math.max(1, Math.round(substeps / 2));
    for (let s = 0; s < n; s++) {
      cpuStep(this.a, this.b, this.nx, this.ny, P, this.frame++);
      const t = this.a;
      this.a = this.b;
      this.b = t;
    }
  }

  render(showC: boolean): void {
    const { nx, ny } = this;
    // flip vertically so the electrode sits at the bottom of the canvas
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const i = ((ny - 1 - y) * nx + x) * 2;
        this.field[y * nx + x] = showC && this.a[i] < 0.5 ? this.a[i + 1] : this.a[i];
      }
    }
    fieldToRGBA('viridis', this.field, this.img.data);
    if (showC) {
      // recolour electrolyte cells with the concentration ramp
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const i = ((ny - 1 - y) * nx + x) * 2;
          if (this.a[i] < 0.5) {
            const idx = (y * nx + x) * 4;
            const c = Math.max(0, Math.min(1, this.a[i + 1]));
            // inferno approximation via colormap util would need a second
            // buffer; reuse the LUT directly for correctness
            const table = lut('inferno');
            const k = (c * 255) | 0;
            this.img.data[idx] = table[k * 3];
            this.img.data[idx + 1] = table[k * 3 + 1];
            this.img.data[idx + 2] = table[k * 3 + 2];
          }
        }
      }
    }
    this.offCtx.putImageData(this.img, 0, 0);
    const canvas = this.ctx.canvas;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round((canvas.clientWidth || 640) * dpr);
    const h = Math.round((canvas.clientHeight || 360) * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.drawImage(this.off, 0, 0, w, h);
  }

  metrics(): PFMetrics {
    const m = surfaceMetrics(this.a, this.nx, this.ny);
    return { solidFraction: m.solidFraction, roughness: m.roughness };
  }

  dispose(): void {
    // typed arrays are garbage collected; nothing to release explicitly
  }
}
