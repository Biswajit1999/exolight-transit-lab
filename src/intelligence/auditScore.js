function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function yesNoScore(condition, scoreWhenTrue, scoreWhenFalse, trueLabel, falseLabel, detail) {
  return {
    score: condition ? scoreWhenTrue : scoreWhenFalse,
    label: condition ? trueLabel : falseLabel,
    detail
  };
}

export function calculateDepthAgreementScore({ catalogueDepthPpm, modelDepthPpm }) {
  const catalogue = finite(catalogueDepthPpm);
  const model = finite(modelDepthPpm);

  if (catalogue === null || model === null || catalogue <= 0) {
    return {
      score: 0,
      label: "unavailable",
      detail: "Catalogue or model depth is missing."
    };
  }

  const fractionalDifference = Math.abs(model - catalogue) / catalogue;

  if (fractionalDifference <= 0.03) {
    return {
      score: 25,
      label: "excellent",
      detail: "Model depth agrees with catalogue depth within 3%."
    };
  }

  if (fractionalDifference <= 0.10) {
    return {
      score: 18,
      label: "usable",
      detail: "Model depth agrees with catalogue depth within 10%."
    };
  }

  if (fractionalDifference <= 0.25) {
    return {
      score: 10,
      label: "caution",
      detail: "Model depth differs from catalogue depth by more than 10%."
    };
  }

  return {
    score: 4,
    label: "poor",
    detail: "Model depth differs strongly from catalogue depth."
  };
}

export function calculateTargetAuditScore({ target, params, metrics, archivalCurve }) {
  const checks = [];

  checks.push(calculateDepthAgreementScore({
    catalogueDepthPpm: target?.pl_trandep,
    modelDepthPpm: metrics?.modelDepthPpm
  }));

  checks.push(yesNoScore(
    finite(target?.pl_orbper) !== null,
    10,
    0,
    "available",
    "missing",
    "Orbital period availability."
  ));

  checks.push(yesNoScore(
    finite(target?.pl_ratror) !== null,
    10,
    4,
    "available",
    "derived or missing",
    "Radius-ratio availability."
  ));

  checks.push(yesNoScore(
    finite(target?.st_rad) !== null,
    10,
    3,
    "available",
    "missing",
    "Stellar radius availability."
  ));

  checks.push(yesNoScore(
    finite(target?.st_mass) !== null,
    8,
    2,
    "available",
    "missing",
    "Stellar mass availability."
  ));

  checks.push(yesNoScore(
    Number(archivalCurve?.points) > 20 || Boolean(target?.lightcurve_available),
    15,
    4,
    "local light curve",
    "model only",
    "Local light-curve availability."
  ));

  checks.push(yesNoScore(
    !(params?.spotEnabled || params?.moonEnabled),
    12,
    3,
    "baseline model",
    "hypothesis active",
    "Hypothesis terms are separated from the baseline model."
  ));

  const total = clamp(
    Math.round(checks.reduce((sum, check) => sum + check.score, 0)),
    0,
    100
  );

  let rating = "poorly constrained";
  if (total >= 90) rating = "strong catalogue/model agreement";
  else if (total >= 70) rating = "usable with cautions";
  else if (total >= 40) rating = "educational / exploratory quality";

  return {
    total,
    rating,
    checks
  };
}
