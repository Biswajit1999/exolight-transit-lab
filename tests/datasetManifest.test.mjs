import assert from "node:assert/strict";

import {
  DATASET_MANIFEST_VERSION,
  createDatasetManifest,
  manifestCompleteness,
  manifestToProvenanceEvent,
  validateDatasetManifest
} from "../src/data/datasetManifest.js";

const complete = createDatasetManifest({
  target: "Example b",
  host: "Example",
  mission: "TESS",
  productType: "lightcurve",
  archive: "MAST",
  productId: "mast:TESS:example",
  sourceUrl: "https://mast.stsci.edu/",
  retrievedUtc: "2026-08-09T00:00:00Z",
  archiveVersion: "public archive product",
  localFile: "data/lightcurves/example-b.json",
  transforms: ["quality filtering", "normalisation", "phase folding"],
  units: { phase: "dimensionless", flux: "relative" }
});

assert.equal(complete.schemaVersion, DATASET_MANIFEST_VERSION);
assert.deepEqual(validateDatasetManifest(complete), { valid: true, missing: [], malformed: [] });
assert.equal(manifestCompleteness(complete).status, "complete");
assert.equal(manifestCompleteness(complete).score, 100);

const missingRetrieval = createDatasetManifest({
  target: "Example b",
  archive: "MAST",
  localFile: "data/lightcurves/example-b.json",
  transforms: ["normalisation"]
});
assert.equal(validateDatasetManifest(missingRetrieval).valid, true);
assert.equal(manifestCompleteness(missingRetrieval).status, "partial");
assert.ok(manifestCompleteness(missingRetrieval).score < 100);

const missingArchive = createDatasetManifest({
  target: "Example b",
  localFile: "data/lightcurves/example-b.json"
});
assert.equal(validateDatasetManifest(missingArchive).valid, false);
assert.ok(validateDatasetManifest(missingArchive).missing.includes("upstream.archive"));

const malformedTransforms = {
  ...complete,
  local: { ...complete.local, transform: "normalisation" }
};
assert.equal(validateDatasetManifest(malformedTransforms).valid, false);
assert.ok(validateDatasetManifest(malformedTransforms).malformed.includes("local.transform"));

const unknownUnits = createDatasetManifest({
  target: "Example b",
  archive: "MAST",
  localFile: "data/lightcurves/example-b.json",
  units: {}
});
assert.equal(validateDatasetManifest(unknownUnits).valid, true);
assert.equal(manifestCompleteness(unknownUnits).status, "partial");

const zeroMetadata = createDatasetManifest({
  target: "Example b",
  archive: "MAST",
  localFile: "data/lightcurves/example-b.json",
  units: { qualityFlag: 0 }
});
assert.equal(zeroMetadata.units.qualityFlag, "0");

const event = manifestToProvenanceEvent(complete);
assert.equal(event.source, "MAST");
assert.equal(event.dataset, "data/lightcurves/example-b.json");
assert.equal(event.identifier, "mast:TESS:example");
assert.match(event.transform, /phase folding/);

console.log("Dataset manifest validation: PASS");
