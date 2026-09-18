# Changelog

## v1.4.0 — Correlated-noise injection–recovery

- Added four deterministic 1,000-trial transit-depth injection scenarios.
- Compared naïve independent-sample and event-cluster uncertainty estimates.
- Rejected the predeclared coverage null: correlation changed naïve 95%
  coverage by 0.394, while event-cluster coverage remained 0.932.
- Demonstrated a shallow correlated-noise case where naïve and cluster-aware
  three-sigma detection rates differ (0.980 versus 0.612).
- Made committed validation reports deterministic by removing wall-clock
  timestamps from generated content.
- Added machine-readable results, a methods/limitations report, tests, and a
  before/after research-maturity audit.

## v1.3.0 — Research Data Lineage HUD

### Added

- Research-facing Data Lineage panel for the Evidence cockpit.
- Explicit source → local dataset → processing → analysis presentation for attached archival products.
- Distinct model-only state so theoretical exploration cannot be mistaken for an attached observation.
- `COMPLETE`, `PARTIAL`, `UNKNOWN`, and `INVALID` lineage states.
- HTML-safe rendering for archive, file, transform, model, and diagnostic metadata.
- Deterministic HUD lineage tests and `npm run validate:hud`.

### Research integrity

Unknown historical metadata remains visibly unknown. Model-only targets explicitly state that no archival observation is attached. The raw provenance record remains available for inspection below the human-readable lineage.

### Architecture

The lineage component is zero-dependency and separates data interpretation from HTML rendering. It consumes the existing provenance payload and current Evidence diagnostics without adding archive/network logic to the UI.

### Validation

Run the full suite with:

```bash
npm run validate
```

or the focused HUD tests with:

```bash
npm run validate:hud
```

## v1.2.0 — Provenance-aware dataset manifests

### Added

- Zero-dependency dataset manifest primitives for archival inputs.
- Structural validation and completeness scoring for historical and current dataset metadata.
- Sidecar provenance convention under `data/provenance/`.
- AU Mic b as the first migrated archival light-curve manifest.
- Evidence cockpit loading of per-target dataset manifests.
- Deterministic dataset-manifest validation tests.

### Data integrity

Historical metadata that was not preserved remains explicitly `unknown`. The first AU Mic b manifest records the known MAST/Lightkurve lineage without inventing a product identifier, mission label, archive version, or retrieval date.

### Validation

Run the complete scientific validation suite with:

```bash
npm run validate
```

The focused manifest command is:

```bash
npm run validate:manifests
```

### Architecture boundary

Physics modules remain independent of archive providers and browser data-fetch logic. Dataset manifests are translated into provenance events before the Evidence layer consumes them.

## v1.1.0 — Transit geometry plausibility

### Added

- Pure, dependency-free transit geometry plausibility module.
- Impact-parameter screening for full, grazing, and non-transiting configurations.
- Approximate duration comparison with eccentric-orbit velocity scaling.
- Explicit `UNKNOWN` output for missing or invalid orbital metadata.
- Geometry plausibility result in the Evidence cockpit.
- Deterministic tests for central, grazing, non-transiting, eccentric, missing-data, duration-agreement, duration-mismatch, and invalid-eccentricity cases.

### Validation

Run the complete scientific validation suite with:

```bash
npm run validate
```

The new focused command is:

```bash
npm run validate:plausibility
```

### Scientific boundary

The geometry result is a deterministic quick-look plausibility screen. It is not posterior inference, a false-positive probability, uncertainty propagation, or a replacement for a professional transit-fitting package.
