# Transit-depth injection–recovery under correlated noise

## Question and predeclared null

How does within-event correlated noise change recovery of a known box-shaped
transit depth, nominal 95% interval coverage, and three-sigma detection rates?

The release null is that, for a 1,000 ppm transit observed in 500 ppm marginal
noise, changing the AR(1) correlation from `rho = 0` to `rho = 0.8` changes the
naïve independent-sample 95% coverage by no more than 0.10.

## Transparent baseline

Each trial contains 12 transit events with 101 samples per event. The injected
box duration is 0.03 in phase. A transparent estimator subtracts the mean
in-transit flux from the mean out-of-transit flux. Two uncertainty estimates
are compared:

- **IID:** pooled sample variances divided by their sample counts;
- **event cluster:** the standard error of 12 independently estimated
  event-level depths, preserving arbitrary within-event correlation.

Four deterministic scenarios cover 1,000 ppm and 300 ppm depths under white and
AR(1) noise. Each uses 1,000 Monte Carlo trials. Configuration and seeds are in
`data/injection-recovery-scenarios.json`; implementation is in
`src/analysis/injectionRecovery.js`.

## Generated result

| Scenario | RMSE (ppm) | IID 95% coverage | Event-cluster coverage | IID 3σ detection | Event-cluster 3σ detection |
|---|---:|---:|---:|---:|---:|
| 1,000 ppm, white | 36.7 | 0.943 | 0.924 | 1.000 | 1.000 |
| 1,000 ppm, AR(1) | 91.5 | 0.549 | 0.932 | 1.000 | 1.000 |
| 300 ppm, white | 36.5 | 0.950 | 0.916 | 1.000 | 1.000 |
| 300 ppm, AR(1) | 93.5 | 0.561 | 0.921 | 0.980 | 0.612 |

The null is **rejected**: naïve coverage changes by 0.394, nearly four times
the 0.10 threshold. The event-cluster interval restores coverage to 0.932 in
the 1,000 ppm red-noise case. In the shallow red-noise case, the naïve rule
calls 98.0% of trials three-sigma detections while the correlation-aware rule
calls 61.2%, demonstrating how independence assumptions can overstate evidence.

Machine-readable results are in `results/injection-recovery/report.json` and
`results/injection-recovery/results.csv`.

## Scientific boundary

This is a controlled validation experiment, not an occurrence-rate analysis or
a calibrated survey-completeness claim. The box model omits limb darkening,
ingress/egress, detrending, gaps, heteroskedastic uncertainties, transit-timing
variation, contamination and nonstationary stellar variability. AR(1) noise is
a stress test, not a claim that real TESS or Kepler residuals follow that model.

The motivation follows the established warning that correlated noise changes
transit-parameter uncertainty: Pont, Zucker & Queloz (2006) and Carter & Winn
(2009, [arXiv:0909.0747](https://arxiv.org/abs/0909.0747)).

## Reproduce

```bash
npm run validate:injection
```

Outputs are deterministic; timestamps are deliberately omitted because Git
history and releases record execution time without making identical builds
produce different files.
