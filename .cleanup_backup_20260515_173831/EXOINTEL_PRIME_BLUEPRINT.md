# ExoIntel-Prime — Successor Architecture

**ExoIntel-Prime** is the planned successor to **ExoLight Transit Lab**. The goal is to evolve the project from a static educational transit simulator into a research-grade exoplanetary analysis and visualization laboratory.

This blueprint adds the professional architecture, data-orchestration scripts, GPU transit shaders, and scientific roadmap needed for the next build while keeping the current static ExoLight site deployable on GitHub Pages.

---

## Core Directives

### 1. Data Sovereignty

Move beyond the small static cache. The future system should use a **Data Orchestrator** that bridges:

- **NASA Exoplanet Archive TAP / SQL** for system, stellar, orbital, and transit parameters.
- **MAST API** for TESS, Kepler, and K2 photometric time-series products.
- Local cache files such as `public/targets.json` so the app still works when live archive requests are blocked.

Recommended flow:

```text
Target selected
   ↓
NASA Archive query: orbital + stellar parameters
   ↓
MAST query: available TESS/Kepler observations
   ↓
MAST product filtering: light-curve FITS / HLSP products
   ↓
Flux normalization + quality filtering
   ↓
Phase folding
   ↓
GPU transit model
   ↓
Residuals + manual fit workspace
```

---

### 2. Physics Nucleus

The next-generation engine should support:

- Eccentricity, `e`
- Inclination, `i`
- Argument of periastron, `ω`
- Semi-major axis in stellar radii, `a/Rs`
- Radius ratio, `Rp/Rs`
- Four-parameter non-linear limb darkening
- Starspots / active regions that affect both the visual star and the computed flux
- GPU numerical quadrature for flexible planet, moon, and starspot occultation

The physically motivated stellar intensity law is:

```text
I(μ) = 1
       − c1(1 − μ^(1/2))
       − c2(1 − μ)
       − c3(1 − μ^(3/2))
       − c4(1 − μ^2)
```

where:

```text
μ = sqrt(1 − r²)
```

---

### 3. Observatory-X UI

The current ExoLight interface should evolve into **Obsidian Prime**:

- Modular dock system
- Target browser dock
- 3D Orrery dock
- Light-curve dock
- Residual dock
- Phase-fold dock
- Manual fitting dock
- Data console dock
- Spectral filter dock

The visual target is:

```text
NASA Mission Control + Bloomberg Terminal + astrophysics observatory software
```

---

## Recommended Future Repository Structure

```text
exointel-prime/
├── public/
│   └── targets.json
├── scripts/
│   ├── build-target-list.py
│   ├── mast-lightcurve-fetch.py
│   └── validate-targets.py
└── src/
    ├── state/
    ├── data/
    ├── physics/
    ├── render/
    ├── glsl/
    ├── components/
    └── styles/
```

---

## Priority Order

```text
1. Build target-list generator.
2. Build NASA + MAST data orchestrator.
3. Implement GPU quadrature transit texture.
4. Build Obsidian Prime dock UI.
5. Add manual fit + phase-fold workspace.
6. Add physically linked starspots and spectral filters.
```
