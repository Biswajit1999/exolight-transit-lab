# Catalogue Expansion and Data Ripple Interpretation

## Why the archival data can look rippled

The plotted blue points are observational photometry, not a perfect mathematical transit curve. They can contain structure from several sources:

- photon noise and detector noise;
- stellar variability, granulation, rotation, flares, or starspot modulation;
- imperfect detrending or normalisation;
- cadence and exposure-time effects;
- phase-folding many separate transits into one view;
- transit timing variations or small ephemeris offsets;
- blended light from nearby stars;
- instrument systematics such as scattered light, momentum dumps, pointing changes, or aperture changes.

The orange model curve is intentionally a smooth baseline forward model. It shows the expected transit morphology for the current parameters: radius ratio, scaled semi-major axis, inclination, eccentricity, limb darkening, exposure integration, and optional hypothesis layers. It does not automatically fit every ripple in the data.

This distinction is important: ripples are not automatically planet physics. They should be routed into residual analysis, systematics review, detrending checks, timing checks, and provenance review before interpretation.

## Why the model usually has one dip

For a single planet on a stable orbit, a phase-folded primary transit normally appears as one main brightness dip around transit phase. Additional structure may appear only when the data or model includes additional effects such as:

- stellar activity crossing events;
- moon-like occultors;
- secondary eclipses near phase 0.5;
- multiple planets folded on the wrong period;
- transit timing variations;
- poor detrending or contaminated apertures.

ExoLight keeps the baseline model smooth so the user can immediately see the difference between the assumed physical model and the observed data. The Residuals and Evidence tabs then explain where that simple model disagrees with the data.

## Catalogue expansion strategy

The original local archive contains 500 curated targets and remains the offline baseline. The Phase III expansion adds a runtime supplement from the NASA Exoplanet Archive Planetary Systems Composite Parameters table (`pscomppars`).

The runtime wrapper:

1. intercepts only the request for `data/exoplanets.json`;
2. reads the local 500-target catalogue;
3. fetches a lightweight transiting-planet supplement from NASA TAP when the browser allows it;
4. converts NASA transit depth from percent into ExoLight's ppm convention;
5. deduplicates by host and planet name;
6. marks remote-only targets as `lightcurve_available: false` because no local light-curve JSON is bundled for them;
7. caches the supplement in browser local storage for faster repeat visits.

This preserves the zero-dependency GitHub Pages design while exposing more confirmed transiting planets for model-only exploration.

## Scientific boundary

The expanded catalogue is suitable for browsing, model visualisation, and target discovery. It is not a replacement for a local validated light-curve archive. A target added from the runtime NASA supplement should be treated as model-only until a local light curve and provenance record are attached.

The correct language is:

- `local archive target` for bundled targets with local JSON light curves;
- `runtime NASA supplement` for extra catalogue-only targets;
- `model-only target` when no local photometry is bundled;
- `observed photometry` only when `lightcurve_available` is true and a local file exists.
