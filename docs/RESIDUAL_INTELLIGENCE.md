# Residual Intelligence Layer

Residual Intelligence is the Phase III diagnostic layer for ExoLight Transit Lab. It turns the gap between the plotted model and the observed/synthetic light curve into a readable research signal.

## Purpose

The layer answers four practical questions:

1. How large is the residual scatter compared with the transit depth?
2. Which transit region appears to be the strongest mismatch?
3. Are outliers likely to matter for interpretation?
4. What should the researcher inspect next?

It is a diagnostic guide, not a formal fitting or detection engine.

## New modules

```text
src/intelligence/residualAnalysis.js
src/ui/residualInspector.js
src/ui/residualInspector.css
src/residualInspectorRuntime.js
docs/RESIDUAL_INTELLIGENCE.md
```

## Runtime design

The public site remains static and zero-dependency.

- `residualAnalysis.js` performs pure residual scoring and region classification.
- `residualInspector.js` renders the Residual Intelligence card.
- `residualInspector.css` styles the panel, region bars, and quality states.
- `residualInspectorRuntime.js` mounts the card into the existing dashboard before the transit plot.

The worker solver is not modified. The first version reads the visible model diagnostics and currently displayed controls. The analysis engine also accepts explicit residual samples, so a future deeper integration can pass real phase-residual arrays directly from the model state.

## Residual regions

The layer reports four regions:

```text
Ingress
Transit centre
Egress
Out of transit
```

When explicit samples are available, the engine calculates RMS by region. In the current browser runtime, the region map is inferred from visible diagnostics such as residual RMS, model depth, depth mismatch, inclination/impact geometry, and hypothesis-mode state.

## Score interpretation

```text
82-100  Stable residual behaviour
58-81   Watch carefully
35-57   Caution
0-34    Poor / waiting for useful diagnostics
```

The score compares residual RMS against model depth and checks whether residual scatter dominates the transit signal.

## Scientific boundaries

Residual Intelligence does not claim:

- a fitted posterior;
- a statistically significant anomaly;
- a starspot detection;
- an exomoon detection;
- an automatically corrected model;
- a publication-ready detrending result.

Its purpose is to surface where the model may be failing and to point the user toward the next inspection step.

## Current frontend order

```text
Observatory Deck
3D theoretical viewport
Mission Control audit
Residual Intelligence
Transit light curve plot
```

This creates a research workflow:

1. inspect target status;
2. view physical geometry;
3. read catalogue/model audit;
4. diagnose residual behaviour;
5. inspect the plotted light curve.

## Future upgrade path

Next improvements can add:

- direct residual arrays exported from `app.js`;
- a residual mini-strip under the main light curve;
- separate ingress and egress overlays on the canvas;
- a downloadable residual report;
- phase-bin statistics;
- robust outlier table;
- comparison of baseline, starspot, and exomoon residual behaviour.
