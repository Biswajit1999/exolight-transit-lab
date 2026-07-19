function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rms(values) {
  const clean = values.map(finite).filter(value => value !== null);
  if (!clean.length) return null;
  const meanSquare = clean.reduce((sum, value) => sum + value * value, 0) / clean.length;
  return Math.sqrt(meanSquare);
}

function median(values) {
  const clean = values.map(finite).filter(value => value !== null).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

function mad(values) {
  const med = median(values);
  if (med === null) return null;
  return median(values.map(value => Math.abs(value - med)));
}

function regionForPhase(phase) {
  const p = finite(phase);
  if (p === null) return "unknown";
  const absolute = Math.abs(p);
  if (absolute < 0.0125) return "centre";
  if (p < 0 && absolute < 0.08) return "ingress";
  if (p > 0 && absolute < 0.08) return "egress";
  return "outOfTransit";
}

function classifyQuality(score) {
  if (score >= 82) return "stable";
  if (score >= 58) return "watch";
  if (score >= 35) return "caution";
  return "poor";
}

function safeRatio(numerator, denominator) {
  const top = finite(numerator);
  const bottom = finite(denominator);
  if (top === null || bottom === null || bottom <= 0) return null;
  return top / bottom;
}

export function residualQualityScore({ residualRmsPpm, modelDepthPpm, ootRmsPpm }) {
  const depthRatio = safeRatio(residualRmsPpm, modelDepthPpm);
  const ootRatio = safeRatio(residualRmsPpm, ootRmsPpm);

  if (depthRatio === null) {
    return {
      score: 0,
      label: "waiting for model",
      detail: "Residual diagnostics will update after the model and visible metrics are available."
    };
  }

  let score = clamp(100 - depthRatio * 230, 0, 100);
  if (ootRatio !== null && ootRatio > 1.4) score -= 10;
  score = clamp(Math.round(score), 0, 100);

  return {
    score,
    label: classifyQuality(score),
    detail: `Residual RMS is ${(depthRatio * 100).toFixed(1)}% of model depth.`
  };
}

export function analyseResidualSamples(samples = []) {
  const grouped = {
    ingress: [],
    centre: [],
    egress: [],
    outOfTransit: [],
    unknown: []
  };

  for (const sample of samples) {
    const residual = finite(sample?.residualPpm ?? sample?.residual ?? ((sample?.observed - sample?.model) * 1e6));
    if (residual === null) continue;
    grouped[regionForPhase(sample?.phase)].push(residual);
  }

  const allResiduals = Object.values(grouped).flat();
  const robustSigma = mad(allResiduals);
  const outlierThreshold = robustSigma === null ? null : Math.max(5 * robustSigma, 1e-9);
  const outlierCount = outlierThreshold === null ? null : allResiduals.filter(value => Math.abs(value) > outlierThreshold).length;

  return {
    source: "sampled residuals",
    regions: Object.fromEntries(Object.entries(grouped).map(([name, values]) => [name, {
      rmsPpm: rms(values),
      medianPpm: median(values),
      count: values.length
    }])),
    outlierCount,
    outlierThresholdPpm: outlierThreshold,
    sampleCount: allResiduals.length
  };
}

function inferredRegionBreakdown({ target, params, metrics }) {
  const residual = finite(metrics?.residualRmsPpm);
  const depth = finite(metrics?.modelDepthPpm);
  const catalogueDepth = finite(target?.pl_trandep);
  const inclination = finite(params?.inclinationDeg);
  const aRs = finite(params?.aRs);
  const spot = Boolean(params?.spotEnabled);
  const moon = Boolean(params?.moonEnabled);

  const depthMismatch = catalogueDepth && depth ? Math.abs(depth - catalogueDepth) / catalogueDepth : 0;
  const b = aRs !== null && inclination !== null ? Math.abs(aRs * Math.cos(inclination * Math.PI / 180)) : null;
  const grazingBoost = b !== null && b > 0.72 ? 0.22 : 0;
  const hypothesisBoost = spot || moon ? 0.2 : 0;
  const baseline = residual ?? (depth ? depth * 0.12 : 600);

  const regionFactors = {
    ingress: 1 + depthMismatch * 0.9 + grazingBoost,
    centre: 0.78 + hypothesisBoost,
    egress: 1 + depthMismatch * 0.85 + grazingBoost,
    outOfTransit: 0.52 + (finite(metrics?.ootRmsPpm) ? 0.18 : 0)
  };

  return {
    source: "visible metric inference",
    regions: Object.fromEntries(Object.entries(regionFactors).map(([name, factor]) => [name, {
      rmsPpm: baseline * factor,
      medianPpm: null,
      count: null
    }])),
    outlierCount: residual && depth ? Math.max(0, Math.round((residual / Math.max(depth, 1)) * 24)) : null,
    outlierThresholdPpm: residual ? residual * 3 : null,
    sampleCount: null
  };
}

function strongestRegion(regions) {
  return Object.entries(regions)
    .filter(([, region]) => finite(region?.rmsPpm) !== null)
    .sort((a, b) => b[1].rmsPpm - a[1].rmsPpm)[0]?.[0] ?? "unavailable";
}

function hintForRegion(region, context) {
  if (region === "ingress") return "Largest mismatch is near ingress. Inspect phase alignment, exposure integration, and limb-darkening assumptions.";
  if (region === "egress") return "Largest mismatch is near egress. Check transit duration, phase offset, and possible asymmetric systematics.";
  if (region === "centre") return context?.hypothesisActive
    ? "Transit-centre mismatch is high while a hypothesis mode is active. Treat morphology as exploratory until repeated events support it."
    : "Transit-centre mismatch is high. Compare catalogue depth, radius ratio, dilution, and stellar radius assumptions.";
  if (region === "outOfTransit") return "Out-of-transit scatter is dominant. Inspect detrending, normalization, and outlier rejection before interpreting transit shape.";
  return "Residual diagnostics are waiting for enough model and light-curve information.";
}

export function analyseResidualState({ target, params, metrics, archivalCurve, residualSamples = [] }) {
  const sampleAnalysis = residualSamples.length ? analyseResidualSamples(residualSamples) : null;
  const regional = sampleAnalysis ?? inferredRegionBreakdown({ target, params, metrics, archivalCurve });
  const quality = residualQualityScore(metrics ?? {});
  const region = strongestRegion(regional.regions);
  const hypothesisActive = Boolean(params?.spotEnabled || params?.moonEnabled);

  return {
    generatedUtc: new Date().toISOString(),
    quality,
    strongestRegion: region,
    researchHint: hintForRegion(region, { hypothesisActive }),
    source: regional.source,
    regions: regional.regions,
    outliers: {
      count: regional.outlierCount,
      thresholdPpm: regional.outlierThresholdPpm,
      sampleCount: regional.sampleCount
    },
    caution: sampleAnalysis
      ? "Residual regions are calculated from supplied residual samples."
      : "Residual regions are inferred from visible diagnostics until raw plotted residual samples are exposed."
  };
}
