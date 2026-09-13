import assert from "node:assert/strict";
import { buildDataLineage, renderDataLineage } from "../src/ui/dataLineage.js";

const partial = buildDataLineage({
  provenance: {
    completeness: "partial",
    datasetManifest: {
      mission: "unknown",
      upstream: { archive: "MAST", productId: "unknown", retrievedUtc: "unknown" },
      local: { file: "data/lightcurves/au-mic-b.json", transform: ["phase folding for ExoIntel-Prime"] }
    }
  },
  analysis: { model: "ExoLight worker transit forward model", diagnostics: ["geometry plausibility", "residual diagnostics"] }
});
assert.equal(partial.source.archive, "MAST");
assert.equal(partial.source.productId, "Unknown");
assert.equal(partial.state, "partial");
assert.equal(partial.observationAttached, true);
assert.deepEqual(partial.local.transforms, ["phase folding for ExoIntel-Prime"]);

const complete = buildDataLineage({ provenance: { completeness: "complete", datasetManifest: { mission: "TESS", upstream: { archive: "MAST", productId: "TIC-1", retrievedUtc: "2026-09-13T00:00:00Z" }, local: { file: "curve.json", transform: ["normalisation", "phase folding"] } } } });
assert.equal(complete.state, "complete");
assert.equal(complete.source.mission, "TESS");
assert.equal(complete.local.transforms.length, 2);

const modelOnly = buildDataLineage({ provenance: {}, analysis: { model: "Transit forward model" } });
assert.equal(modelOnly.observationAttached, false);
assert.equal(modelOnly.state, "unknown");

const malformed = buildDataLineage({ provenance: { completeness: "invalid", datasetManifest: { upstream: { archive: "MAST" }, local: { transform: "not-an-array" } } } });
assert.equal(malformed.state, "invalid");
assert.deepEqual(malformed.local.transforms, []);

const unknownState = buildDataLineage({ provenance: { completeness: "surprise", datasetManifest: { upstream: {}, local: {} } } });
assert.equal(unknownState.state, "unknown");
assert.equal(unknownState.source.retrievalUtc, "Unknown");

const hostile = renderDataLineage({ provenance: { completeness: "partial", datasetManifest: { upstream: { archive: "<script>alert(1)</script>" }, local: { file: "<img src=x onerror=alert(1)>", transform: ["<b>fold</b>"] } } }, analysis: { model: "<iframe>bad</iframe>", diagnostics: ["<svg onload=alert(1)>"] } });
assert.equal(hostile.includes("<script>"), false);
assert.equal(hostile.includes("<img src=x"), false);
assert.equal(hostile.includes("<iframe>bad"), false);
assert.equal(hostile.includes("&lt;script&gt;"), true);

const modelHtml = renderDataLineage({ provenance: {}, analysis: { model: "Transit model" } });
assert.equal(modelHtml.includes("No archival observation attached"), true);

console.log("Data lineage HUD tests passed.");
