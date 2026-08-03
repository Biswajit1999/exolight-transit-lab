import { inferDilutionRisk } from "../physics/dilution.js";
import { assessTransitPlausibility } from "../physics/plausibility.js";
import { defaultTargetProvenance, provenanceCompleteness } from "../data/provenance.js";

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function fractionalDepthMismatch(target, metrics) {
  const catalogueDepth = finite(target?.pl_trandep);
  const modelDepth = finite(metrics?.modelDepthPpm);
  if (catalogueDepth === null || modelDepth === null || catalogueDepth <= 0) return null;
  return Math.abs(modelDepth - catalogueDepth) / catalogueDepth;
}

function statusRank(status) {
  return ({ fail: 4, warn: 3, caution: 2, unknown: 1, pass: 0 }[status] ?? 1);
}

function item({ id, label, status, detail, source = "ExoLight quick-look evidence", nextStep = "Review with mission-standard products before making a claim." }) {
  return { id, label, status, detail, source, nextStep };
}

export function buildEvidenceCockpit({ target = {}, params = {}, metrics = {}, archivalCurve = {}, provenance = null } = {}) {
  const evidence = [];
  const mismatch = fractionalDepthMismatch(target, metrics);
  const localPhotometry = Boolean(target.lightcurve_available || Number(archivalCurve.points) > 20);
  const manifest = provenance || defaultTargetProvenance(target);
  const provenanceState = provenanceCompleteness(manifest);

  evidence.push(item({
    id: "depth-consistency",
    label: "Depth consistency",
    status: mismatch === null ? "unknown" : mismatch > 0.25 ? "warn" : mismatch > 0.10 ? "caution" : "pass",
    detail: mismatch === null
      ? "Catalogue and model depth cannot both be read yet."
      : `Catalogue/model depth mismatch is ${(mismatch * 100).toFixed(1)}%.`,
    source: "Catalogue depth compared with current worker model depth",
    nextStep: mismatch !== null && mismatch > 0.10
      ? "Check passband, dilution, radius-ratio source, and detrending before interpreting morphology."
      : "Keep monitoring residuals after parameter changes."
  }));

  const geometry = assessTransitPlausibility({
    periodDays: target.pl_orbper ?? params.periodDays,
    scaledSemiMajorAxis: params.aRs ?? params.scaledSemiMajorAxis ?? target.pl_ratdor,
    inclinationDeg: params.incDeg ?? params.inclinationDeg ?? target.pl_orbincl,
    eccentricity: target.pl_orbeccen ?? params.ecc ?? params.eccentricity ?? 0,
    omegaDeg: target.pl_orblper ?? params.omegaDeg ?? 90,
    radiusRatio: params.rpRs ?? params.radiusRatio ?? target.pl_ratror,
    catalogueDurationHours: target.pl_trandur
  });

  evidence.push(item({
    id: "geometry-plausibility",
    label: "Geometry plausibility",
    status: geometry.status,
    detail: geometry.detail,
    source: "Catalogue orbital parameters and current forward-model geometry",
    nextStep: geometry.status === "unknown"
      ? "Add the missing inclination, a/R★, radius ratio, period, or duration metadata."
      : geometry.status === "pass"
        ? "Compare the quick-look result with uncertainty-aware fitted parameters."
        : "Review catalogue values, phase alignment, dilution, and transit-duration assumptions."
  }));

  evidence.push(item({
    id: "odd-even",
    label: "Odd-even test",
    status: "unknown",
    detail: "Odd and even transit depths are not separately available in the static folded JSON view yet.",
    source: "Kepler/TESS DV-style diagnostic placeholder",
    nextStep: "Add per-transit or sector-level light-curve metadata before assigning pass/warn/fail."
  }));

  evidence.push(item({
    id: "secondary-eclipse",
    label: "Secondary eclipse",
    status: "unknown",
    detail: "No phase-0.5 secondary-eclipse search is attached to this target yet.",
    source: "Kepler/TESS DV-style diagnostic placeholder",
    nextStep: "Add a shallow secondary-search analyzer using out-of-transit phase windows."
  }));

  const dilution = inferDilutionRisk({
    depthPpm: target.pl_trandep,
    radiusRatio: target.pl_ratror,
    contaminantToTargetFluxRatio: target.contaminant_flux_ratio ?? target.gaia_flux_ratio ?? null,
    neighbourCount: target.neighbour_count ?? null
  });

  evidence.push(item({
    id: "dilution-risk",
    label: "Dilution risk",
    status: dilution.status === "pass" ? "pass" : dilution.status === "caution" ? "caution" : dilution.status === "warn" ? "warn" : "unknown",
    detail: dilution.detail,
    source: "Blend/dilution physics utility; Gaia neighbour data when available",
    nextStep: dilution.status === "unknown"
      ? "Attach Gaia neighbour flux ratios or aperture contamination metadata."
      : "Compare corrected radius ratio against catalogue and model values."
  }));

  evidence.push(item({
    id: "centroid-neighbour",
    label: "Centroid / neighbour",
    status: "unknown",
    detail: "No centroid motion or Gaia neighbour field is attached to the current target cache yet.",
    source: "MAST/Exo.MAST/Gaia evidence layer planned",
    nextStep: "Cache Gaia neighbours separately and add centroid offsets from DV products where available."
  }));

  evidence.push(item({
    id: "local-photometry",
    label: "Local photometry",
    status: localPhotometry ? "pass" : "unknown",
    detail: localPhotometry
      ? `${Number(archivalCurve.points || 0).toLocaleString("en-GB")} local/model samples are visible to the current dashboard.`
      : "This target is currently model-only or using a synthetic demonstration fallback.",
    source: target.lightcurve_file || archivalCurve.source || "runtime state",
    nextStep: localPhotometry
      ? "Inspect residuals and provenance for the selected product."
      : "Add a mission light curve from MAST, Exo.MAST, Kepler, K2, TESS, or reviewed ground-based data."
  }));

  evidence.push(item({
    id: "systematics",
    label: "Sector/systematics",
    status: "unknown",
    detail: "No TESS sector, Kepler quarter, DRN, momentum-dump, scattered-light, or release-note flags are linked yet.",
    source: "TESS/Kepler release-note evidence layer planned",
    nextStep: "Add sector or quarter provenance so release-note warnings can be surfaced beside the plot."
  }));

  evidence.push(item({
    id: "provenance",
    label: "Provenance",
    status: provenanceState.status,
    detail: provenanceState.detail,
    source: "ExoLight provenance manifest",
    nextStep: "Record upstream source table, retrieval date, archive version, and local transform for each displayed field."
  }));

  const worst = evidence.reduce((max, current) => statusRank(current.status) > statusRank(max.status) ? current : max, evidence[0]);
  const score = Math.max(0, Math.round(100 - evidence.reduce((sum, e) => sum + statusRank(e.status), 0) * 8));

  return {
    targetName: target.pl_name || "Unknown target",
    hostName: target.hostname || "Unknown host",
    score,
    summary: worst?.status === "pass"
      ? "No major quick-look evidence warnings are visible."
      : `${worst.label}: ${worst.detail}`,
    evidence,
    geometry,
    provenance: manifest,
    disclaimer: "Evidence badges are quick-look diagnostics, not a formal false-positive probability or validation claim."
  };
}
