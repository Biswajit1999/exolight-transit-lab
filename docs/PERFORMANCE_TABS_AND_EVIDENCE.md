# Phase III Performance Tabs and Evidence Cockpit

This upgrade responds to two project needs:

1. keep the public GitHub Pages interface fast and readable;
2. integrate the Phase III research report recommendations without turning ExoLight into a heavy archive clone.

## Why the layout changed

The previous single-screen version displayed too many active layers at once:

- WebGL theoretical viewport;
- transit plot;
- Observatory Deck;
- Mission Control;
- Residual Intelligence;
- Phase III toolkit badge;
- target archive and controls.

That made the interface visually dense and could slow low-power browsers. The new shell keeps the default landing view focused on the model and plot, while advanced diagnostics are available through top tabs.

## Tabs

| Tab | Purpose | Loading strategy |
|---|---|---|
| Model + Plot | Default lightweight view with scene, controls, and transit plot | Loaded immediately |
| Mission Control | Target audit, catalogue/model score, and Markdown export | Lazy-loaded |
| Observatory Deck | Geometry and visual diagnostic meters | Lazy-loaded |
| Residuals | Residual mismatch map and anomaly guidance | Lazy-loaded |
| Evidence | False-positive evidence cockpit and provenance preview | Lazy-loaded |

Only the selected advanced diagnostic runtime is imported when the visitor opens that tab. This preserves the zero-dependency architecture and avoids a framework rewrite.

## Research-report integration

The Phase III research report recommends that ExoLight should not try to out-compete MAST, Exo.MAST, NASA Exoplanet Archive, Lightkurve, DACE, or allesfitter at their strongest roles. Instead, it should become a browser-first, zero-dependency vetting cockpit that makes assumptions, evidence, provenance, and false-positive risks visible.

This upgrade implements the first practical step toward that goal:

- `src/physics/dilution.js` adds pure blend and dilution utilities.
- `src/data/provenance.js` adds provenance-event primitives.
- `src/intelligence/evidenceBuilder.js` creates human-readable diagnostic evidence objects.
- `src/ui/evidenceCockpit.js` renders a false-positive evidence cockpit.
- `src/evidenceCockpitRuntime.js` mounts the cockpit only when the Evidence tab is opened.
- `results/audits/provenance-example.json` shows the intended audit-manifest direction.

## Scientific boundary

The Evidence tab deliberately avoids overclaiming. Missing tests are displayed as `UNKNOWN`, not as `PASS`. Current quick-look checks are not false-positive probabilities and are not validation claims.

The intended language is:

- depth inconsistency;
- dilution risk;
- secondary-eclipse check unavailable;
- centroid or neighbour evidence unavailable;
- provenance partial;
- systematics not yet linked.

Avoid language such as:

- exomoon detected;
- spoof detected;
- planet validated;
- false-positive probability measured.

## Next report-driven upgrades

Recommended order:

1. add per-target provenance export into the existing Mission Control Markdown export;
2. add an odd-even and secondary-eclipse analyzer once per-transit or sector-level data are available;
3. cache Gaia neighbour lists separately from `data/exoplanets.json`;
4. add a sector/quarter systematics timeline;
5. add a deterministic audit schema and exporter;
6. add maintainer-side injection-recovery and perturbation-resilience scripts.

## Manual smoke test

After deployment:

1. open the site in a hard-refresh browser session;
2. confirm the default view shows only Model + Plot as the active diagnostic mode;
3. open each tab once and confirm it loads without a console error;
4. return to Model + Plot and confirm the heavy diagnostic panels are hidden;
5. select a different target and confirm lazy diagnostics update after reopening the tab;
6. export Evidence JSON and Mission Control Markdown for one target.
