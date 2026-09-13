const UNKNOWN = "Unknown";

function known(value) {
  const text = String(value ?? "").trim();
  return text && text.toLowerCase() !== "unknown" ? text : UNKNOWN;
}

function normaliseState(value) {
  const state = String(value ?? "").trim().toLowerCase();
  return ["complete", "partial", "unknown", "invalid"].includes(state) ? state : "unknown";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function buildDataLineage({ provenance = {}, analysis = {} } = {}) {
  const manifest = provenance?.datasetManifest;
  const diagnostics = Array.isArray(analysis.diagnostics)
    ? analysis.diagnostics.map(known).filter(value => value !== UNKNOWN)
    : [];

  if (!manifest) {
    return {
      state: "unknown",
      observationAttached: false,
      source: { archive: UNKNOWN, mission: UNKNOWN, productId: UNKNOWN, retrievalUtc: UNKNOWN },
      local: { file: UNKNOWN, transforms: [] },
      analysis: { model: known(analysis.model), diagnostics }
    };
  }

  return {
    state: normaliseState(provenance.completeness),
    observationAttached: true,
    source: {
      archive: known(manifest.upstream?.archive),
      mission: known(manifest.mission),
      productId: known(manifest.upstream?.productId),
      retrievalUtc: known(manifest.upstream?.retrievedUtc)
    },
    local: {
      file: known(manifest.local?.file),
      transforms: Array.isArray(manifest.local?.transform)
        ? manifest.local.transform.map(known).filter(value => value !== UNKNOWN)
        : []
    },
    analysis: { model: known(analysis.model), diagnostics }
  };
}

function rows(items) {
  return items.filter(([, value]) => value !== UNKNOWN).map(([label, value]) =>
    `<div class="lineage-meta"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
  ).join("");
}

function stage(title, body, modifier = "") {
  return `<article class="lineage-stage ${modifier}"><span class="lineage-stage-label">${escapeHtml(title)}</span>${body}</article>`;
}

export function renderDataLineage({ provenance = {}, analysis = {} } = {}) {
  const lineage = buildDataLineage({ provenance, analysis });

  if (!lineage.observationAttached) {
    const diagnostics = lineage.analysis.diagnostics.length
      ? `<ul>${lineage.analysis.diagnostics.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : "<p>No diagnostics recorded.</p>";
    return `<section class="data-lineage data-lineage-model-only" aria-label="Data lineage">
      <div class="lineage-header"><div><span class="lineage-eyebrow">Data lineage</span><strong>No archival observation attached</strong></div><span class="lineage-state unknown">UNKNOWN</span></div>
      <p class="lineage-note">This view is using catalogue parameters and/or a theoretical model; it is not presented as an attached archival observation.</p>
      <div class="lineage-flow">${stage("MODEL", `<strong>${escapeHtml(lineage.analysis.model)}</strong>`)}<span class="lineage-arrow" aria-hidden="true">→</span>${stage("DIAGNOSTICS", diagnostics)}</div>
    </section>`;
  }

  const sourceBody = `<strong>${escapeHtml(lineage.source.archive)}</strong>${rows([["Mission", lineage.source.mission], ["Product ID", lineage.source.productId], ["Retrieved", lineage.source.retrievalUtc]])}`;
  const localBody = `<strong>${escapeHtml(lineage.local.file)}</strong>`;
  const transformBody = lineage.local.transforms.length
    ? `<ul>${lineage.local.transforms.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : "<p>No local transforms recorded.</p>";
  const analysisBody = `<strong>${escapeHtml(lineage.analysis.model)}</strong>${lineage.analysis.diagnostics.length ? `<ul>${lineage.analysis.diagnostics.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}`;

  return `<section class="data-lineage" aria-label="Data lineage">
    <div class="lineage-header"><div><span class="lineage-eyebrow">Data lineage</span><strong>Source → cache → processing → analysis</strong></div><span class="lineage-state ${escapeHtml(lineage.state)}">${escapeHtml(lineage.state.toUpperCase())}</span></div>
    <div class="lineage-flow">${stage("SOURCE", sourceBody)}<span class="lineage-arrow" aria-hidden="true">→</span>${stage("LOCAL DATASET", localBody)}<span class="lineage-arrow" aria-hidden="true">→</span>${stage("PROCESSING", transformBody)}<span class="lineage-arrow" aria-hidden="true">→</span>${stage("ANALYSIS", analysisBody)}</div>
  </section>`;
}
