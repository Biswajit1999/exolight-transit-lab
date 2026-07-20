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

function auditScoreFromLabel(checks, label, fallback = 0) {
  const match = checks.find(check => String(check.label || "").toLowerCase().includes(label));
  return Number.isFinite(Number(match?.score)) ? Number(match.score) : fallback;
}

/**
 * Four named quick-look percentages shared by every tab that summarises a
 * target's readiness (Mission Control, Model + Plot header, Evidence).
 * Keeping this in one place means the same target always shows the same
 * numbers no matter which tab is open.
 */
export function qualityBars(audit, state) {
  const checks = audit.audit.checks || [];
  const target = state?.target || {};
  const metrics = state?.metrics || {};
  const points = Number(state?.archivalCurve?.points || 0);
  const catalogueDepth = Number(target.pl_trandep);
  const modelDepth = Number(metrics.modelDepthPpm);
  const depthMismatch = Number.isFinite(catalogueDepth) && catalogueDepth > 0 && Number.isFinite(modelDepth)
    ? Math.abs(modelDepth - catalogueDepth) / catalogueDepth
    : null;
  const depthScore = depthMismatch === null ? auditScoreFromLabel(checks, "depth", 40) : Math.max(0, Math.round(100 - depthMismatch * 420));
  const residualScore = Number.isFinite(Number(metrics.residualRmsPpm)) && Number.isFinite(modelDepth) && modelDepth > 0
    ? Math.max(0, Math.round(100 - (Number(metrics.residualRmsPpm) / modelDepth) * 220))
    : auditScoreFromLabel(checks, "residual", 55);
  const completeness = [target.pl_orbper, target.pl_ratror || target.pl_trandep, target.st_rad, target.st_mass, points > 20].filter(Boolean).length;
  const completenessScore = Math.round((completeness / 5) * 100);
  const evidenceScore = Math.max(0, Math.min(100, Math.round((audit.audit.total + completenessScore) / 2)));

  return [
    { label: "Data completeness", value: completenessScore, detail: "period, star, depth, local data" },
    { label: "Depth agreement", value: depthScore, detail: depthMismatch === null ? "waiting for model" : `${(depthMismatch * 100).toFixed(1)}% mismatch` },
    { label: "Residual quality", value: residualScore, detail: "scatter compared with depth" },
    { label: "Evidence readiness", value: evidenceScore, detail: "quick-look audit coverage" }
  ];
}
