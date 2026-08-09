export const DATASET_MANIFEST_VERSION = "exolight-dataset-manifest-v1";

function cleanString(value, fallback = "unknown") {
  const clean = String(value ?? "").trim();
  return clean || fallback;
}

function normaliseTransforms(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => cleanString(item, "")).filter(Boolean);
}

function normaliseUnits(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, unit]) => [cleanString(key), cleanString(unit)])
  );
}

export function createDatasetManifest({
  target,
  host = "unknown",
  mission = "unknown",
  productType = "lightcurve",
  archive,
  productId = "unknown",
  sourceUrl = "unknown",
  retrievedUtc = "unknown",
  archiveVersion = "unknown",
  localFile,
  transforms = [],
  units = {},
  notes = ""
} = {}) {
  return {
    schemaVersion: DATASET_MANIFEST_VERSION,
    target: cleanString(target),
    host: cleanString(host),
    mission: cleanString(mission),
    productType: cleanString(productType),
    upstream: {
      archive: cleanString(archive),
      productId: cleanString(productId),
      sourceUrl: cleanString(sourceUrl),
      retrievedUtc: cleanString(retrievedUtc),
      version: cleanString(archiveVersion)
    },
    local: {
      file: cleanString(localFile),
      transform: normaliseTransforms(transforms)
    },
    units: normaliseUnits(units),
    notes: cleanString(notes, "")
  };
}

export function validateDatasetManifest(manifest = {}) {
  const missing = [];
  const malformed = [];

  if (manifest.schemaVersion !== DATASET_MANIFEST_VERSION) malformed.push("schemaVersion");
  if (!manifest.target || manifest.target === "unknown") missing.push("target");
  if (!manifest.upstream?.archive || manifest.upstream.archive === "unknown") missing.push("upstream.archive");
  if (!manifest.local?.file || manifest.local.file === "unknown") missing.push("local.file");
  if (manifest.local?.transform !== undefined && !Array.isArray(manifest.local.transform)) malformed.push("local.transform");
  if (manifest.units !== undefined && (!manifest.units || typeof manifest.units !== "object" || Array.isArray(manifest.units))) malformed.push("units");

  return {
    valid: missing.length === 0 && malformed.length === 0,
    missing,
    malformed
  };
}

export function manifestCompleteness(manifest = {}) {
  const validation = validateDatasetManifest(manifest);
  if (!validation.valid) {
    return {
      status: validation.malformed.length ? "invalid" : "incomplete",
      score: 0,
      missing: validation.missing,
      malformed: validation.malformed
    };
  }

  const optionalChecks = [
    manifest.host,
    manifest.mission,
    manifest.productType,
    manifest.upstream?.productId,
    manifest.upstream?.sourceUrl,
    manifest.upstream?.retrievedUtc,
    manifest.upstream?.version
  ];
  const knownOptional = optionalChecks.filter(value => value && value !== "unknown").length;
  const transformKnown = Array.isArray(manifest.local?.transform) && manifest.local.transform.length > 0 ? 1 : 0;
  const unitKnown = manifest.units && Object.keys(manifest.units).length > 0 ? 1 : 0;
  const score = Math.round(((knownOptional + transformKnown + unitKnown) / 9) * 100);

  return {
    status: score === 100 ? "complete" : "partial",
    score,
    missing: [],
    malformed: []
  };
}

export function manifestToProvenanceEvent(manifest = {}) {
  const completeness = manifestCompleteness(manifest);
  return {
    field: manifest.productType || "dataset",
    source: manifest.upstream?.archive || "unknown",
    dataset: manifest.local?.file || "unknown",
    identifier: manifest.upstream?.productId || manifest.target || "unknown",
    retrievedUtc: manifest.upstream?.retrievedUtc || "unknown",
    version: manifest.upstream?.version || "unknown",
    transform: Array.isArray(manifest.local?.transform) && manifest.local.transform.length
      ? manifest.local.transform.join("; ")
      : "none recorded",
    notes: [
      manifest.mission && manifest.mission !== "unknown" ? `mission=${manifest.mission}` : null,
      `manifest=${completeness.status}:${completeness.score}%`,
      manifest.notes || null
    ].filter(Boolean).join(" | ")
  };
}
