/* ============================================================================
   ExoLight Phase III - Blend and dilution physics utilities
   Pure, unitless helpers. No DOM, fetch, or catalogue mutation here.
   ============================================================================ */

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function contaminantFraction(fluxTarget = 1, fluxContaminant = 0) {
  const target = finitePositive(fluxTarget);
  const contaminant = Number(fluxContaminant);
  if (target === null || !Number.isFinite(contaminant) || contaminant < 0) return null;
  return contaminant / (target + contaminant);
}

export function fluxRatioFromMagnitudeDelta(deltaMag) {
  const delta = Number(deltaMag);
  if (!Number.isFinite(delta)) return null;
  return Math.pow(10, -0.4 * delta);
}

export function dilutedDepth(depthTrue, fluxTarget = 1, fluxContaminant = 0) {
  const depth = finitePositive(depthTrue);
  const target = finitePositive(fluxTarget);
  const contaminant = Number(fluxContaminant);
  if (depth === null || target === null || !Number.isFinite(contaminant) || contaminant < 0) return null;
  return depth * target / (target + contaminant);
}

export function undilutedDepth(depthObserved, contaminantToTargetFluxRatio = 0) {
  const depth = finitePositive(depthObserved);
  const ratio = Number(contaminantToTargetFluxRatio);
  if (depth === null || !Number.isFinite(ratio) || ratio < 0) return null;
  return depth * (1 + ratio);
}

export function radiusRatioFromDilutedDepth(depthObserved, contaminantToTargetFluxRatio = 0) {
  const correctedDepth = undilutedDepth(depthObserved, contaminantToTargetFluxRatio);
  return correctedDepth === null ? null : Math.sqrt(correctedDepth);
}

export function inferDilutionRisk({
  depthPpm,
  radiusRatio,
  contaminantToTargetFluxRatio = null,
  neighbourCount = null
} = {}) {
  const depthFraction = finitePositive(depthPpm) ? Number(depthPpm) / 1e6 : null;
  const ratio = finitePositive(radiusRatio);
  const fluxRatio = Number(contaminantToTargetFluxRatio);
  const neighbours = Number(neighbourCount);

  if (!Number.isFinite(fluxRatio) || fluxRatio < 0) {
    return {
      status: Number.isFinite(neighbours) && neighbours > 0 ? "unknown" : "unknown",
      score: 0,
      label: "unknown",
      detail: "No contaminant flux ratio is available yet. Gaia or aperture-neighbour context is required before dilution risk can be assessed."
    };
  }

  const contamFraction = contaminantFraction(1, fluxRatio);
  const correctedDepth = depthFraction === null ? null : undilutedDepth(depthFraction, fluxRatio);
  const correctedRadiusRatio = correctedDepth === null ? null : Math.sqrt(correctedDepth);
  const relativeRadiusChange = ratio && correctedRadiusRatio
    ? (correctedRadiusRatio - ratio) / ratio
    : Math.sqrt(1 + fluxRatio) - 1;

  let status = "pass";
  let label = "low";
  let score = 100;

  if (fluxRatio >= 0.25 || Math.abs(relativeRadiusChange) >= 0.12) {
    status = "warn";
    label = "high";
    score = 38;
  } else if (fluxRatio >= 0.05 || Math.abs(relativeRadiusChange) >= 0.035) {
    status = "caution";
    label = "moderate";
    score = 68;
  }

  return {
    status,
    score: clamp(Math.round(score), 0, 100),
    label,
    contaminantFraction: contamFraction,
    correctedDepthPpm: correctedDepth === null ? null : correctedDepth * 1e6,
    correctedRadiusRatio,
    relativeRadiusChange,
    detail: `Assuming contaminant/target flux ratio ${fluxRatio.toFixed(3)}, the inferred radius ratio changes by ${(relativeRadiusChange * 100).toFixed(1)}%.`
  };
}
