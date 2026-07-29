import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { semiMajorAxisFromPeriod } from "../src/physics/orbit.js";
import { transitDepthPpm, transitDurationHours, makeLightCurve } from "../src/physics/transit.js";
import { undilutedDepth, radiusRatioFromDilutedDepth } from "../src/physics/dilution.js";
import { PHYSICS_CORE_VERSION } from "../src/physics/validation.js";
import {
  assertArrayFinite,
  assertAtMost,
  assertEqual,
  assertFinite,
  assertWithin,
  recordAssertion
} from "../tests/helpers/assertions.mjs";

const ROOT = process.cwd();
const FIXTURE_PATH = path.join(ROOT, "tests", "referenceTargets.json");
const OUTPUT_DIR = path.join(ROOT, "results", "validation");
const JSON_REPORT = path.join(OUTPUT_DIR, "reference-report.json");
const MD_REPORT = path.join(OUTPUT_DIR, "reference-summary.md");

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function findMinimumSample(curve) {
  if (!curve.length) throw new Error("Curve is empty.");
  return curve.reduce((best, sample) => sample.model < best.model ? sample : best, curve[0]);
}

function maxDepthPpm(curve) {
  return Math.max(...curve.map(sample => Math.max(0, 1 - sample.model) * 1e6));
}

function midpointSymmetryPpm(curve) {
  const n = curve.length;
  let worst = 0;
  for (let i = 0; i < Math.floor(n / 2); i += 1) {
    const left = curve[i].model;
    const right = curve[n - 1 - i].model;
    worst = Math.max(worst, Math.abs(left - right) * 1e6);
  }
  return worst;
}

function classifyTransit(curve, thresholdPpm = 100) {
  return maxDepthPpm(curve) > thresholdPpm ? "TRANSIT" : "NO_TRANSIT";
}

function runObservationalBenchmark(testCase) {
  const assertions = [];
  const { inputs, expected } = testCase;
  const semiMajorAxisAU = semiMajorAxisFromPeriod(inputs.periodDays, inputs.stellarMassSolar);
  const depthPpm = transitDepthPpm(inputs.radiusRatio);
  const durationHoursApprox = transitDurationHours(
    inputs.periodDays,
    inputs.stellarRadiusSolar,
    semiMajorAxisAU,
    inputs.impactParameter ?? 0
  );

  recordAssertion(assertions, "semiMajorAxisAU finite", () => assertFinite(semiMajorAxisAU, "semiMajorAxisAU"));
  recordAssertion(assertions, "depthPpm finite", () => assertFinite(depthPpm, "depthPpm"));
  recordAssertion(assertions, "durationHoursApprox finite", () => assertFinite(durationHoursApprox, "durationHoursApprox"));
  recordAssertion(assertions, "semiMajorAxisAU within tolerance", () => assertWithin(semiMajorAxisAU, expected.semiMajorAxisAU.value, expected.semiMajorAxisAU.absoluteTolerance, "semiMajorAxisAU"));
  recordAssertion(assertions, "depthPpm within tolerance", () => assertWithin(depthPpm, expected.depthPpm.value, expected.depthPpm.absoluteTolerance, "depthPpm"));
  recordAssertion(assertions, "durationHoursApprox within tolerance", () => assertWithin(durationHoursApprox, expected.durationHoursApprox.value, expected.durationHoursApprox.absoluteTolerance, "durationHoursApprox"));

  return {
    outputs: { semiMajorAxisAU, depthPpm, durationHoursApprox },
    assertions
  };
}

function runGeometryCase(testCase) {
  const assertions = [];
  const { inputs, expected } = testCase;
  const params = {
    phase: 0.5,
    aRs: inputs.scaledSemiMajorAxis,
    incDeg: inputs.inclinationDeg,
    ecc: inputs.eccentricity,
    omegaDeg: inputs.omegaDeg ?? 90,
    rpRs: inputs.radiusRatio,
    limb: inputs.limb ?? [0, 0, 0, 0],
    noisePpm: inputs.noisePpm ?? 0,
    spot: false,
    moon: false
  };

  const curve = makeLightCurve(params, 801);
  const fluxes = curve.map(sample => sample.model);
  const depthPpm = maxDepthPpm(curve);
  const minimum = findMinimumSample(curve);
  const classification = classifyTransit(curve);
  const symmetryPpm = midpointSymmetryPpm(curve);
  const minFlux = Math.min(...fluxes);
  const maxFlux = Math.max(...fluxes);

  recordAssertion(assertions, "model flux array finite", () => assertArrayFinite(fluxes, `${testCase.id}.model`));
  recordAssertion(assertions, "minimum flux non-negative", () => assertAtMost(0, minFlux + 1e-9, `${testCase.id}.negativeFluxGuard`));
  recordAssertion(assertions, "baseline flux not above tolerance", () => assertAtMost(maxFlux, 1.000001, `${testCase.id}.maxFlux`));
  recordAssertion(assertions, "classification", () => assertEqual(classification, expected.classification, `${testCase.id}.classification`));

  if (expected.classification === "TRANSIT") {
    recordAssertion(assertions, "depthPpm within tolerance", () => assertWithin(depthPpm, expected.depthPpm.value, expected.depthPpm.absoluteTolerance, `${testCase.id}.depthPpm`));
    recordAssertion(assertions, "minimum phase within tolerance", () => assertWithin(minimum.phase, expected.minimumPhase.value, expected.minimumPhase.absoluteTolerance, `${testCase.id}.minimumPhase`));
    recordAssertion(assertions, "symmetry within tolerance", () => assertAtMost(symmetryPpm, expected.symmetryPpm.maximum, `${testCase.id}.symmetryPpm`));
  } else {
    recordAssertion(assertions, "max depth near zero", () => assertAtMost(depthPpm, expected.maxDepthPpm.maximum, `${testCase.id}.maxDepthPpm`));
  }

  return {
    outputs: {
      classification,
      depthPpm,
      minimumPhase: minimum.phase,
      minimumFlux: minimum.model,
      symmetryPpm,
      minFlux,
      maxFlux,
      samples: curve.length
    },
    assertions
  };
}

function runDilutionCase(testCase) {
  const assertions = [];
  const { inputs, expected } = testCase;
  const correctedDepthFraction = undilutedDepth(inputs.observedDepthFraction, inputs.contaminantToTargetFluxRatio);
  const correctedRadiusRatio = radiusRatioFromDilutedDepth(inputs.observedDepthFraction, inputs.contaminantToTargetFluxRatio);

  recordAssertion(assertions, "corrected depth finite", () => assertFinite(correctedDepthFraction, `${testCase.id}.correctedDepthFraction`));
  recordAssertion(assertions, "corrected radius ratio finite", () => assertFinite(correctedRadiusRatio, `${testCase.id}.correctedRadiusRatio`));
  recordAssertion(assertions, "corrected depth within tolerance", () => assertWithin(correctedDepthFraction, expected.correctedDepthFraction.value, expected.correctedDepthFraction.absoluteTolerance, `${testCase.id}.correctedDepthFraction`));
  recordAssertion(assertions, "corrected radius ratio within tolerance", () => assertWithin(correctedRadiusRatio, expected.correctedRadiusRatio.value, expected.correctedRadiusRatio.absoluteTolerance, `${testCase.id}.correctedRadiusRatio`));

  return {
    outputs: { correctedDepthFraction, correctedRadiusRatio },
    assertions
  };
}

function runCase(testCase) {
  if (!testCase?.id || !testCase?.type || !testCase?.inputs) {
    return {
      id: testCase?.id || "unknown-fixture",
      type: testCase?.type || "unknown",
      passed: false,
      fixtureValid: false,
      assertions: [{ label: "fixture shape", passed: false, message: "Reference case requires id, type, and inputs." }],
      outputs: {}
    };
  }

  let result;
  if (testCase.type === "observational-benchmark") result = runObservationalBenchmark(testCase);
  else if (testCase.type === "deterministic-geometry") result = runGeometryCase(testCase);
  else if (testCase.type === "dilution-physics") result = runDilutionCase(testCase);
  else {
    result = {
      outputs: {},
      assertions: [{ label: "case type", passed: false, message: `Unknown reference case type: ${testCase.type}` }]
    };
  }

  const passed = result.assertions.every(assertion => assertion.passed);
  return {
    id: testCase.id,
    type: testCase.type,
    rationale: testCase.rationale || "not recorded",
    passed,
    fixtureValid: true,
    outputs: result.outputs,
    assertions: result.assertions
  };
}

function markdownReport(report) {
  const lines = [];
  lines.push("# ExoLight Reference Regression Summary");
  lines.push("");
  lines.push(`Generated UTC: ${report.generatedUtc}`);
  lines.push(`Physics core version: ${report.physicsCoreVersion}`);
  lines.push(`Overall status: ${report.passed ? "PASS" : "FAIL"}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Cases: ${report.summary.cases}`);
  lines.push(`- Passed cases: ${report.summary.passed}`);
  lines.push(`- Failed cases: ${report.summary.failed}`);
  lines.push(`- Assertions: ${report.summary.assertions}`);
  lines.push("");
  lines.push("## Results");
  lines.push("");
  lines.push("| Case | Type | Status | Key output |");
  lines.push("|---|---|---:|---|");

  for (const result of report.results) {
    const keyOutput = result.outputs.depthPpm !== undefined
      ? `depth ${finite(result.outputs.depthPpm, 0).toFixed(1)} ppm`
      : result.outputs.correctedDepthFraction !== undefined
        ? `corrected depth ${finite(result.outputs.correctedDepthFraction, 0).toFixed(6)}`
        : result.outputs.semiMajorAxisAU !== undefined
          ? `a=${finite(result.outputs.semiMajorAxisAU, 0).toFixed(5)} AU`
          : "see JSON";
    lines.push(`| ${result.id} | ${result.type} | ${result.passed ? "PASS" : "FAIL"} | ${keyOutput} |`);
  }

  lines.push("");
  lines.push("## Scientific boundary");
  lines.push("");
  lines.push("These tests protect deterministic physics and numerical invariants. They are not discovery claims, false-positive probabilities, or posterior inference results.");
  lines.push("Expected values are manually curated and must not be silently regenerated from current implementation output.");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const raw = await fs.readFile(FIXTURE_PATH, "utf8");
  const fixtures = JSON.parse(raw);
  const cases = Array.isArray(fixtures.cases) ? fixtures.cases : [];
  const results = cases.map(runCase);
  const assertionCount = results.reduce((sum, result) => sum + result.assertions.length, 0);
  const passedCount = results.filter(result => result.passed).length;
  const failedCount = results.length - passedCount;

  const report = {
    schemaVersion: "exolight-reference-report-v1",
    generatedUtc: new Date().toISOString(),
    physicsCoreVersion: PHYSICS_CORE_VERSION,
    passed: failedCount === 0,
    summary: {
      cases: results.length,
      passed: passedCount,
      failed: failedCount,
      assertions: assertionCount
    },
    fixtureSchemaVersion: fixtures.schemaVersion || "unknown",
    results
  };

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(MD_REPORT, markdownReport(report));

  console.log(JSON.stringify(report.summary, null, 2));
  if (!report.passed) {
    console.error(`Reference regression failed: ${failedCount} case(s) failed.`);
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
