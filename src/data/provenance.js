/* ============================================================================
   ExoLight Phase III - Provenance primitives
   Every displayed diagnostic should eventually point to a source, transform, and version.
   ============================================================================ */

export const PROVENANCE_SCHEMA_VERSION = "exolight-provenance-v1";

function stableString(value, fallback = "unknown") {
  const clean = String(value ?? "").trim();
  return clean || fallback;
}

function stableDate(value) {
  const date = value ? new Date(value) : new Date(0);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toISOString();
}

export function createProvenanceEvent({
  field = "unknown",
  source = "unknown",
  dataset = "unknown",
  identifier = "unknown",
  retrievedUtc = null,
  version = "unknown",
  transform = "none",
  notes = ""
} = {}) {
  return {
    schemaVersion: PROVENANCE_SCHEMA_VERSION,
    field: stableString(field),
    source: stableString(source),
    dataset: stableString(dataset),
    identifier: stableString(identifier),
    retrievedUtc: retrievedUtc ? stableDate(retrievedUtc) : "unknown",
    version: stableString(version),
    transform: stableString(transform, "none"),
    notes: stableString(notes, "")
  };
}

export function defaultTargetProvenance(target = {}) {
  const planet = stableString(target.pl_name, "target");
  const host = stableString(target.hostname, "host");
  const identifier = `${planet} around ${host}`;

  const catalogueFields = [
    "pl_name",
    "hostname",
    "pl_orbper",
    "pl_trandep",
    "pl_ratror",
    "pl_orbincl",
    "pl_orbeccen",
    "pl_orblper",
    "st_rad",
    "st_mass",
    "st_teff"
  ];

  const events = catalogueFields.map(field => createProvenanceEvent({
    field,
    source: "local ExoLight catalogue cache",
    dataset: "data/exoplanets.json",
    identifier,
    version: "local-static-cache",
    transform: field === "pl_trandep" || field === "pl_ratror" ? "displayed or cross-checked by browser model" : "displayed directly"
  }));

  if (target.lightcurve_available && target.lightcurve_file) {
    events.push(createProvenanceEvent({
      field: "lightcurve",
      source: "local ExoLight light-curve cache",
      dataset: `data/lightcurves/${target.lightcurve_file}`,
      identifier,
      version: "local-static-cache",
      transform: "phase-folded normalised JSON"
    }));
  } else {
    events.push(createProvenanceEvent({
      field: "lightcurve",
      source: "synthetic fallback",
      dataset: "browser-generated demonstration curve",
      identifier,
      version: "runtime",
      transform: "not archival photometry"
    }));
  }

  return {
    schemaVersion: PROVENANCE_SCHEMA_VERSION,
    target: { planet, host },
    completeness: "partial",
    events
  };
}

export function provenanceCompleteness(manifest = {}) {
  const events = Array.isArray(manifest.events) ? manifest.events : [];
  if (!events.length) return { status: "unknown", label: "No provenance", detail: "No provenance events are attached." };

  const unknowns = events.filter(event =>
    !event ||
    event.source === "unknown" ||
    event.dataset === "unknown" ||
    event.identifier === "unknown"
  ).length;

  if (unknowns === 0 && events.some(event => event.retrievedUtc !== "unknown")) {
    return { status: "pass", label: "Complete", detail: "All displayed fields have source pointers and at least one retrieval timestamp." };
  }

  if (unknowns < events.length) {
    return { status: "caution", label: "Partial", detail: "Fields have local source pointers, but not all retrieval dates or upstream archive versions are recorded yet." };
  }

  return { status: "unknown", label: "Unknown", detail: "Most displayed fields do not yet have usable provenance pointers." };
}
