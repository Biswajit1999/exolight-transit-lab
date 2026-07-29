# ExoLight Reference Regression Summary

Generated UTC: 2026-07-29T21:22:00.000Z  
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
| hd-189733-b | observational-benchmark | PASS | a=0.03116 AU |
| synthetic-central-transit | deterministic-geometry | PASS | depth 10460.1 ppm |
| synthetic-non-transiting | deterministic-geometry | PASS | depth 0.0 ppm |
| synthetic-dilution-check | dilution-physics | PASS | corrected depth 0.012500 |

## Scientific boundary

These tests protect deterministic physics and numerical invariants. They are not discovery claims, false-positive probabilities, or posterior inference results.
Expected values are manually curated and must not be silently regenerated from current implementation output.
