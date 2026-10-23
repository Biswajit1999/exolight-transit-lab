# Independent offline transit-timing and parity diagnostics

**Status:** optional Python research extension; does not alter the zero-dependency browser lab or imply a detected TTV, planet or eclipsing binary. All bundled results are explicitly synthetic.

## Three complementary analyses

1. **Covariance-aware linear ephemeris:** weighted fit $T(E)=T_\mathrm{ref}+P(E-E_\mathrm{ref})$ with the full $2\times2$ covariance of reference time and period. The reference epoch is the inverse-variance-weighted mean epoch to improve numerical conditioning for large BJD values. The predicted variance at epoch $E$ is $C_{TT}+2\Delta E C_{TP}+\Delta E^2 C_{PP}$. In-sample O-C residuals share fit noise and must not be assigned independent predictive z-scores.
2. **Leave-one-transit-out predictive residuals:** refit after excluding each epoch, predict the held-out time, and compute $z_i=[T_i-\hat T_{-i}(E_i)]/\sqrt{\sigma_i^2+\sigma_{\mathrm{pred},-i}^2}$. This variance combination assumes independent, correctly estimated timing errors; correlated red noise, incorrect cycle counts or TTVs violate the null model. Correlated LOO z-scores must not be treated as independent significance tests.
3. **Even/odd depth consistency:** inverse-variance-weighted mean depth for even and odd transit epochs; difference divided by $\sqrt{\sigma_{\rm even}^2+\sigma_{\rm odd}^2}$. A large discrepancy is a **vetting flag**, not a calibrated false-positive probability. The model assumes independent depth errors and a fixed, correctly identified parity.

**Time standard:** all supplied midtimes must already use one consistent time scale (for example BJD_TDB, in days). This module does not perform barycentric corrections or convert UTC to TDB. Depths are dimensionless relative flux; uncertainties are positive 1σ values. Duplicate or noninteger epoch labels are rejected; no silent NaN filtering.

## Reproduce (optional offline tools)

```bash
python -m pip install numpy pytest matplotlib
python -m pytest tests/test_transit_timing_diagnostics.py -q
python scripts/analyze_transit_timing.py --output-dir results/transit_timing
```

Seed 20261018 generates a 3.271-day synthetic ephemeris with a small injected sinusoidal timing perturbation, deliberately missing epochs, and synthetic parity-dependent transit depths. It writes deterministic CSV/JSON diagnostics and three optional plots. The browser application still has zero runtime dependencies.

## Scientific limitations

The ephemeris fit is *not* a dynamical TTV model. Its formal parameter covariance is optimistic if timing residuals contain correlated variability or unmodelled TTV. Use actual midtimes only with explicit source identifiers, timing-extraction method, time standard, uncertainties and provenance. No claims about real targets should be made from the seeded fixture. Compare with independent transit-fitting software before using these diagnostics in publication-level inference.
