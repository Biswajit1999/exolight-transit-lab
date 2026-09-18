import assert from "node:assert/strict";
import { estimateBoxDepth, runInjectionScenario, seededRandom, simulateTransitEvents } from "../src/analysis/injectionRecovery.js";

const base = { scenarioId: "test", depthPpm: 1000, noisePpm: 500, rho: 0, events: 12, pointsPerEvent: 101, durationPhase: 0.03, trials: 500, seed: 42 };
const seriesA = simulateTransitEvents(base, seededRandom(9));
const seriesB = simulateTransitEvents(base, seededRandom(9));
assert.deepEqual(seriesA, seriesB, "seeded simulations must be identical");
const estimate = estimateBoxDepth(seriesA);
assert.ok(Number.isFinite(estimate.depthPpm));
assert.ok(estimate.iidSePpm > 0 && estimate.clusterSePpm > 0);

const white = runInjectionScenario(base);
const red = runInjectionScenario({ ...base, scenarioId: "red", rho: 0.8, seed: 43 });
assert.ok(Math.abs(white.biasPpm) < 15, `white-noise bias too large: ${white.biasPpm}`);
assert.ok(white.iidCoverage95 > 0.90 && white.iidCoverage95 < 0.98);
assert.ok(red.iidCoverage95 < white.iidCoverage95 - 0.10);
assert.ok(red.clusterCoverage95 > red.iidCoverage95 + 0.10);
assert.ok(red.clusterCoverage95 > 0.88 && red.clusterCoverage95 < 0.99);
console.log("Injection-recovery tests: PASS");
