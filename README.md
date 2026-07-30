# Voltaire

**From the double layer to capacity fade.** A multiphysics solver for ion
transport, interfacial kinetics, degradation, and thermal behaviour in
electrochemical cells — with autodiff Jacobians shared across Newton,
impedance, and inverse design.

![Phase-field dendrites growing from a flat electrode, computed by this
project's electrodeposition model and rendered in viridis](public/posters/hero.png)

**Website & live demos: <https://godtier812.github.io/Electrochemical-Cell-Simulator/>**

That dendrite forest is not an illustration: it is the project's
electrochemically driven Allen–Cahn phase-field model. On the website it runs
live in a WebGL2 fragment shader; the frame above was computed by the same
update rule at build time.

## What exists today, honestly

| Piece | Status |
| --- | --- |
| Website with interactive demos — Butler–Volmer, PNP double layer, phase-field dendrites, EIS + live DRT inversion, microstructure tortuosity, single-particle discharge | **Shipped** — an in-browser solver, in TypeScript, computed client-side |
| In-browser solver kernels — Scharfetter–Gummel + damped Newton PNP, Lawson–Hanson NNLS, Tikhonov DRT, block-tridiagonal solves, RSA + CG tortuosity, explicit phase field, single-particle discharge — covered by unit tests in `tests/` | **Shipped** (`src/lib/`, `tests/`) |
| Live validation page: Gouy–Chapman, Cottrell, MMS convergence order, Warburg 45°, DRT recovery — each with its error metric computed in-browser | **Shipped** |
| Python solver package (`voltaire-echem`) | **Planned** — no Python code in this repository yet |
| PyBaMM P2D comparison | **Not yet run** |

See the [roadmap](https://godtier812.github.io/Electrochemical-Cell-Simulator/roadmap/)
for the full status board.

## Quickstart (target API, not yet implemented)

```python
import voltaire as vt

cell = vt.Cell.from_preset("graphite-nmc-1d")
result = cell.discharge(c_rate=1.0, t_end="1h")
result.plot("voltage")

spec = cell.impedance(f_min=0.01, f_max=1e5, n=50)   # one linear solve per frequency
spec.plot("nyquist")
drt = spec.drt(lambda_reg=1e-2)                       # Tikhonov-NNLS inversion
drt.plot()
```

Until the package ships, the same physics is runnable right now in the
[browser demos](https://godtier812.github.io/Electrochemical-Cell-Simulator/demos/).

## The architectural idea

One residual `R(u, p)`, differentiated once. The same Jacobian `J = ∂R/∂u`
drives three consumers:

- **Newton** — `J δu = −R` for steady states and implicit time steps
- **Impedance** — `(iωM − J) û = b̂`, one complex solve per frequency, no
  time-domain integration
- **Adjoint design** — `Jᵀλ = −∂Q/∂u`, giving `dQ/dp` for thousands of
  parameters at the cost of one extra solve

Details: [numerics](https://godtier812.github.io/Electrochemical-Cell-Simulator/numerics/).

## Repository layout

```
src/lib/          numerical kernels (TypeScript) — PNP, DRT, EIS, phase field, linalg
src/components/   site components and demo modules
src/pages/        site content (MDX + Astro)
scripts/          build-time generators: posters, OG image, gallery figures
tests/            vitest unit tests for the numerics
```

## Develop the site locally

```bash
npm install
npm test          # numerics, parameter-mapping and registry tests
npm run dev       # http://localhost:4321/Electrochemical-Cell-Simulator/
npm run build     # static site in dist/, then the Pagefind search index
npm run posters   # regenerate posters/gallery/OG cards from the physics (seeded)
```

`npm run posters` is **not** run by CI, and its output is committed to
`public/posters/` and `public/gallery/`. If you change a poster input — the
physics in `src/lib/`, the generator in `scripts/generate-posters.ts`, or a page
title that appears on a social card — re-run it and commit the regenerated
images, or the demo fallbacks and Open Graph previews go stale. The generator is
seeded, so identical inputs produce byte-identical files and a no-op run leaves
nothing to commit.

Deployment is GitHub Actions → GitHub Pages on push to `main`
(`.github/workflows/deploy.yml`).

## Cite

See [CITATION.cff](CITATION.cff) or the
[cite page](https://godtier812.github.io/Electrochemical-Cell-Simulator/cite/).

## Licence

[MIT](LICENSE) © 2026 Ashrith Repaka · repaka.ashrith@gmail.com

Colormap data (viridis, plasma, inferno, cividis) from matplotlib, released
CC0 by their authors.
