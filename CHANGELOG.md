# Changelog

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
