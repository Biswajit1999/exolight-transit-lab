# ExoLight Reference Regression Summary

Generated UTC: 2026-08-10T16:51:19.735Z
Physics core version: phase-iii-core-v0.1
Overall status: PASS

## Summary

- Cases: 4
- Passed cases: 4
- Failed cases: 0
- Assertions: 22

## Results

| Case | Type | Status | Key output |
|---|---|---:|---|
| hd-189733-b | observational-benchmark | PASS | depth 20621.0 ppm |
| synthetic-central-transit | deterministic-geometry | PASS | depth 10460.1 ppm |
| synthetic-non-transiting | deterministic-geometry | PASS | depth 0.0 ppm |
| synthetic-dilution-check | dilution-physics | PASS | corrected depth 0.012500 |

## Scientific boundary

These tests protect deterministic physics and numerical invariants. They are not discovery claims, false-positive probabilities, or posterior inference results.
Expected values are manually curated and must not be silently regenerated from current implementation output.
