# Changelog

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
