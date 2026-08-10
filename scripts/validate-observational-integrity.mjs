import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const cataloguePath = path.join(root, "data", "exoplanets.json");
const lightcurveDir = path.join(root, "data", "lightcurves");
const reportDir = path.join(root, "results", "validation");
const reportPath = path.join(reportDir, "observational-integrity-report.json");
const summaryPath = path.join(reportDir, "observational-integrity-summary.md");

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normaliseSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\+/g, "plus")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function quantile(values, q) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, q * (sorted.length - 1)));
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

function medianAbsoluteDeviation(values) {
  const med = quantile(values, 0.5);
  if (med === null) return null;
  const deviations = values.map((value) => Math.abs(value - med));
  return quantile(deviations, 0.5);
}

function extractPoints(payload) {
  if (Array.isArray(payload?.points)) {
    return payload.points.map((point) => ({
      phase: finiteNumber(point.phase ?? point.Phase ?? point.x),
      flux: finiteNumber(point.flux ?? point.Flux ?? point.normalized_flux ?? point.y),
      error: finiteNumber(point.error ?? point.err ?? point.flux_err),
    }));
  }

  if (Array.isArray(payload?.phase) && Array.isArray(payload?.flux)) {
    const n = Math.min(payload.phase.length, payload.flux.length);
    return Array.from({ length: n }, (_, index) => ({
      phase: finiteNumber(payload.phase[index]),
      flux: finiteNumber(payload.flux[index]),
      error: finiteNumber(Array.isArray(payload.error) ? payload.error[index] : null),
    }));
  }

  if (Array.isArray(payload?.data)) {
    return payload.data.map((point) => ({
      phase: finiteNumber(point.phase ?? point[0]),
      flux: finiteNumber(point.flux ?? point[1]),
      error: finiteNumber(point.error ?? point[2]),
    }));
  }

  return [];
}

async function loadJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function validateTarget(target, index, availableFiles) {
  const errors = [];
  const warnings = [];
  const name = String(target.pl_name || "").trim();
  const host = String(target.hostname || "").trim();
  const lightcurveFile = String(target.lightcurve_file || "").trim();

  if (!name) errors.push("missing pl_name");
  if (!host) errors.push("missing hostname");
  if (finiteNumber(target.pl_orbper) === null) errors.push("missing finite orbital period");
  if (finiteNumber(target.pl_trandep) === null && finiteNumber(target.pl_ratror) === null) {
    errors.push("missing transit depth and radius ratio");
  }
  if (finiteNumber(target.st_teff) === null) warnings.push("missing stellar effective temperature");

  if (target.lightcurve_available) {
    if (!lightcurveFile) {
      errors.push("observed target has no lightcurve_file");
    } else if (!availableFiles.has(lightcurveFile)) {
      errors.push(`observed target references missing light curve ${lightcurveFile}`);
    }
  } else if (lightcurveFile && availableFiles.has(lightcurveFile)) {
    warnings.push("lightcurve_file exists but lightcurve_available is false");
  }

  return {
    index,
    target: name || `target-${index}`,
    host,
    lightcurveFile,
    observed: Boolean(target.lightcurve_available),
    errors,
    warnings,
  };
}

function validateLightcurve(file, payload, catalogueTarget = null) {
  const errors = [];
  const warnings = [];
  const points = extractPoints(payload);
  const finite = points.filter((point) => Number.isFinite(point.phase) && Number.isFinite(point.flux));
  const flux = finite.map((point) => point.flux);
  const phase = finite.map((point) => point.phase);
  const source = String(payload?.source || "").trim();
  const planet = String(payload?.planet || catalogueTarget?.pl_name || "").trim();
  const host = String(payload?.hostname || catalogueTarget?.hostname || "").trim();
  const declaredCount = finiteNumber(payload?.points_count);

  if (!source) errors.push("missing source provenance");
  if (/synthetic|demo|placeholder/i.test(source)) errors.push("observed light curve provenance appears synthetic/demo");
  if (!planet) warnings.push("missing planet field and catalogue target context");
  if (!host) warnings.push("missing hostname field and catalogue target context");
  if (finite.length < 50) errors.push(`too few finite points (${finite.length})`);
  if (points.length !== finite.length) warnings.push(`${points.length - finite.length} malformed points ignored`);
  if (declaredCount !== null && Math.abs(declaredCount - finite.length) > 2) {
    warnings.push(`points_count=${declaredCount} differs from finite point count=${finite.length}`);
  }

  const minPhase = Math.min(...phase);
  const maxPhase = Math.max(...phase);
  const medFlux = quantile(flux, 0.5);
  const madFlux = medianAbsoluteDeviation(flux);
  const minFlux = Math.min(...flux);
  const maxFlux = Math.max(...flux);

  if (!Number.isFinite(minPhase) || !Number.isFinite(maxPhase) || minPhase >= maxPhase) {
    errors.push("phase axis is not finite and increasing");
  }
  if (medFlux === null || medFlux < 0.85 || medFlux > 1.15) {
    warnings.push(`median flux ${medFlux === null ? "unknown" : medFlux.toFixed(5)} is outside normalized range`);
  }
  if (madFlux !== null && madFlux <= 0) errors.push("flux values have zero scatter");
  if (Number.isFinite(minFlux) && Number.isFinite(maxFlux) && maxFlux - minFlux > 0.25) {
    warnings.push("flux span is large for a normalized transit light curve");
  }

  return {
    file,
    planet,
    host,
    source,
    points: finite.length,
    declaredCount,
    minPhase,
    maxPhase,
    medianFlux: medFlux,
    madFlux,
    minFlux,
    maxFlux,
    errors,
    warnings,
  };
}

function markdownSummary(report) {
  const lines = [
    "# Observational Integrity Summary",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    `| Catalogue targets | ${report.catalogue.targets} |`,
    `| Observed targets | ${report.catalogue.observedTargets} |`,
    `| Local light-curve files | ${report.lightcurves.files} |`,
    `| Valid light curves | ${report.lightcurves.validFiles} |`,
    `| Total finite photometry points | ${report.lightcurves.totalFinitePoints} |`,
    `| Target errors | ${report.catalogue.errors} |`,
    `| Light-curve errors | ${report.lightcurves.errors} |`,
    `| Warnings | ${report.catalogue.warnings + report.lightcurves.warnings} |`,
    "",
    "## Policy",
    "",
    "Observed targets must have local photometry files with explicit source provenance. Model-only targets are allowed only when `lightcurve_available` is false, so the interface can label them honestly as theoretical/simulation views.",
    "",
  ];

  if (report.failures.length) {
    lines.push("## Failures", "");
    for (const failure of report.failures.slice(0, 50)) lines.push(`- ${failure}`);
    if (report.failures.length > 50) lines.push(`- ... ${report.failures.length - 50} additional failures`);
    lines.push("");
  }

  if (report.warnings.length) {
    lines.push("## Warnings", "");
    for (const warning of report.warnings.slice(0, 50)) lines.push(`- ${warning}`);
    if (report.warnings.length > 50) lines.push(`- ... ${report.warnings.length - 50} additional warnings`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const catalogue = await loadJson(cataloguePath);
  const targets = Array.isArray(catalogue.targets) ? catalogue.targets : [];
  assert.ok(targets.length > 0, "data/exoplanets.json must contain a non-empty targets array");

  const files = (await readdir(lightcurveDir)).filter((file) => file.endsWith(".json")).sort();
  const availableFiles = new Set(files);
  const targetReports = targets.map((target, index) => validateTarget(target, index, availableFiles));

  const referenced = new Set(
    targets
      .map((target) => String(target.lightcurve_file || "").trim())
      .filter(Boolean)
  );
  const targetByFile = new Map(
    targets
      .map((target) => [String(target.lightcurve_file || "").trim(), target])
      .filter(([file]) => Boolean(file))
  );

  const orphanFiles = files.filter((file) => !referenced.has(file));
  const slugIndex = new Map(targets.map((target) => [normaliseSlug(target.pl_name), target]));
  const probablyUsefulOrphans = orphanFiles.filter((file) => slugIndex.has(file.replace(/\.json$/i, "")));

  const lightcurveReports = [];
  for (const file of files) {
    lightcurveReports.push(validateLightcurve(file, await loadJson(path.join(lightcurveDir, file)), targetByFile.get(file)));
  }

  const targetFailures = targetReports.flatMap((item) => item.errors.map((error) => `${item.target}: ${error}`));
  const targetWarnings = targetReports.flatMap((item) => item.warnings.map((warning) => `${item.target}: ${warning}`));
  const lightcurveFailures = lightcurveReports.flatMap((item) => item.errors.map((error) => `${item.file}: ${error}`));
  const lightcurveWarnings = lightcurveReports.flatMap((item) => item.warnings.map((warning) => `${item.file}: ${warning}`));

  const report = {
    schema: "exolight-observational-integrity-v1",
    generatedAt: new Date().toISOString(),
    catalogue: {
      file: "data/exoplanets.json",
      source: catalogue.source || "unknown",
      generatedUtc: catalogue.generated_utc || "unknown",
      targets: targets.length,
      observedTargets: targetReports.filter((item) => item.observed).length,
      errors: targetFailures.length,
      warnings: targetWarnings.length,
    },
    lightcurves: {
      directory: "data/lightcurves",
      files: files.length,
      validFiles: lightcurveReports.filter((item) => item.errors.length === 0).length,
      totalFinitePoints: lightcurveReports.reduce((sum, item) => sum + item.points, 0),
      errors: lightcurveFailures.length,
      warnings: lightcurveWarnings.length,
      orphanFiles,
      probablyUsefulOrphans,
    },
    failures: [...targetFailures, ...lightcurveFailures],
    warnings: [...targetWarnings, ...lightcurveWarnings],
  };

  await mkdir(reportDir, { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(summaryPath, markdownSummary(report));

  assert.equal(report.failures.length, 0, `observational integrity failures: ${report.failures.slice(0, 5).join("; ")}`);
  console.log(`Observational integrity: PASS (${report.catalogue.targets} targets, ${report.lightcurves.files} light curves, ${report.lightcurves.totalFinitePoints} finite points)`);
  if (report.warnings.length) {
    console.log(`Observational integrity warnings: ${report.warnings.length}; see ${path.relative(root, summaryPath)}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
