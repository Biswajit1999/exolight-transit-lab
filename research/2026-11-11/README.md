# Transit sensitivity audit (11 November 2026)

Independent offline, synthetic-only numerical diagnostics for [issue #10](https://github.com/Biswajit1999/exolight-transit-lab/issues/10). The three calculations are inverse-variance weighted baseline/transit depth, sensitivity to a specified symmetric mask, and third-light dilution with first-order uncertainty propagation.

Assumptions: independent Gaussian flux errors, known transit midpoint, box-like classification of in-transit cadences, positive baseline, and contamination parameter F_contaminant/F_star. No time-correlated covariance, limb darkening, astrophysical false-positive modelling, or fitted ephemeris is included. A mask-width scan is not a detection significance test.

Reproduce: `cd research/2026-11-11 && python -m unittest -v test_transit_sensitivity.py`.

This does **not** complete issue #10: no provenance-verified archived light curve was fitted in this session. No observational or production files were changed. AI-assisted code preparation; review required before merge.
