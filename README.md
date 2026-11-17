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
| Website with interactive demos — Butler–Volmer, PNP double layer, phase-field dendrites, EIS + live DRT inversion, microstructure tortuosity, single-particle discharge. Every demo has presets, CSV/PNG export, held comparison traces, and links that reopen it with the same settings | **Shipped** — an in-browser solver, in TypeScript, computed client-side |
| Tools: an EIS / DRT analyser for your own impedance data (paste or upload; peak table; λ sweep) and bench calculators (Debye length, Tafel slope, Sand's time, …) | **Shipped** — same kernels as the demos, nothing uploaded |
| In-browser solver kernels — Scharfetter–Gummel + damped Newton PNP, Lawson–Hanson NNLS, Tikhonov DRT, block-tridiagonal solves, RSA + CG tortuosity, single-particle discharge — covered by unit tests in `tests/` | **Shipped** (`src/lib/`, `tests/`) |
| Explicit phase field (`src/lib/phasefield.ts`) — the kernel behind the hero animation and the dendrite demo | **Shipped** — bounds, interface width and the stability limit are covered in `tests/phasefield.test.ts`; `complex.ts` and `colormaps.ts` have no tests of their own |
| Live validation page: Gouy–Chapman, Cottrell, MMS convergence order, Warburg 45°, DRT recovery — each with its error metric computed in-browser, and a scoreboard of measured value against tolerance | **Shipped** |
| Documentation: using the demos and tools, a kernel reference checked against the code by a unit test, and the Python package's design | **Shipped** |
| Python solver package (`voltaire-echem`) | **Planned** — no Python code in this repository yet |
| PyBaMM P2D comparison | **Not yet run** |

See the [roadmap](https://godtier812.github.io/Electrochemical-Cell-Simulator/roadmap/)
for the full status board.

## Quickstart (target API, not yet implemented)

The design for the Python package lives at
[docs/python](https://godtier812.github.io/Electrochemical-Cell-Simulator/docs/python/). None of it
is written; this is the interface it is being built to:

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
[browser demos](https://godtier812.github.io/Electrochemical-Cell-Simulator/demos/), and the DRT
inversion runs on your own data in the
[EIS / DRT analyser](https://godtier812.github.io/Electrochemical-Cell-Simulator/tools/eis/).

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
src/lib/                numerical kernels (TypeScript) — PNP, DRT, EIS, phase field, linalg —
                        plus the data parser, calculator formulas, CSV and link-state helpers
src/components/demos/   one component + module per demo, and the shared runtime (toolbar, links, export)
src/components/tools/   the EIS / DRT analyser
src/pages/              site content (MDX + Astro)
scripts/                build-time generators (posters, OG cards, gallery) and checks
tests/                  vitest unit tests for the numerics, the tools and the docs
```

The [kernel reference](https://godtier812.github.io/Electrochemical-Cell-Simulator/docs/kernels/)
documents `src/lib/` module by module.

## Develop the site locally

```bash
npm install
npm test          # numerics, tools, docs, parameter-mapping and registry tests
npm run dev       # http://localhost:4321/Electrochemical-Cell-Simulator/
npm run check     # type-check pages and components
npm run build     # static site in dist/, then the Pagefind search index
npm run posters   # regenerate posters/gallery/OG cards from the physics (seeded)
python3 scripts/check-links.py   # after a build: every internal link and #fragment resolves
```

The generated images are committed to `public/posters/` and `public/gallery/`.
If you change a poster input — the physics in `src/lib/`, the generator in
`scripts/generate-posters.ts`, or a page title that appears on a social card —
re-run `npm run posters` and commit the result, or the demo fallbacks and Open
Graph previews go stale. The generator is seeded, so identical inputs produce
byte-identical files and a no-op run leaves nothing to commit.

CI enforces this rather than trusting the instruction above, which was missed
twice: `scripts/check-posters.sh` regenerates into a temp directory (via
`VOLTAIRE_POSTER_OUT`, which redirects the generator's whole output tree) and
fails the build if any committed artefact differs, naming the offending files.
It generates twice and requires the two passes to agree first, so a genuine
loss of reproducibility is reported as itself rather than as a flaky build.

Images are compared by **decoded pixels**, not file bytes. `scripts/png.ts`
deflates its IDAT through `node:zlib`, a native library whose compressed output
differs between Node builds even when every pixel is identical — generating
under Node 22 and Node 26 on one machine yields 27 files that differ byte for
byte and none that differ by a pixel. `scripts/artifact-digest.mjs` inflates
the scanlines and undoes each row's PNG filter before hashing, so it compares
pixels whatever filter the encoder chose, which asks the question actually
worth asking and is stable across Node versions.

Deployment is GitHub Actions → GitHub Pages on push to `main`
(`.github/workflows/deploy.yml`).

## Cite

See [CITATION.cff](CITATION.cff) or the
[cite page](https://godtier812.github.io/Electrochemical-Cell-Simulator/cite/).

## Licence

[MIT](LICENSE) © 2026 Ashrith Repaka · 135552335+godtier812@users.noreply.github.com

Colormap data (viridis, plasma, inferno, cividis) from matplotlib, released
CC0 by their authors.
