# Voltaire — site design plan

This is the Phase 1 design plan required by the project brief, including the
self-critique pass. The built site follows this document; when the two
disagree, this document is wrong and should be updated.

## 1. Palette

Six named values. The accent system is a perceptually-uniform colormap ramp
(viridis), not a single accent colour — the one visual language every
computational scientist already reads fluently.

| Name            | Hex       | Rationale |
|-----------------|-----------|-----------|
| `paper`         | `#F5F7F9` | Light background. Cool laboratory white — deliberately not cream, which is the current AI-default. |
| `ink`           | `#1A2129` | Light-theme text and dark-theme surface lines. Blue-black of printed journal ink, softer than `#000`. |
| `carbon`        | `#0E1116` | Dark background. Anodised-chassis charcoal with a blue cast; paired with `#151A21` raised surfaces so the dark theme has depth, not a void. |
| `viridis-teal`  | `#2A788E` | Primary interactive colour on light backgrounds (links, buttons). Mid-ramp viridis; 4.9:1 on `paper`. |
| `viridis-green` | `#22A884` | Primary interactive colour on dark backgrounds; 6.3:1 on `carbon`. The teal/green pair are adjacent ramp stops, so the two themes feel like the same instrument under different lighting. |
| `viridis-yellow`| `#FDE725` | Ramp terminus. Reserved for exactly two jobs: keyboard focus rings and data emphasis in plots. Never decoration. |

Status badges use ramp stops too: shipped = `viridis-green`, in-progress =
`viridis-teal`, planned = neutral grey outline, research = `#440154`
(ramp origin) outline. The full 256-entry viridis/plasma/cividis LUTs live in
`src/lib/colormaps.ts` and are the *only* source of colour in every demo.

## 2. Type

Three roles, three actual faces, all self-hosted woff2 via Fontsource:

- **Display — IBM Plex Sans Condensed 600/700.** Instrument-panel signage.
  Used with restraint: hero headline, page titles, section headings. Nowhere
  else.
- **Body — STIX Two Text 400/400i/600.** The face designed for scientific
  publishing (STIX = Scientific and Technical Information Exchange). It sits
  naturally next to KaTeX output and gives long-form physics pages the
  register of a well-set methods section rather than a blog.
- **Utility — IBM Plex Mono 400/500.** Every number the site shows: axis
  labels, live readouts, units, captions, tables of symbols, code, and the
  letterspaced small-caps section labels. If it is data, it is mono.

Scale: 1.250 ratio, body 17px/1.65 (STIX runs small), mono always one step
below its context.

## 3. Layout

Concept: **bench sheet**. A quiet reading column with instrument hardware
embedded in it. Content column is 70ch; physics/docs pages add a left nav
rail and a right in-page TOC at ≥1100px, both collapsing cleanly. The landing
page uses a 12-column fluid grid capped at 1200px. Demos break out of the
reading column to full grid width.

A 3px viridis ramp rule runs across the very top of every page — the site's
identity mark — and a 1px hairline version separates major landing sections.

Hero wireframe:

```
┌──────────────────────────────────────────────────────────────┐
│ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒ viridis ramp rule (3px) ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ │
│ VOLTAIRE      physics numerics demos validation docs   ◐    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   ░░░░░░ live phase-field dendrite, WebGL2, full bleed ░░░░  │
│   ░░░░░ branches growing upward from bottom electrode ░░░░░  │
│   ░░                                                    ░░░  │
│   VOLTAIRE                                    ┌───────────┐  │
│   From the double layer to capacity fade.     │ η  120 mV │  │
│   A multiphysics solver for ion transport,    │ δ   0.04  │  │
│   interfacial kinetics, degradation…          │ t  4.21 s │  │
│                                               └───────────┘  │
│   [ Read the physics ]   [ View on GitHub ]    (readout)     │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│   one-paragraph pitch, 70ch, STIX Two Text                   │
└──────────────────────────────────────────────────────────────┘
```

Physics page wireframe (≥1100px):

```
┌────────┬───────────────────────────────────────────┬────────┐
│ nav    │  TRANSPORT                                │ On this│
│ rail   │  Nernst–Planck and concentrated solutions │ page   │
│        │                                           │ · flux │
│ · trans│  Body prose, 70ch, STIX ................. │ · CST  │
│ · kinet│  ┌─────────────────────────────────────┐  │ · PNP  │
│ · degra│  │ (eq. 1)   J_i = -D_i ∇C_i - …  [⧉] │  │ · EDL  │
│ · dendr│  └─────────────────────────────────────┘  │        │
│ · therm│  symbol table: mono, units column ....... │        │
│ · imped│  ┌── DEMO: potentiostat-panel controls ─┐ │        │
│        │  │ j₀ [────●──] 1.0e-3 A/cm²  T 298 K   │ │        │
│        │  └──────────────────────────────────────┘ │        │
└────────┴───────────────────────────────────────────┴────────┘
```

## 4. Signature

**The live dendrite hero plus potentiostat-grade control panels.** The hero
is the phase-field solver itself running in a fragment shader — the project's
actual physics as the site's first impression. Every demo's controls are
styled as an instrument front panel: bordered fieldset with an engraved
small-caps mono legend, sliders with tick marks, and live monospaced readouts
with unit suffixes (`λ_D = 0.96 nm`, not a bare number). That panel language
is the one aesthetic risk, spent deliberately in one place; the prose around
it stays quiet and journal-like.

## 5. Self-critique (required pass)

Honest question: would this plan have come out the same for a generic SaaS
site? First draft failed in three places, revised as follows:

1. **Dark theme drifted toward the banned "near-black + one acid accent"
   look.** A charcoal page with a single `#22A884` accent is exactly look #2
   on the forbidden list wearing a lab coat. Fix: the accent is a *system* —
   adjacent viridis stops per theme, ramp-stop badge colours, yellow reserved
   for focus/data — and the light theme is designed first-class, not
   inverted. The ramp rule at the top of the page makes the system legible as
   a colormap rather than "a green".
2. **Body face was initially Inter.** That is a default, not a decision.
   STIX Two Text is chosen *because of the subject*: it is the typeface of
   scientific publishing and it harmonises with the KaTeX math that carries
   half this site's content.
3. **First-draft capability grid used numbered `01/02/03` markers.** Banned,
   and rightly — a feature grid has no order. Numbers now appear exactly once
   on the site: the roadmap, which genuinely is a sequence.

Kept after scrutiny: the viridis accent system (domain-authentic, and not a
look current AI output ships); the instrument-panel controls (they earn their
keep by carrying real units and live readouts, not as decoration).
