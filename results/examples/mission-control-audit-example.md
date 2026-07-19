# ExoLight Target Audit — Example Hot Jupiter

Host star: Example Host
Generated UTC: 2026-07-19T00:00:00.000Z

## Mission Control Score

Score: 82/100
Rating: usable with cautions

## Research next steps

- **Depth mismatch** (warning): Catalogue depth and current model depth differ by more than 10%. Check passband, literature source, dilution, and radius-ratio assumptions before interpreting the curve.
- **Ready for visual audit** (good): Inspect residual behaviour around ingress and egress.

## Audit checks

- available: Orbital period availability. (10 points)
- available: Radius-ratio availability. (10 points)
- local light curve: Local light-curve availability. (15 points)
- baseline model: Hypothesis terms are separated from the baseline model. (12 points)

## Catalogue state

```json
{
  "periodDays": 2.218576,
  "depthPpm": 20625,
  "radiusRatio": 0.1436,
  "lightcurveAvailable": true
}
```

## Model state

```json
{
  "radiusRatio": 0.1436,
  "scaledSemiMajorAxis": 8.8,
  "inclinationDeg": 85.7,
  "starspotEnabled": false,
  "exomoonEnabled": false
}
```

## Metrics

```json
{
  "modelDepthPpm": 20600,
  "residualRmsPpm": 420,
  "ootRmsPpm": 370
}
```

> ExoLight is an exploratory visual and educational toolkit. This audit is not a detection claim or formal inference result.
