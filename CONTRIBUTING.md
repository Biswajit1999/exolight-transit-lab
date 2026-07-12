# Contributing to ExoIntel-Prime

Thank you for helping improve this browser-based exoplanet transit laboratory. Contributions are welcome across the scientific model, interface, documentation, accessibility, and curated data examples.

## Before you start

Open an issue before making a large scientific or architectural change. Small documentation fixes, accessibility improvements, and clearly isolated bug fixes can go directly to a pull request.

Please keep every contribution aligned with the project's central boundary: the application is an interactive scientific visualisation and education tool, not a formal detection or parameter-inference pipeline.

## Local setup

The public site uses plain HTML, CSS, and JavaScript ES modules. From the repository root, start a local server:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000` in a modern browser.

## Contribution areas

### Scientific model

- State the physical assumption or equation being changed.
- Preserve unit consistency and parameter bounds.
- Explain whether a result is exact, approximate, pedagogical, or qualitative.
- Do not present a visual match as evidence for a detection.
- Keep catalogue values, synthetic demonstrations, and user-provided data clearly separated.

### Target and light-curve data

- Record the original source and processing history.
- Normalise out-of-transit flux near 1 where appropriate.
- Remove or flag NaN, infinite, and severe outlier values.
- Keep files compact enough for browser loading.
- Do not commit restricted, private, or unlicensed data.

### Interface and visualisation

- Keep controls understandable on desktop and mobile.
- Preserve keyboard accessibility and meaningful labels.
- Avoid decorative graphics that imply unsupported measurements.
- Test both light and night modes when changing presentation code.

### Documentation

- Prefer concise, reproducible instructions.
- Distinguish measured data, catalogue metadata, model output, and illustrative rendering.
- Update the README when behaviour, file formats, or scientific limitations change.

## Pull-request workflow

1. Create a focused branch from `main`.
2. Make one coherent change per pull request.
3. Test the public workflow locally.
4. Summarise the scientific and software impact.
5. Link any relevant issue.

## Pull-request checklist

- [ ] The application loads through a local HTTP server.
- [ ] Existing target selection and transit rendering still work.
- [ ] Scientific assumptions and limitations are documented.
- [ ] Data provenance is preserved for any new dataset.
- [ ] No detection claim or unsupported precision has been introduced.
- [ ] Desktop and mobile behaviour have been checked when the interface changes.
- [ ] The README or user guide has been updated where necessary.

## Reporting issues

A useful issue should include:

- the target or control state involved;
- browser and operating system;
- steps to reproduce;
- expected and observed behaviour;
- screenshots or console output when relevant;
- whether the issue affects the scientific result, the visualisation, or both.

By contributing, you agree to keep discussion respectful, evidence-based, and focused on improving the project.