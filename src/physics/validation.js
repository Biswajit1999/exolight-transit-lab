import { semiMajorAxisFromPeriod, scaledSemiMajorAxis } from "./orbit.js";
import { radiusRatioFromDepthPpm, transitDepthPpm, transitDurationHours } from "./transit.js";

export const PHYSICS_CORE_VERSION = "phase-iii-core-v0.1";

export const BENCHMARK_TARGETS = Object.freeze([
  {
    id: "hd-189733-b",
    label: "HD 189733 b",
    periodDays: 2.218576,
    stellarMassSolar: 0.82,
    stellarRadiusSolar: 0.76,
    radiusRatio: 0.1436,
    reference: {
      semiMajorAxisAU: 0.031,
      depthPpm: 20625,
      durationHoursApprox: 1.8
    },
    tolerance: {
      semiMajorAxisAU: 0.004,
      depthPpm: 900,
      durationHoursApprox: 0.8
    }
  }
]);

function withinTolerance(actual, expected, tolerance) {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
}

export function validateBenchmark(target = BENCHMARK_TARGETS[0]) {
  const semiMajorAxisAU = semiMajorAxisFromPeriod(target.periodDays, target.stellarMassSolar);
  const depthPpm = transitDepthPpm(target.radiusRatio ?? radiusRatioFromDepthPpm(target.reference.depthPpm));
  const aRs = scaledSemiMajorAxis(semiMajorAxisAU, target.stellarRadiusSolar);
  const durationHoursApprox = transitDurationHours(target.periodDays, target.stellarRadiusSolar, semiMajorAxisAU, 0);

  const checks = {
    semiMajorAxisAU: withinTolerance(semiMajorAxisAU, target.reference.semiMajorAxisAU, target.tolerance.semiMajorAxisAU),
    depthPpm: withinTolerance(depthPpm, target.reference.depthPpm, target.tolerance.depthPpm),
    durationHoursApprox: withinTolerance(durationHoursApprox, target.reference.durationHoursApprox, target.tolerance.durationHoursApprox)
  };

  return {
    version: PHYSICS_CORE_VERSION,
    target: target.label,
    passed: Object.values(checks).every(Boolean),
    checks,
    computed: {
      semiMajorAxisAU,
      scaledSemiMajorAxis: aRs,
      depthPpm,
      durationHoursApprox
    },
    reference: target.reference
  };
}

export function validatePhysicsCore() {
  const results = BENCHMARK_TARGETS.map(validateBenchmark);
  return {
    version: PHYSICS_CORE_VERSION,
    passed: results.every(result => result.passed),
    results
  };
}
