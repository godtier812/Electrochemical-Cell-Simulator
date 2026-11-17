/**
 * The kernel reference at /docs/kernels/, as data.
 *
 * Kept as data rather than prose so that tests/docs.test.ts can check it
 * against the code: every function and constant listed here must be exported
 * by the module it is listed under, and every type must be declared there. A
 * renamed or deleted export fails the build instead of leaving the reference
 * describing something that no longer exists.
 *
 * Which test files cover a module is not written here at all; the page works
 * it out from the test sources at build time.
 */

export interface KernelExport {
  name: string;
  /** Written for a reader: parameter names kept, long types abbreviated. */
  signature: string;
  summary: string;
  kind?: 'function' | 'const' | 'type' | 'class';
}

export interface KernelModule {
  /** File under src/lib/. */
  file: string;
  title: string;
  /** What the module is for, in a sentence or two. */
  purpose: string;
  /** Units and conventions a caller needs to get right. */
  conventions?: string;
  /** Demo codes and tools that run this module. */
  usedBy: string[];
  /** Live checks on /validation/ that exercise it, by element id. */
  validation?: { label: string; anchor: string }[];
  exports: KernelExport[];
  /** Supporting code rather than physics: listed after the kernels. */
  supporting?: boolean;
}

export const KERNELS: KernelModule[] = [
  {
    file: 'constants.ts',
    title: 'Physical constants',
    purpose: 'CODATA values for F, R and ε₀, and the two derived scales every other module leans on.',
    conventions: 'SI throughout. Concentrations in mol/m³, so 1 M is 1000.',
    usedBy: ['D1', 'D2', 'D3', 'D6', 'calculators'],
    exports: [
      { name: 'F', kind: 'const', signature: 'F = 96485.33212', summary: 'Faraday constant, C/mol.' },
      { name: 'R', kind: 'const', signature: 'R = 8.314462618', summary: 'Gas constant, J/(mol·K).' },
      { name: 'EPS0', kind: 'const', signature: 'EPS0 = 8.8541878128e-12', summary: 'Vacuum permittivity, F/m.' },
      { name: 'thermalVoltage', signature: 'thermalVoltage(T: number): number', summary: 'RT/F in volts; 25.69 mV at 298.15 K.' },
      {
        name: 'debyeLength',
        signature: 'debyeLength(εr: number, T: number, c0: number): number',
        summary: 'Debye length of a 1:1 electrolyte in metres: 0.304 nm at 1 M and 0.962 nm at 0.1 M in water.',
      },
    ],
  },
  {
    file: 'butlervolmer.ts',
    title: 'Butler–Volmer kinetics',
    purpose: 'Interfacial current against overpotential, its linear and Tafel limits, and the width of the linear window.',
    conventions: 'η in volts. j carries whatever unit j₀ is given in (the demo uses A/cm²).',
    usedBy: ['D1', 'calculators'],
    exports: [
      {
        name: 'butlerVolmer',
        signature: 'butlerVolmer(eta, j0, alphaA, alphaC, T): number',
        summary: 'j = j₀[exp(α_a Fη/RT) − exp(−α_c Fη/RT)].',
      },
      {
        name: 'butlerVolmerLinear',
        signature: 'butlerVolmerLinear(eta, j0, alphaA, alphaC, T): number',
        summary: 'The small-signal limit j ≈ j₀(α_a+α_c)Fη/RT.',
      },
      { name: 'tafel', signature: 'tafel(eta, j0, alpha, T): number', summary: 'One Tafel branch, |j| = j₀ exp(αF|η|/RT).' },
      { name: 'tafelSlopeMV', signature: 'tafelSlopeMV(alpha, T): number', summary: 'Tafel slope 2.303RT/(αF), in mV per decade.' },
      {
        name: 'linearRegionMV',
        signature: 'linearRegionMV(j0, alphaA, alphaC, T): number',
        summary: 'Half-width, in mV, of the band where the linearised current is within 5% of the full expression. Found by bisection.',
      },
    ],
  },
  {
    file: 'pnp.ts',
    title: 'Poisson–Nernst–Planck',
    purpose:
      'Steady PNP for a 1:1 electrolyte against a blocking electrode: Scharfetter–Gummel fluxes on a graded mesh, solved by a fully coupled damped Newton iteration with a block-tridiagonal Jacobian. Also the analytic Gouy–Chapman profile it is checked against, and the manufactured-solution convergence study.',
    conventions:
      'Inputs in SI. The solution comes back nondimensional: x̂ = x/L, ĉ = C/c₀, ψ = Fφ/RT. Multiply ψ by thermalVoltage(T) for volts.',
    usedBy: ['D2'],
    validation: [
      { label: 'Gouy–Chapman double layer', anchor: 'check-gc' },
      { label: 'Manufactured solutions', anchor: 'check-mms' },
    ],
    exports: [
      {
        name: 'solvePNP',
        signature: 'solvePNP({ L, c0, epsR, T, Vapp, N }: PNPParams): PNPSolution',
        summary: 'Gap L in m, c₀ in mol/m³, applied potential Vapp in V, N mesh nodes. Returns the profiles, the Debye length, and the Newton iteration count and residual.',
      },
      { name: 'PNPParams', kind: 'type', signature: 'interface PNPParams', summary: 'Inputs to solvePNP, as above.' },
      {
        name: 'PNPSolution',
        kind: 'type',
        signature: 'interface PNPSolution',
        summary: 'xHat, cPlus, cMinus, psi (Float64Array); lambdaD (m); converged, newtonIterations, residualNorm.',
      },
      {
        name: 'gouyChapman',
        signature: 'gouyChapman(xHat, psi0, lamHat): { psi, cPlus, cMinus }',
        summary: 'The exact single-wall profile, tanh(ψ/4) = tanh(ψ₀/4)·e^(−x/λ_D). Valid as a reference while L ≫ λ_D.',
      },
      {
        name: 'gcCapacitance',
        signature: 'gcCapacitance(epsR, T, c0, psi0): number',
        summary: 'Gouy–Chapman differential capacitance (ε/λ_D)·cosh(ψ₀/2), in F/m².',
      },
      {
        name: 'mmsConvergence',
        signature: 'mmsConvergence(Ns: number[], { epsHat?, ratio? }): MMSRow[]',
        summary: 'Method of manufactured solutions on the full coupled system. One row per mesh: the largest cell h and the mesh-weighted L₂ error, from which the observed order follows.',
      },
      { name: 'MMSRow', kind: 'type', signature: 'interface MMSRow { N, h, error }', summary: 'One mesh of the convergence study.' },
      {
        name: 'gradedMesh',
        signature: 'gradedMesh(N: number, lamHat: number): Float64Array',
        summary: 'Geometric mesh on [0, 1], refined towards the electrode so the first cells resolve λ_D.',
      },
      {
        name: 'bernoulli',
        signature: 'bernoulli(x: number): number',
        summary: 'B(x) = x/(eˣ − 1), the Scharfetter–Gummel weight, series-expanded near zero and guarded against overflow.',
      },
    ],
  },
  {
    file: 'diffusion.ts',
    title: 'Diffusion',
    purpose: "The Cottrell potential step by implicit Euler, and Sand's time for depletion under constant current.",
    conventions: 'SI: D in m²/s, c in mol/m³, A in m², J in A/m².',
    usedBy: ['calculators'],
    validation: [{ label: 'Cottrell potential step', anchor: 'check-cottrell' }],
    exports: [
      {
        name: 'cottrellStep',
        signature: 'cottrellStep({ D, cStar, A, nElectrons, L, N?, tEnd?, nSteps? }): CottrellRun',
        summary: 'Simulated current after a step that drives the surface concentration to zero, beside the analytic nFAc*√(D/πt).',
      },
      { name: 'CottrellRun', kind: 'type', signature: 'interface CottrellRun { t, i, iCottrell, x, c }', summary: 'Times, simulated and analytic currents, and the final profile.' },
      {
        name: 'sandsTime',
        signature: 'sandsTime(D, c0, nElectrons, J, tPlus): number',
        summary: "Sand's time πD(c₀nF)²/(4J²t_a²) in seconds, with t_a = 1 − t₊.",
      },
    ],
  },
  {
    file: 'eis.ts',
    title: 'Equivalent-circuit impedance',
    purpose:
      'The circuit behind the impedance demo: R_Ω + [R_SEI ∥ C_SEI] + [C_dl ∥ (R_ct + Z_W)] with a finite-length Warburg, plus the frequency grid and a noise model for synthetic spectra.',
    conventions: 'ω in rad/s. Resistances in Ω·cm² and capacitances in F/cm² in the demo; any consistent units work.',
    usedBy: ['D4', 'EIS analyser'],
    validation: [{ label: 'Warburg 45° asymptote', anchor: 'check-warburg' }],
    exports: [
      { name: 'impedance', signature: 'impedance(omega: number, p: CircuitParams): C', summary: 'Complex impedance at one angular frequency.' },
      {
        name: 'CircuitParams',
        kind: 'type',
        signature: 'interface CircuitParams { Rohm, Rct, Cdl, Rd, tauD, Rsei, Csei, age }',
        summary: 'Circuit values. R_SEI is scaled by age, so age = 0 is a fresh cell with no film arc.',
      },
      { name: 'omegaGrid', signature: 'omegaGrid(fMin, fMax, n): Float64Array', summary: 'n log-spaced angular frequencies between two frequencies in Hz.' },
      {
        name: 'addNoise',
        signature: 'addNoise(Z: C[], rel: number, rng: () => number): C[]',
        summary: 'Gaussian error of standard deviation rel·|Z| on both parts. Seeded, so the same settings give the same spectrum.',
      },
      { name: 'warburgAsymptote', signature: 'warburgAsymptote(sigma, omega): C', summary: 'Semi-infinite Warburg line σ(1 − i)/√ω.' },
    ],
  },
  {
    file: 'drt.ts',
    title: 'Distribution of relaxation times',
    purpose:
      'Tikhonov-regularised non-negative least squares from a spectrum to γ(τ), and the tools to read the result: peaks with their resistances, and a sweep over the regularisation strength.',
    conventions:
      'γ is a density in ln τ: the area under it, Σγ·dlnTau, is a resistance and does not depend on the τ grid. Peak heights do.',
    usedBy: ['D4', 'EIS analyser'],
    validation: [{ label: 'DRT recovery of a known circuit', anchor: 'check-drt' }],
    exports: [
      {
        name: 'computeDRT',
        signature: 'computeDRT(omega, Z: C[], { nTau?, lambda? }): DRTResult',
        summary: 'Fits R∞ and γ on a log τ grid that runs one decade past the data at each end. Defaults: 60 bins, λ = 0.01.',
      },
      { name: 'DRTResult', kind: 'type', signature: 'interface DRTResult { tau, gamma, dlnTau, Rinf, misfit }', summary: 'The grid, the density, its spacing, the series resistance and the relative rms misfit.' },
      {
        name: 'drtPeaks',
        signature: 'drtPeaks(drt, omega, minFraction = 0.03): DRTPeak[]',
        summary: 'Local maxima above a fraction of the tallest, each with the area between its bounding minima, its τ and frequency, and C = τ/R.',
      },
      { name: 'DRTPeak', kind: 'type', signature: 'interface DRTPeak { tau, freq, resistance, capacitance, outsideWindow }', summary: 'One process. outsideWindow marks a peak beyond the measured frequencies.' },
      { name: 'lambdaSweep', signature: 'lambdaSweep(omega, Z, lambdas, { nTau? }): LambdaSweepRow[]', summary: 'Misfit and peak count for each λ.' },
      {
        name: 'suggestLambda',
        signature: 'suggestLambda(sweep): number | null',
        summary: 'Centre of the longest run of λ values with a constant peak count. A place to start, not a correct answer.',
      },
    ],
  },
  {
    file: 'eisdata.ts',
    title: 'Impedance data parser',
    purpose: 'Reads the text people actually have — instrument exports, spreadsheet pastes — into a spectrum, and says what it assumed.',
    conventions:
      'Frequency in Hz, impedance in whatever unit the file uses. The returned Z has the physical sign, Im Z < 0 for a capacitive cell, whichever way the file stored it.',
    usedBy: ['EIS analyser'],
    exports: [
      {
        name: 'parseEis',
        signature: 'parseEis(text: string, override?: Partial<EisColumns>): EisParse',
        summary: 'Detects the separator, header, decimal commas and sign convention; sorts by frequency; reports skipped rows and every assumption in notes.',
      },
      { name: 'EisParse', kind: 'type', signature: 'interface EisParse { data, columns, header, nColumns, skipped, notes }', summary: 'The spectrum and how it was read.' },
      { name: 'EisData', kind: 'type', signature: 'interface EisData { freq, omega, Z }', summary: 'A spectrum, ascending in frequency.' },
      { name: 'EisColumns', kind: 'type', signature: 'interface EisColumns { freq, re, im, imNegated }', summary: 'Which column holds what. Pass a corrected copy back as the override.' },
      { name: 'EisParseError', kind: 'class', signature: 'class EisParseError extends Error', summary: 'Thrown with a reason a person can act on.' },
      { name: 'inductivePoints', signature: 'inductivePoints(Z: C[]): number[]', summary: 'Indices with Im Z > 0, which the DRT model cannot represent.' },
      { name: 'dropPoints', signature: 'dropPoints(data: EisData, drop: number[]): EisData', summary: 'The spectrum without the listed points.' },
    ],
  },
  {
    file: 'microstructure.ts',
    title: 'Microstructure and tortuosity',
    purpose:
      'Random sequential adsorption packings with sub-cell geometry, and the steady Laplace solve through the pore phase that turns a packing into a measured D_eff/D₀.',
    conventions: 'Lengths in grid cells. Flow runs along +x with u = 1 at the inlet and 0 at the outlet.',
    usedBy: ['D5'],
    exports: [
      {
        name: 'generateRSA',
        signature: 'generateRSA({ nx, ny, solidFraction, radius, spread, rng?, maxAttempts? }): Microstructure',
        summary: 'Drops disks at random, rejecting overlaps, until the solid fraction is met or the packing jams. Pass a seeded rng for a reproducible packing.',
      },
      { name: 'RSAParams', kind: 'type', signature: 'interface RSAParams', summary: 'Inputs to generateRSA, as above.' },
      {
        name: 'Microstructure',
        kind: 'type',
        signature: 'interface Microstructure { nx, ny, pore, phi, kx, ky, porosity, disks, saturated }',
        summary: 'Per-cell pore fraction and per-face open fraction, sampled 8× per axis. saturated means RSA could not reach the target.',
      },
      {
        name: 'solveTransport',
        signature: 'solveTransport(ms: Microstructure, maxIter = 4000): TransportResult',
        summary: 'Jacobi-preconditioned conjugate gradient on a 5-point stencil weighted by open face fraction.',
      },
      {
        name: 'TransportResult',
        kind: 'type',
        signature: 'interface TransportResult { u, deffRatio, tortuosity, bruggemanRatio, maxwell2dRatio, converged, blocked }',
        summary: 'The field, the measured ratio and tortuosity, and the two references the demo plots beside them.',
      },
      { name: 'streamline', signature: 'streamline(ms, field, x0, y0, maxSteps = 4000): { x, y }[]', summary: 'RK2 trace of −∇u from a starting point.' },
      { name: 'mulberry32', signature: 'mulberry32(seed: number): () => number', summary: 'Small seeded uniform generator, used wherever a figure must be reproducible.' },
      { name: 'SUBSAMPLE', kind: 'const', signature: 'SUBSAMPLE = 8', summary: 'Sub-samples per cell per axis.' },
    ],
  },
  {
    file: 'phasefield.ts',
    title: 'Phase-field electrodeposition',
    purpose:
      'An electrochemically driven Allen–Cahn model with Kobayashi anisotropy, coupled to ion transport. The same update rule exists twice, as a CPU step and as a GLSL fragment shader, and the tests hold them to each other.',
    conventions: 'Nondimensional lattice units. The state interleaves ξ (metal = 1) and C per cell.',
    usedBy: ['D3', 'landing-page hero'],
    exports: [
      {
        name: 'PFParams',
        kind: 'type',
        signature: 'interface PFParams { kappa0, delta, omegaMode, theta0, W, Lsigma, Leta, alpha, etaA, D, lambdaC, noise, dt }',
        summary: 'Model and stepping parameters. etaA is the dimensionless Fη/RT, negative for deposition.',
      },
      { name: 'PF_DEFAULTS', kind: 'const', signature: 'PF_DEFAULTS: PFParams', summary: 'The baseline the demo and hero start from.' },
      { name: 'seedState', signature: 'seedState(nx, ny, nuclei, rng?): Float32Array', summary: 'A flat electrode strip with nuclei on it.' },
      {
        name: 'cpuStep',
        signature: 'cpuStep(src, dst, nx, ny, P, frame): number',
        summary: 'One explicit step from src into dst. Returns how many cells hit a bound, which is the stability signal.',
      },
      {
        name: 'cflLimitDiffusive',
        signature: 'cflLimitDiffusive(P: PFParams): number',
        summary: 'The diffusion-only time-step bound. Necessary, not sufficient: past it the step is unstable outright.',
      },
      { name: 'cflLimit', signature: 'cflLimit(P: PFParams): number', summary: 'A stricter bound that folds in the reaction terms; conservative.' },
      {
        name: 'CLAMP_ALARM_FRACTION',
        kind: 'const',
        signature: 'CLAMP_ALARM_FRACTION = 0.19',
        summary: 'Fraction of clamped cells per step above which a run is reported as unstable. Normal operation sits near 5%.',
      },
      { name: 'surfaceMetrics', signature: 'surfaceMetrics(state, nx, ny): { interfaceCells, solidFraction, roughness }', summary: 'The demo’s live readouts.' },
      { name: 'STEP_SRC', kind: 'const', signature: 'STEP_SRC: string', summary: 'The GLSL ES 3.0 source of the GPU step.' },
    ],
  },
  {
    file: 'spm.ts',
    title: 'Single-particle discharge',
    purpose:
      'Galvanostatic discharge of an NMC811 | graphite cell with one representative particle per electrode: radial diffusion by implicit Euler, Butler–Volmer inverted analytically, and the two open-circuit curves.',
    conventions: 'SI, except C-rate in h⁻¹. No electrolyte gradient, so it is optimistic above roughly 2C.',
    usedBy: ['D6'],
    exports: [
      {
        name: 'simulateDischarge',
        signature: 'simulateDischarge({ cRate, T, radius, Dn?, Dp?, R0?, vMin?, nR?, nSteps? }): SPMRun',
        summary: 'Runs to the cut-off voltage, a stoichiometry limit, or the nominal time, and says which.',
      },
      { name: 'SPMParams', kind: 'type', signature: 'interface SPMParams', summary: 'Inputs to simulateDischarge, as above.' },
      {
        name: 'SPMRun',
        kind: 'type',
        signature: 'interface SPMRun { n, t, q, v, ocv, xSurf, ySurf, eta, capacity, capacityNominal, meanV, energy, cutoff }',
        summary: 'Time series and the summary numbers the demo reads out.',
      },
      { name: 'ocpGraphite', signature: 'ocpGraphite(x: number): number', summary: 'Graphite open-circuit potential vs Li/Li⁺, V (Chen et al. 2020 fit).' },
      { name: 'ocpNMC', signature: 'ocpNMC(y: number): number', summary: 'NMC811 open-circuit potential vs Li/Li⁺, V (Chen et al. 2020 fit).' },
      { name: 'CELL', kind: 'const', signature: 'CELL', summary: 'The representative LG M50-format cell the demo discharges.' },
    ],
  },
  {
    file: 'calc.ts',
    title: 'Bench formulas',
    purpose: 'The one-line formulas behind the calculators. Where a kernel already had the formula, it is re-exported, not rewritten.',
    conventions: 'SI, except where a name says otherwise (…MV in millivolts, cRateHours in hours).',
    usedBy: ['calculators'],
    exports: [
      { name: 'debyeLengthSymmetric', signature: 'debyeLengthSymmetric(epsR, T, c, z = 1): number', summary: 'Debye length of a z:z salt, m.' },
      { name: 'chargeTransferResistance', signature: 'chargeTransferResistance(j0, T, alphaSum = 1): number', summary: 'RT/((α_a+α_c)F j₀); A/cm² in gives Ω·cm² out.' },
      { name: 'nernstSlopeMV', signature: 'nernstSlopeMV(T, n = 1): number', summary: '(RT/nF)·ln 10 in mV per decade.' },
      { name: 'nernstPotential', signature: 'nernstPotential(E0, T, n, ratio): number', summary: 'E₀ + (RT/nF) ln(a_ox/a_red), V.' },
      { name: 'diffusionTime', signature: 'diffusionTime(L, D): number', summary: 'L²/D, s.' },
      { name: 'diffusionLength', signature: 'diffusionLength(D, t): number', summary: '√(Dt), m.' },
      { name: 'cottrellCurrent', signature: 'cottrellCurrent(n, A, cStar, D, t): number', summary: 'nFAc*√(D/πt), A.' },
      { name: 'cRateCurrent', signature: 'cRateCurrent(cRate, capacityAh): number', summary: 'Current in A for a capacity in A·h.' },
      { name: 'cRateHours', signature: 'cRateHours(cRate): number', summary: 'Nominal discharge time, 1/C, in hours.' },
      { name: 'bruggemanRatio', signature: 'bruggemanRatio(porosity, exponent = 1.5): number', summary: 'ε^b.' },
      { name: 'tortuosityFromRatio', signature: 'tortuosityFromRatio(porosity, deffRatio): number', summary: 'ε/(D_eff/D₀).' },
      { name: 'rcTimeConstant', signature: 'rcTimeConstant(R, C): number', summary: 'RC, s.' },
      { name: 'rcApexFrequency', signature: 'rcApexFrequency(R, C): number', summary: '1/(2πRC), Hz.' },
    ],
  },
  {
    file: 'linalg.ts',
    title: 'Linear algebra',
    purpose: 'The small dense and banded solvers underneath the kernels. No dependencies; everything is Float64Array, row-major.',
    usedBy: ['pnp.ts', 'diffusion.ts', 'spm.ts', 'drt.ts'],
    supporting: true,
    exports: [
      { name: 'solveTridiagonal', signature: 'solveTridiagonal(a, b, c, d): Float64Array', summary: 'Thomas algorithm. Throws on a zero pivot rather than returning garbage.' },
      { name: 'solveBlockTridiagonal', signature: 'solveBlockTridiagonal(A[], B[], C[], d, m): Float64Array', summary: 'Block Thomas with m×m blocks and partial-pivot LU per block; the PNP Newton update.' },
      { name: 'solveDense', signature: 'solveDense(A, b): Float64Array', summary: 'Partial-pivot LU for small n.' },
      { name: 'nnls', signature: 'nnls(A, b, m, n, { maxIter?, tol? }): Float64Array', summary: 'Lawson–Hanson active-set non-negative least squares.' },
    ],
  },
  {
    file: 'complex.ts',
    title: 'Complex arithmetic',
    purpose: 'Complex numbers as { re, im } pairs, with the overflow-safe tanh the finite-length Warburg needs.',
    usedBy: ['eis.ts', 'drt.ts', 'eisdata.ts'],
    supporting: true,
    exports: [
      { name: 'C', kind: 'type', signature: 'interface C { re: number; im: number }', summary: 'A complex number.' },
      { name: 'c', signature: 'c(re, im = 0): C', summary: 'Constructor.' },
      { name: 'cadd', signature: 'cadd(a, b): C', summary: 'Sum.' },
      { name: 'cmul', signature: 'cmul(a, b): C', summary: 'Product.' },
      { name: 'cdiv', signature: 'cdiv(a, b): C', summary: 'Quotient.' },
      { name: 'csqrt', signature: 'csqrt(a): C', summary: 'Principal square root.' },
      { name: 'ctanh', signature: 'ctanh(a): C', summary: 'tanh, saturating for |Re| > 20 instead of overflowing.' },
      { name: 'tanhSqrtOverSqrt', signature: 'tanhSqrtOverSqrt(z): C', summary: 'tanh(√z)/√z with its z → 0 limit, the finite-length Warburg kernel.' },
    ],
  },
  {
    file: 'plot.ts',
    title: 'Canvas plotting',
    purpose: 'The plots on every demo: linear and log axes, equal aspect for Nyquist, a pointer readout, held comparison traces and CSV export. Colours come from the page theme.',
    usedBy: ['every demo', 'EIS analyser', 'validation'],
    supporting: true,
    exports: [
      { name: 'Plot', kind: 'class', signature: 'new Plot(canvas, options?)', summary: 'draw(series, annotations), setOptions, hold, clearHeld, csv.' },
      { name: 'formatTick', signature: 'formatTick(v: number): string', summary: 'Axis text with real exponents: 10⁻⁴, 2×10⁵.' },
      { name: 'formatValue', signature: 'formatValue(v: number): string', summary: 'Readout text, four significant figures.' },
    ],
  },
  {
    file: 'csv.ts',
    title: 'CSV export',
    purpose: 'What the csv buttons write: the plotted arrays at full precision, one column per series.',
    usedBy: ['every demo', 'EIS analyser'],
    supporting: true,
    exports: [
      { name: 'columnsToCsv', signature: 'columnsToCsv(cols: { name, values }[]): string', summary: 'Columns side by side; short columns padded with empty cells.' },
      { name: 'seriesToCsv', signature: 'seriesToCsv(series, xName?, yName?): string', summary: 'One wide table when the series share an x axis, separate x columns when they do not. Never interpolates.' },
    ],
  },
  {
    file: 'urlstate.ts',
    title: 'Link state',
    purpose: 'How copy link turns a demo’s controls into a query string and back.',
    usedBy: ['every demo'],
    supporting: true,
    exports: [
      { name: 'encodeState', signature: 'encodeState(state: Record<string, string>): string', summary: 'Sorted query string.' },
      { name: 'decodeState', signature: 'decodeState(search: string): Record<string, string>', summary: 'The inverse.' },
      { name: 'readStateNumber', signature: 'readStateNumber(state, key, min, max): number | null', summary: 'A number from a link, clamped into the control’s range; null if absent or not a number.' },
    ],
  },
  {
    file: 'colormaps.ts',
    title: 'Colormaps',
    purpose: 'The viridis, plasma, cividis and inferno tables (matplotlib, CC0). The only source of colour in any plot or field on the site.',
    usedBy: ['every demo', 'posters'],
    supporting: true,
    exports: [
      { name: 'sample', signature: "sample(name, t): [r, g, b]", summary: 'Linear interpolation into a 256-entry table, t in [0, 1].' },
      { name: 'css', signature: 'css(name, t): string', summary: 'The same, as a CSS colour.' },
      { name: 'fieldToRGBA', signature: 'fieldToRGBA(name, field, rgba): void', summary: 'Colour a whole field into an ImageData buffer.' },
    ],
  },
];
