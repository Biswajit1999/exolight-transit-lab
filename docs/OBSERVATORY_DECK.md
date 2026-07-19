# ExoLight Observatory Deck

The Observatory Deck is the Phase III visual cockpit layer for ExoLight Transit Lab. It upgrades the frontend from a static dashboard into a mission-style research interface while keeping the project zero-dependency and GitHub Pages friendly.

## Purpose

The Deck gives the viewer an immediate visual summary of the selected target before they inspect the detailed Mission Control audit or the full transit plot.

It answers:

1. Which target is currently selected?
2. Is local photometry available or is the target model-only?
3. Is the current geometry circular baseline or eccentric?
4. Are hypothesis modes active?
5. How strong are the catalogue/model agreement, residual quality, and data completeness?
6. What is the approximate transit chord geometry?

## New modules

```text
src/observatoryDeckRuntime.js
src/ui/visualMeters.js
src/ui/geometryDiagram.js
src/ui/observatoryDeck.css
```

## Runtime design

The public app still runs as static HTML, CSS, and ES modules.

- `observatoryDeckRuntime.js` mounts the Observatory Deck into the existing `.main-panel`.
- `visualMeters.js` renders quality meters for readiness, depth agreement, residual quality, and data completeness.
- `geometryDiagram.js` renders a simplified SVG transit chord diagram.
- `observatoryDeck.css` controls the cockpit layout, responsive behaviour, and visual hierarchy.

The worker solver is not modified by this upgrade. The Deck reads the selected target, currently visible metrics, and control values from the existing page state.

## Visual components

### Mission readiness meter

Uses the structured Mission Control audit score to show whether the target is strong, usable with cautions, exploratory, or poorly constrained.

### Depth agreement meter

Compares catalogue transit depth against the currently displayed model depth. This is an interpretive consistency check, not a scientific detection score.

### Residual quality meter

Compares residual RMS against model depth so high-scatter cases become visually obvious.

### Data completeness meter

Summarises whether important catalogue fields are present: period, depth or radius ratio, inclination, stellar parameters, temperature, and local light-curve state.

### Geometry diagram

Shows a simplified star, projected transit chord, observer line, and orbit arc. It displays:

- approximate impact parameter `b`;
- inclination;
- scaled semi-major axis `a/R★`;
- radius ratio `Rp/R★`.

The diagram is intentionally explanatory rather than a formal orbit solution.

## Scientific boundaries

The Observatory Deck is an exploratory visualisation layer. It does not claim:

- a confirmed detection;
- a fitted posterior;
- a unique orbital solution;
- a starspot detection;
- an exomoon detection;
- a publication-ready model.

Its role is to help users understand the selected target quickly, identify inconsistencies, and decide what to inspect next.

## Frontend impact

The Deck changes the main-panel hierarchy to:

```text
Observatory Deck
3D theoretical viewport
Mission Control audit
Transit light curve plot
```

This creates a clearer visual story:

1. target overview;
2. physical scene;
3. audit and reasoning;
4. photometry and model curve.

## Future upgrade path

Next frontend extensions can add:

- a residual mini-strip under the transit plot;
- a catalogue-versus-model comparison table;
- a collapsible model-controls drawer;
- animated geometry transitions when `Rp/R★`, inclination, or `a/R★` change;
- a target comparison mode for two planets side by side;
- exportable SVG snapshots of the geometry panel.
