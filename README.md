# ExoIntel-Prime

**ExoIntel-Prime** is a browser-based exoplanetary intelligence laboratory that links confirmed exoplanet parameters from the **NASA Exoplanet Archive** with photometric time-series workflows for **MAST/TESS/Kepler**. It is the successor architecture to ExoLight Transit Lab.

**Live demo target:** `https://biswajit1999.github.io/exolight-transit-lab/`  
**Created by:** Biswajit Jana · © 2026

---

## Preview

![ExoIntel-Prime preview](public/preview/exolight-transit-lab-preview.png)

---

## Scientific Model

The orbit is solved in stellar-radius units using Keplerian geometry:

\[
M = \frac{2\pi(t - T_0)}{P}
\]

\[
M = E - e\sin E
\]

\[
r = \frac{a}{R_\star}(1 - e\cos E)
\]

The projected separation is:

\[
z(t) = \sqrt{x(t)^2 + y(t)^2}
\]

The stellar intensity field uses a four-parameter non-linear limb-darkening law:

\[
I(\mu) = 1 - c_1(1-\mu^{1/2}) - c_2(1-\mu) - c_3(1-\mu^{3/2}) - c_4(1-\mu^2)
\]

The current interface runs a CPU quadrature fallback for portability and includes a WebGL2 `GPUTransitEngine` extension point with GLSL quadrature shaders.

---

## Data Architecture

```text
NASA Exoplanet Archive TAP / pscomppars
        ↓
scripts/build-target-list.py
        ↓
public/targets.json
        ↓
React + Zustand global state
        ↓
Transit model + Orrery + residual / phase-fold docks
```

The MAST integration layer is included in `src/data/mastApi.ts` and `scripts/mast-lightcurve-fetch.py`. Use it to build target-specific observation/product metadata and future TESS/Kepler light-curve ingestion.

---

## Install

```bash
npm install
npm run dev
```

For Windows CMD:

```cmd
npm install
npm run dev
```

Open:

```text
http://localhost:5173/
```

---

## Generate a 200+ Target List

```bash
pip install requests
python scripts/build-target-list.py
python scripts/validate-targets.py
```

This queries NASA TAP using:

```sql
SELECT TOP 150
    pl_name, hostname, ra, dec, pl_orbper, pl_trandep, pl_trandur, pl_ratror, pl_ratdor,
    pl_orbincl, pl_orbeccen, pl_orblper, st_teff, st_rad, st_mass, st_lum, sy_vmag
FROM pscomppars
WHERE
    tran_flag = 1 AND
    pl_ratror IS NOT NULL AND
    pl_ratdor IS NOT NULL AND
    pl_orbper IS NOT NULL AND
    pl_orbincl IS NOT NULL AND
    st_rad IS NOT NULL AND
    sy_vmag IS NOT NULL AND
    sy_vmag < 12
ORDER BY pl_trandep DESC
```

Increase `TOP 150` to `TOP 250` in `queries/gold_targets.sql` if you want 200+ after quality filtering.

---

## Repository Structure

```text
src/physics   orbit solver, limb darkening, quadrature transit model, residuals
src/data      NASA Archive + MAST orchestration
src/glsl      star shader and GPU transit shader
src/render    Three.js Orrery and GPU engine hook
src/components modular Observatory-X dock panels
scripts       target list and MAST helpers
public        targets and preview assets
```

---

## Image Prompts

### Mission Control Header

```text
Cinematic mission-control dashboard for an advanced exoplanet transit analysis laboratory, glowing 3D orrery of a star and transiting planet, real-time light curve, residual plots, phase-folded photometry, Obsidian Prime dark interface, cyan telemetry, amber stellar glow, Bloomberg terminal meets NASA control room, ultra-detailed scientific visualization, no logos, no watermark, 16:9.
```

### GPU Transit Fitting

```text
High-end scientific UI showing GPU-accelerated exoplanet transit fitting, central limb-darkened star with active regions and a planet crossing the disk, side panels with NASA Exoplanet Archive and MAST data streams, phase-folded TESS light curve, residual diagnostics, deep black glassmorphism interface, JetBrains Mono labels, cyan and violet highlights, professional research software aesthetic, 16:9.
```

### Orrery + Photometry

```text
Futuristic exoplanet observatory interface named ExoIntel Prime, modular dock panels, live photometric time series, 3D AU-scale planetary orbit, transit depth and impact parameter telemetry, dark obsidian background, subtle scanlines, cyan data streams, amber star, precise astrophysics dashboard, cinematic but scientifically serious, no people, no logos, no watermark.
```

---

## Notes

The bundled `public/targets.json` is a bootstrap dataset so the app opens immediately. For a full research run, execute `scripts/build-target-list.py` and commit the refreshed NASA target list.

Direct browser TAP/MAST calls may be blocked by CORS or large archive payloads. For production-scale use, cache archive products using scripts or a small backend orchestrator.

---

## License

Code may be reused or modified with credit. Scientific data belongs to NASA/IPAC/MAST and the original discovery/catalogue sources.

© 2026 Biswajit Jana. All rights reserved.
