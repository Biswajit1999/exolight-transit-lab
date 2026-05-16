# ExoIntel-Prime

🌐 **Live website:** [Open ExoIntel-Prime](https://biswajit1999.github.io/exolight-transit-lab/)

![ExoIntel-Prime Dashboard](assets/exointel-prime-dashboard.png)
ExoIntel-Prime is a browser-based exoplanet transit lab. It runs with plain HTML, CSS, and JavaScript ES modules, so it can be deployed directly to GitHub Pages without React, Vite, npm, or a build step.

## What is a transit?

A transit happens when a planet passes in front of its star from our point of view. The star does not disappear, but its measured brightness drops by a tiny amount. That small dip tells us useful things: the planet’s size, orbit, inclination, and sometimes clues about moons, starspots, or timing changes.


## Project structure

```text
exointel-prime/
├── index.html
├── styles.css
├── src/
│   ├── app.js
│   ├── dataOrchestrator.js
│   ├── physics.js
│   ├── scene.js
│   └── ui.js
├── data/
│   └── exoplanets.json
├── tools/
│   └── fetch_nasa_cache.py
└── README.md
```

## Main idea

The app combines four parts:

- a dense “Obsidian Prime” science dashboard,
- a local exoplanet target cache,
- a numerical transit physics engine,
- and a native WebGL scene showing the star, planet, and optional moon.

The light curve is not just a drawn curve. It is generated from a simple but real forward model using a quadratic limb-darkening law:

```text
I(μ) = 1 - u1(1 - μ) - u2(1 - μ)^2
```

The stellar disk is sampled using a deterministic polar grid:

```text
82 radial rings × 150 azimuth samples = 12,300 surface samples
```

## Features

- Static GitHub Pages deployment
- No npm, no bundler, no external JavaScript dependencies
- Modular ES files in `src/`
- NASA Exoplanet Archive TAP query console
- Local fallback target cache
- Target Astro-Dossier panel
- Quadratic limb-darkened transit model
- Exomoon geometry controls
- Starspot crossing controls
- Transit Timing Variation controls
- Native WebGL star and orbit scene
- Canvas light-curve renderer
- Runtime telemetry log

## Running locally

Because the project uses ES modules, run it through a local server:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Deploying to GitHub Pages

Use GitHub Pages with:

- Source: Deploy from a branch
- Branch: `main`
- Folder: `/root`

The app works from the root because `index.html` is already at the top level.

## Updating the exoplanet cache

The offline cache builder is:

```text
tools/fetch_nasa_cache.py
```

Install the Python dependency:

```bash
pip install requests
```

Run:

```bash
python tools/fetch_nasa_cache.py
```

It writes a refreshed cache to:

```text
data/exoplanets.json
```

## Notes

This is an interactive scientific lab, not a full professional fitting package. It is useful for learning and demonstrating how system geometry changes a transit light curve. Later versions can add noise models, exposure-time integration, uploaded observational light curves, and MAST/TESS data ingestion.

## ⚠️ Hardware Advisory & Liability Disclaimer

**High-Performance WebGL Environment:** ExoIntel-Prime utilizes rigorous, uncompressed mathematical integrators and complex volumetric 3D rendering (custom Three.js shaders, procedural granulation, and additive atmospheric blending). It is specifically engineered to maximize browser-based GPU acceleration.

### 🖥️ Baseline Testing Configuration (Reference Benchmarks)
This software is developed and benchmarked on the following intermediate-to-high-end mobile workstation architecture:
* **Processor:** i9 11th gen (8 Cores, 16 Threads @ 3.20 GHz)
* **Memory:** 16.0 GB RAM
* **System Type:** 64-bit OS, x64-based processor (Windows 11)
* **Graphics:** Dedicated Performance GPU architecture

### 🔴 Critical Safety Warnings:
* **Do not run this application on legacy devices, low-end hardware, or systems lacking an active dedicated graphics card.** * Running these mathematical routines and complex shaders on non-compliant systems can result in extreme frame-rate drops, browser tab termination, or severe **hardware heating/thermal throttling issues**.
* **Liability Waiver:** The developer (**Biswajit Jana**) assumes absolutely zero responsibility or liability for any hardware stress, thermal overheating, or physical system degradation caused by executing this laboratory environment. Proceed entirely at your own risk.

*Note: Once this flagship Phase III deployment undergoes stable continuous integration and thorough analytical testing, a lightweight "Lite/Safe Mode" build (featuring flat 2D viewport replacements and reduced grid integration matrices) will be released for standard commercial devices.*
