import assert from "node:assert/strict";

import {
  impactParameterAtTransit,
  approximateTransitDurationHours,
  assessTransitPlausibility
} from "../src/physics/plausibility.js";

function close(actual, expected, tolerance, label) {
  assert.ok(Number.isFinite(actual), `${label} must be finite`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected} ± ${tolerance}, received ${actual}`);
}

const central = assessTransitPlausibility({
  periodDays: 3,
  scaledSemiMajorAxis: 12,
  inclinationDeg: 90,
  eccentricity: 0,
  omegaDeg: 90,
  radiusRatio: 0.1
});
close(central.impactParameter, 0, 1e-12, "central impact parameter");
assert.equal(central.status, "pass");
assert.equal(central.grazing, false);
assert.ok(central.predictedDurationHours > 0);

const grazingInclination = Math.acos(1 / 12) * 180 / Math.PI;
const grazing = assessTransitPlausibility({
  periodDays: 3,
  scaledSemiMajorAxis: 12,
  inclinationDeg: grazingInclination,
  radiusRatio: 0.1
});
close(grazing.impactParameter, 1, 1e-10, "grazing impact parameter");
assert.equal(grazing.status, "caution");
assert.equal(grazing.grazing, true);

const nonTransit = assessTransitPlausibility({
  periodDays: 3,
  scaledSemiMajorAxis: 12,
  inclinationDeg: 82,
  radiusRatio: 0.1
});
assert.equal(nonTransit.status, "fail");
assert.equal(nonTransit.label, "no geometric transit");
assert.ok(nonTransit.impactParameter >= 1.1);

const missing = assessTransitPlausibility({
  periodDays: 3,
  inclinationDeg: 90,
  radiusRatio: 0.1
});
assert.equal(missing.status, "unknown");
assert.equal(missing.impactParameter, null);

const circularB = impactParameterAtTransit({
  scaledSemiMajorAxis: 10,
  inclinationDeg: 86,
  eccentricity: 0,
  omegaDeg: 90
});
const eccentricB = impactParameterAtTransit({
  scaledSemiMajorAxis: 10,
  inclinationDeg: 86,
  eccentricity: 0.3,
  omegaDeg: 90
});
assert.ok(Number.isFinite(eccentricB));
assert.notEqual(eccentricB, circularB);

const duration = approximateTransitDurationHours({
  periodDays: 3,
  scaledSemiMajorAxis: 12,
  inclinationDeg: 90,
  radiusRatio: 0.1,
  impactParameter: 0
});
const agreement = assessTransitPlausibility({
  periodDays: 3,
  scaledSemiMajorAxis: 12,
  inclinationDeg: 90,
  radiusRatio: 0.1,
  catalogueDurationHours: duration * 1.05
});
assert.equal(agreement.status, "pass");

const mismatch = assessTransitPlausibility({
  periodDays: 3,
  scaledSemiMajorAxis: 12,
  inclinationDeg: 90,
  radiusRatio: 0.1,
  catalogueDurationHours: duration * 1.8
});
assert.equal(mismatch.status, "warn");
assert.equal(mismatch.label, "duration mismatch");

const invalidEccentricity = assessTransitPlausibility({
  periodDays: 3,
  scaledSemiMajorAxis: 12,
  inclinationDeg: 90,
  eccentricity: 1,
  radiusRatio: 0.1
});
assert.equal(invalidEccentricity.status, "unknown");

console.log("Transit plausibility tests: PASS");
