# Weighted transit-depth and mask audit (2026-11-06)

Two standalone numerical diagnostics: inverse-variance weighted in/out-of-transit box-depth estimation with first-order baseline uncertainty, and symmetric phase-mask half-width sensitivity. Assumes independent Gaussian flux errors, fixed phase, no limb darkening, no correlated stellar variability, and an externally specified transit centre. Error propagation treats in/out groups as independent. The tests use synthetic fixtures; no retained light curve was analysed and issue #10 is **not complete**.

Run from repository root: `python -m pytest -q tests/test_weighted_mask_audit.py`.

Prepared with AI coding assistance. Commits use the authenticated repository identity; review before merging.