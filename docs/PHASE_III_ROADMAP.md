# ExoLight Transit Lab Phase III Roadmap

Phase III turns the current static zero-dependency prototype into a modular research toolkit without losing the GitHub Pages deployment simplicity.

## Current upgrade batch

Primary deliverable: modular physics foundation plus validation scaffold.

Implemented in this batch:

- `src/physics/constants.js` — named SI constants and unit labels.
- `src/physics/orbit.js` — preserved projected-orbit helpers and added period-to-semi-major-axis utilities.
- `src/physics/transit.js` — preserved numerical light-curve utilities and added observable helpers.
- `src/physics/validation.js` — HD 189733 b benchmark validation.
- `scripts/validate-physics.mjs` — command-line validation report.
- `src/toolkitBadge.js` — small runtime badge showing Phase III physics-core status.

## Weekly rotation plan

### Week 1 — Physics accuracy

Goal: separate reliable transit observables from UI code.

Deliverable: validated physics-core helpers for radius ratio, transit depth, semi-major axis, scaled distance, and approximate duration.

Done when:

- `npm run validate:physics` passes.
- HD 189733 b benchmark reports semi-major axis near 0.031 AU and depth near 20,625 ppm.
- The browser shows the Phase III toolkit badge.

### Week 2 — Data pipeline

Goal: define a stable local target schema and provenance record.

Deliverable:

- `data/schema/target.schema.json`
- a validation note for required fields: planet name, host name, period, radius ratio or depth, stellar radius/mass, light-curve source.

### Week 3 — HUD/UI

Goal: convert the scientific readout into a research cockpit rather than a decorative dashboard.

Deliverable:

- a compact `Model Assumptions` panel;
- a `Catalogue vs model` comparison strip;
- clearer warning labels for starspot and exomoon hypothesis modes.

### Week 4 — Architecture

Goal: keep the zero-dependency deployment but make code easier to extend.

Deliverable:

- `src/core/` for state and event orchestration;
- `src/ui/` for DOM rendering helpers;
- worker message contract documented in `docs/WORKER_PROTOCOL.md`.

### Week 5 — Testing and validation

Goal: add regression checks without adding a heavy framework.

Deliverable:

- Node-based validation scripts;
- benchmark outputs saved under `results/validation/`;
- browser smoke-test checklist for GitHub Pages.

## Stretch direction

After the core is stable, add a local JSON import workflow so users can test their own light curves while the public deployed archive remains safe and reproducible.
