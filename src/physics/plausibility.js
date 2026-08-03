const DEG_TO_RAD = Math.PI / 180;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveNumber(value) {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function impactParameterAtTransit({
  scaledSemiMajorAxis,
  inclinationDeg,
  eccentricity = 0,
  omegaDeg = 90
} = {}) {
  const aRs = positiveNumber(scaledSemiMajorAxis);
  const inclination = finiteNumber(inclinationDeg);
  const eccentricityValue = finiteNumber(eccentricity);
  const omega = finiteNumber(omegaDeg);

  if (
    aRs === null ||
    inclination === null ||
    eccentricityValue === null ||
    omega === null ||
    inclination < 0 ||
    inclination > 180 ||
    eccentricityValue < 0 ||
    eccentricityValue >= 1
  ) {
    return null;
  }

  const inclinationRad = inclination * DEG_TO_RAD;
  const omegaRad = omega * DEG_TO_RAD;
  const conjunctionScale = (1 - eccentricityValue ** 2) /
    (1 + eccentricityValue * Math.sin(omegaRad));

  if (!Number.isFinite(conjunctionScale) || conjunctionScale <= 0) return null;

  return Math.abs(aRs * Math.cos(inclinationRad) * conjunctionScale);
}

export function approximateTransitDurationHours({
  periodDays,
  scaledSemiMajorAxis,
  inclinationDeg,
  eccentricity = 0,
  omegaDeg = 90,
  radiusRatio,
  impactParameter
} = {}) {
  const period = positiveNumber(periodDays);
  const aRs = positiveNumber(scaledSemiMajorAxis);
  const inclination = finiteNumber(inclinationDeg);
  const eccentricityValue = finiteNumber(eccentricity);
  const omega = finiteNumber(omegaDeg);
  const k = positiveNumber(radiusRatio);
  const b = finiteNumber(impactParameter);

  if (
    period === null ||
    aRs === null ||
    inclination === null ||
    eccentricityValue === null ||
    omega === null ||
    k === null ||
    b === null ||
    b < 0 ||
    inclination < 0 ||
    inclination > 180 ||
    eccentricityValue < 0 ||
    eccentricityValue >= 1
  ) {
    return null;
  }

  const chordSquared = (1 + k) ** 2 - b ** 2;
  if (chordSquared <= 0) return 0;

  const sinInclination = Math.abs(Math.sin(inclination * DEG_TO_RAD));
  if (sinInclination <= 0) return null;

  const omegaRad = omega * DEG_TO_RAD;
  const velocityScale = Math.sqrt(1 - eccentricityValue ** 2) /
    (1 + eccentricityValue * Math.sin(omegaRad));
  if (!Number.isFinite(velocityScale) || velocityScale <= 0) return null;

  const argument = clamp(
    Math.sqrt(chordSquared) / (aRs * sinInclination),
    0,
    1
  );

  return (period * 24 / Math.PI) * Math.asin(argument) * velocityScale;
}

export function assessTransitPlausibility({
  periodDays,
  scaledSemiMajorAxis,
  inclinationDeg,
  eccentricity = 0,
  omegaDeg = 90,
  radiusRatio,
  catalogueDurationHours = null
} = {}) {
  const k = positiveNumber(radiusRatio);
  const impactParameter = impactParameterAtTransit({
    scaledSemiMajorAxis,
    inclinationDeg,
    eccentricity,
    omegaDeg
  });

  const baseResult = {
    status: "unknown",
    label: "insufficient geometry",
    score: 0,
    impactParameter,
    predictedDurationHours: null,
    durationMismatchFraction: null,
    grazing: null,
    detail: "Inclination, scaled semi-major axis, eccentricity, argument of periastron, or radius ratio is unavailable or invalid."
  };

  if (k === null || impactParameter === null) return baseResult;

  const fullTransitLimit = Math.max(0, 1 - k);
  const transitLimit = 1 + k;

  if (impactParameter >= transitLimit) {
    return {
      ...baseResult,
      status: "fail",
      label: "no geometric transit",
      score: 10,
      predictedDurationHours: 0,
      grazing: false,
      detail: `Impact parameter b=${impactParameter.toFixed(3)} exceeds 1 + Rp/R★=${transitLimit.toFixed(3)}.`
    };
  }

  const predictedDurationHours = approximateTransitDurationHours({
    periodDays,
    scaledSemiMajorAxis,
    inclinationDeg,
    eccentricity,
    omegaDeg,
    radiusRatio: k,
    impactParameter
  });
  const observedDuration = positiveNumber(catalogueDurationHours);
  const durationMismatchFraction = predictedDurationHours !== null &&
    predictedDurationHours > 0 &&
    observedDuration !== null
    ? Math.abs(observedDuration - predictedDurationHours) / predictedDurationHours
    : null;
  const grazing = impactParameter >= fullTransitLimit;

  let status = grazing ? "caution" : "pass";
  let label = grazing ? "grazing risk" : "geometry consistent";
  let score = grazing ? 65 : 100;

  if (durationMismatchFraction !== null && durationMismatchFraction > 0.5) {
    status = "warn";
    label = grazing ? "grazing and duration mismatch" : "duration mismatch";
    score = grazing ? 35 : 48;
  } else if (durationMismatchFraction !== null && durationMismatchFraction > 0.25) {
    status = "caution";
    label = grazing ? "grazing and duration caution" : "moderate duration mismatch";
    score = grazing ? 52 : 68;
  }

  return {
    status,
    label,
    score,
    impactParameter,
    predictedDurationHours,
    durationMismatchFraction,
    grazing,
    detail: durationMismatchFraction === null
      ? `${grazing ? "Grazing" : "Full"} transit geometry is possible; catalogue duration was unavailable for comparison.`
      : `${grazing ? "Grazing" : "Full"} transit geometry; predicted duration ${predictedDurationHours.toFixed(2)} h versus catalogue ${observedDuration.toFixed(2)} h.`
  };
}
