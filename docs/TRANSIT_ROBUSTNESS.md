# Independent transit-observation robustness checks

Tracking issue: #10. This is an offline, separate Python study; it does not modify the browser physics engine or create new observational data.

From the repository root:

```bash
python -m pip install numpy pytest
python -m pytest -q tests/test_transit_robustness.py
python scripts/run_transit_robustness.py --output transit_robustness_results.json
```

Three scientifically distinct sensitivity checks are implemented:

1. **Finite exposure:** exact analytic integration of a *piecewise-linear trapezoid* transit model, with first-to-fourth-contact duration and ingress duration. It isolates cadence smearing without assuming a limb-darkened transit fit.
2. **Third light:** under a uniform-brightness, fully superimposed small-planet approximation, `depth_observed=(Rp/Rs)^2/(1+F_contaminant/F_star)`; the inverse radius ratio and first-order uncertainty include optional depth–contamination correlation.
3. **Baseline and mask sensitivity:** weighted intercept, phase slope and box depth after excluding ingress/egress, re-fit at three phase windows. The runner uses the **existing** HD 189733 b TESS/SPOC-derived, post-processed `data/lightcurves/hd-189733-b.json`, preserving its source and processing labels. This file contains no usable per-point uncertainties; the runner therefore uses equal weights and an IID residual-scatter conditional standard error. It is **not** a calibrated uncertainty or independent planet detection.

The input series was already normalized, detrended and median-binned before this analysis. Period, duration, and transit midpoint are not re-estimated. The box depth can be biased by limb darkening, TTVs, dilution, systematics, residual time correlation and selection effects. Cadence and dilution numerical examples are *illustrative model scenarios*, not measured properties of HD 189733 b. No claims about transit occurrence rates or new detections are made.
