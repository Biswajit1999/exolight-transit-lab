<div align="center">

# 🪐 ExoIntel-Prime

### ExoLight Transit Lab — Browser-Based Exoplanet Transit Photometry Laboratory

**A free, zero-dependency browser lab for exploring real exoplanet transit photometry, forward-modelled transit physics, residual diagnostics, and provenance-aware evidence checks. No install, no login, no build step.**

[![Live demo](https://img.shields.io/badge/live%20demo-open%20lab-4fc3f7?style=for-the-badge)](https://biswajit1999.github.io/exolight-transit-lab/)
[![License: MIT](https://img.shields.io/github/license/Biswajit1999/exolight-transit-lab?style=flat-square)](LICENSE)
[![Stars](https://img.shields.io/github/stars/Biswajit1999/exolight-transit-lab?style=flat-square)](https://github.com/Biswajit1999/exolight-transit-lab/stargazers)
[![Last commit](https://img.shields.io/github/last-commit/Biswajit1999/exolight-transit-lab?style=flat-square)](https://github.com/Biswajit1999/exolight-transit-lab/commits/main)
[![Physics core validated](https://img.shields.io/badge/physics%20core-validated-4caf50?style=flat-square)](results/validation/reference-summary.md)
[![Zero dependencies](https://img.shields.io/badge/dependencies-zero-informational?style=flat-square)](package.json)

🌐 **Live website:** [Open ExoIntel-Prime](https://biswajit1999.github.io/exolight-transit-lab/)

![ExoIntel-Prime Dashboard](assets/exointel-prime-dashboard.png)

</div>

---

## Why this project is different

**ExoIntel-Prime** is a browser-based exoplanet transit photometry laboratory designed for scientific visualisation, education, and research communication. It compares locally cached archival light curves with a worker-computed theoretical transit model and renders the corresponding star–planet system in a realistic browser scene.

This is not a synthetic astronomy toy. The project is built around four principles:

- **Real light-curve context** — local archival photometry is displayed against the model where available, while model-only targets are labelled honestly.
- **Separation between data, model, and hypotheses** — catalogue values, worker-computed model values, starspot demonstrations, and exomoon-like demonstrations are kept visibly distinct.
- **Validated scientific core** — physics helpers and deterministic reference cases are checked through `npm run validate` and GitHub Actions.
- **Static-first reproducibility** — the public website runs directly from GitHub Pages using plain HTML, CSS, and JavaScript ES modules.

There is no React, Vite, npm runtime dependency, bundler, server, login, or cloud database required for the public website.

---

## Purpose

A planetary transit occurs when an exoplanet passes in front of its host star from the observer’s line of sight. The star’s brightness drops by a small amount, and the shape of that dip contains information about the planet radius, orbital inclination, scaled orbital distance, stellar limb darkening, and possible additional effects such as starspots or moon-like occultors.

ExoIntel-Prime is built to make that connection visible:

- the **points** show archival or locally processed photometry;
- the **curve** shows the theoretical browser-computed model;
- the **scene** shows the corresponding star–planet geometry;
- the **diagnostic tabs** show Mission Control, Observatory Deck, Residuals, and Evidence checks;
- the **scientific readout** explains the model diagnostics in plain language.

The model curve is computed from a physical forward model in a Web Worker, while the interface remains responsive.

---

## Current public version

The current version includes:

- worker-backed transit modelling;
- quadratic limb darkening;
- finite exposure-time integration;
- circular and approximate eccentric projected geometry;
- optional starspot morphology;
- optional exomoon hypothesis mode;
- live residual and out-of-transit diagnostics;
- Mission Control target audits;
- Observatory Deck visual diagnostics;
- Residual Intelligence charts;
- false-positive Evidence cockpit;
- realistic stellar photosphere rendering;
- temperature-based stellar colour;
- light and night mode;
- static GitHub Pages deployment;
- deterministic reference regression checks.

---

## Scientific model

### Transit depth

For a small planet crossing a uniform stellar disk, the approximate transit depth is

```text
δ ≈ (Rp / R★)^2
```

where:

* `Rp` is the planetary radius;
* `R★` is the stellar radius;
* `Rp/R★` is the radius ratio.

ExoIntel-Prime displays the model depth both as a percentage and in parts per million:

```text
10,000 ppm = 1%
```

This makes the result easier for general users while preserving the standard photometric unit used in exoplanet studies.

---

### Limb darkening

The model uses the quadratic limb-darkening law:

```text
I(μ) = 1 - u1(1 - μ) - u2(1 - μ)^2
```

where:

```text
μ = cos(θ)
```

The sliders `u1` and `u2` control the stellar centre-to-limb brightness profile. Changing these values affects the ingress, egress, and transit-bottom shape.

---

### Numerical disk integration

The stellar disk is sampled numerically. Each visible surface sample has a position and intensity weight. At each orbital phase, the worker checks which samples are blocked by the planet and optional moon-like body.

Conceptually:

```text
F(phase) = 1 - blocked stellar intensity / total stellar intensity
```

This allows the same browser model to handle:

* limb-darkened transits;
* starspot-modified intensity maps;
* planet + moon occultation geometry;
* finite exposure integration.

---

### Finite exposure integration

Real telescopes do not measure instantaneous brightness. They integrate light over a finite exposure time. ExoIntel-Prime approximates this by averaging multiple sub-samples across each model phase point.

This helps avoid unrealistically sharp ingress and egress features, especially for long-cadence or binned photometry.

---

### Eccentric geometry

The worker supports catalogue eccentricity and argument of periastron where available. The eccentric geometry is an interactive projected-orbit approximation, useful for visual and educational exploration.

It should not be interpreted as a complete eccentric-orbit fitting engine.

---

## Validation and regression checks

The scientific core is protected by two validation layers:

```bash
npm run validate:physics
npm run validate:references
npm run validate
```

`validate:physics` checks the Phase III physics benchmark around HD 189733 b.  
`validate:references` runs deterministic golden-case regressions for:

- HD 189733 b benchmark values;
- a synthetic central transit;
- a synthetic non-transiting geometry;
- a synthetic dilution/blend correction case.

The generated evidence files are stored in:

```text
results/validation/reference-report.json
results/validation/reference-summary.md
```

These checks are designed to detect silent scientific drift. They are not detection claims, posterior inference results, or false-positive probabilities.

---

## Interface overview

### Target archive

The left panel lists targets from:

```text
data/exoplanets.json
```

Targets with local photometry are marked as observed. Targets without local photometry can use a synthetic demonstration fallback.

Visitors cannot directly modify the live production archive. To test custom data, fork the repository and add your own JSON files.

---

### Scientific readout

The readout panel includes:

* **Brightness dip** — modelled transit depth in percent and ppm;
* **Radius proxy** — approximate `sqrt(depth)` estimate of `Rp/R★`;
* **Depth contrast** — model depth divided by out-of-transit scatter;
* **Residual RMS** — data minus model scatter;
* **OOT RMS** — out-of-transit scatter;
* **Moon signal** — optional hypothesis contribution;
* **Spot boost** — starspot-crossing anomaly estimate;
* **Planet parameters** — period, duration, depth, inclination, eccentricity, radius, mass;
* **Host star parameters** — effective temperature, radius, mass, metallicity where available.

Small question-mark icons explain scientific terms for non-specialist users.

---

### Diagnostic tabs

The interface is split into five lightweight tabs:

| Tab | Purpose |
|---|---|
| Model + Plot | Default light view: scene, model controls, and light curve |
| Mission Control | Target audit, quality bars, provenance snapshot, recent events, exports |
| Observatory Deck | Geometry and visual diagnostics |
| Residuals | Residual scatter, binned residuals, and quick-look systematics charts |
| Evidence | False-positive evidence readiness with explicit `PASS`, `CAUTION`, and `UNKNOWN` states |

The non-default tabs are lazily mounted to keep the first page load responsive.

---

### Stellar model viewport

The main viewport renders a theoretical model of the selected system. The star colour is tied to the catalogue effective temperature `st_teff` where available.

The scene includes:

* realistic stellar photosphere texture;
* procedural granulation;
* limb-darkened stellar disk;
* dark transit silhouette;
* optional starspot visualisation;
* optional moon-like silhouette;
* target-dependent stellar colour.

The visual scene is designed for intuition and communication. The plotted model curve still comes from the worker physics engine.

---

### Model controls

The right panel provides live “what-if” controls:

| Group               | Controls                                            |
| ------------------- | --------------------------------------------------- |
| Rendering           | Visual quality: Low, Balanced, Ultra                |
| Planet and orbit    | Radius ratio, scaled distance, inclination          |
| Stellar atmosphere  | Quadratic limb-darkening coefficients `u1`, `u2`    |
| Starspot morphology | Enable spot, position, radius, contrast             |
| Exomoon hypothesis  | Enable moon, moon radius, moon distance, moon phase |
| Model alignment     | Phase shift                                         |

The catalogue eccentricity and argument of periastron are passed to the worker when available, but are kept read-only in the public interface to avoid unphysical manual combinations.

---

## Important scientific caution

ExoIntel-Prime is an interactive scientific visualisation, education, and research-communication tool. It is not yet a formal professional fitting pipeline.

A good visual match does **not** prove:

* an exomoon;
* a starspot;
* a unique orbital solution;
* a validated planet parameter set;
* a detection claim.

Formal analysis would require additional steps such as:

* uncertainty-weighted fitting;
* detrending and systematics modelling;
* dilution/blending treatment;
* parameter priors;
* posterior inference;
* model comparison;
* validation against established modelling tools.

The exomoon and starspot modes are hypothesis demonstrations only. Evidence badges must show `UNKNOWN` when the required data are missing; the project should never show a pass state for an unavailable diagnostic.

---

## Repository structure

```text
exolight-transit-lab/
├── index.html
├── styles.css
├── package.json
├── README.md
│
├── src/
│   ├── app.js
│   ├── sceneRealistic.js
│   ├── transitWorker.js
│   ├── physics/
│   ├── intelligence/
│   └── ui/
│
├── data/
│   ├── exoplanets.json
│   └── lightcurves/
│
├── tests/
│   ├── referenceTargets.json
│   └── helpers/
│
├── scripts/
│   ├── validate-physics.mjs
│   └── run-reference-regressions.mjs
│
├── results/
│   └── validation/
│
├── assets/
│   └── exointel-prime-dashboard.png
│
└── docs/
```

---

## Running locally

Because the project uses JavaScript ES modules, open it through a local server rather than double-clicking `index.html`.

From the repository root:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

To run the scientific validation suite:

```bash
npm run validate
```

---

## Deploying to GitHub Pages

Use GitHub Pages with:

```text
Source: Deploy from a branch
Branch: main
Folder: /root
```

The app works from the repository root because `index.html` is already at the top level.

After pushing updates, GitHub Pages can take a short time to refresh. If the website still shows the old version, open the page and press:

```text
Ctrl + F5
```

or test with a cache-busting URL:

```text
https://biswajit1999.github.io/exolight-transit-lab/?v=latest
```

---

## Adding custom targets

To add your own target, fork the repository and edit:

```text
data/exoplanets.json
```

Example target entry:

```json
{
  "pl_name": "HD 189733 b",
  "hostname": "HD 189733",
  "discoverymethod": "Transit",
  "disc_year": 2005,

  "pl_orbper": 2.21857567,
  "pl_ratror": 0.15534,
  "pl_trandep": 24000,
  "pl_trandur": 1.823,
  "pl_orbincl": 85.71,
  "pl_orbeccen": 0.0,
  "pl_orblper": 90.0,

  "pl_rade": 12.7,
  "pl_bmasse": 363.0,

  "st_teff": 5052,
  "st_rad": 0.75,
  "st_mass": 0.79,
  "st_logg": 4.55,
  "st_met": -0.03,

  "lightcurve_file": "hd-189733-b.json",
  "lightcurve_available": true
}
```

---

## Adding custom light curves

Add the light curve file under:

```text
data/lightcurves/
```

Example array format:

```json
{
  "source": "local processed light curve",
  "phase": [-0.050, -0.049, -0.048],
  "flux": [1.0002, 0.9999, 1.0001],
  "error": [0.0004, 0.0004, 0.0004]
}
```

Example point-list format:

```json
{
  "source": "local processed light curve",
  "points": [
    { "phase": -0.050, "flux": 1.0002, "error": 0.0004 },
    { "phase": -0.049, "flux": 0.9999, "error": 0.0004 }
  ]
}
```

Flux should be normalised so the out-of-transit baseline is close to 1.

---

## Recommended preprocessing

Before adding a custom light curve:

1. remove NaN and infinite values;
2. normalise the out-of-transit flux baseline near 1;
3. convert time to orbital phase;
4. remove or flag severe outliers;
5. keep the file small enough for browser loading;
6. record provenance in the `source` field.

---

## Performance notes

The site includes high-quality rendering and numerical transit calculations. For normal use:

* use **Balanced** visual quality;
* use **Ultra** for screenshots, videos, and demonstrations;
* use **High-accuracy model** only after selecting a target and approximate parameters;
* use **Low** if the browser becomes slow or the device is on battery power.

The visual quality selector changes the scene rendering only. It does not change the worker physics calculation.

---

## Hardware advisory

ExoIntel-Prime uses browser-based rendering and worker-side numerical modelling. Most modern laptops and desktops should run the site normally in Balanced mode.

However, Ultra visual quality and high-accuracy model mode can increase CPU/GPU usage. On older or low-power devices, this may cause:

* reduced frame rate;
* increased fan noise;
* higher battery use;
* browser tab slowdown.

If this happens, switch to Balanced or Low visual quality.

---

## Development notes

This project intentionally avoids build tools so that it remains transparent and easy to deploy.

Current design principles:

* no React;
* no npm dependency chain;
* no bundler;
* no external runtime libraries;
* static-first architecture;
* browser-native ES modules;
* physics isolated in a Web Worker;
* rendering separated from model computation;
* clear distinction between archival data and theoretical model;
* explicit `UNKNOWN` states when evidence fields are missing.

---

## Roadmap

Planned future upgrades include:

* formal audit JSON schema;
* geometry plausibility / grazing-risk checker;
* honest Gaia-neighbour contamination cache;
* sector/systematics timeline;
* analyzer plugin bus;
* injection-recovery and perturbation harness;
* analytic Mandel–Agol model option;
* Kipping `q1`, `q2` limb-darkening parameterisation;
* uncertainty-weighted residuals;
* CSV upload support;
* MAST/TESS/Kepler ingestion pipeline;
* multi-transit stacking;
* optimiser mode for best-fit parameters;
* model comparison between planet-only, starspot, exomoon-like, and binary-like hypotheses;
* downloadable scientific report and usage guide from the website.

---

## Licence and reuse

This project is developed by **Biswajit Jana** as a scientific visualisation, education, and research-communication platform.

You are welcome to study the code, fork the repository, and use it for learning or non-commercial scientific demonstration, provided that appropriate credit is given to the original author.

Please do not present modified versions as the original ExoIntel-Prime project without clear attribution.

For custom data experiments, fork the repository and run your own version rather than attempting to modify the live deployment.

**Author:** Biswajit Jana  
**Project:** ExoIntel-Prime / ExoLight Transit Lab  
**Year:** © 2026
