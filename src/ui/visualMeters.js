function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function valuePercent(value, fallback = 0) {
  const number = finite(value);
  return number === null ? fallback : clamp(number, 0, 100);
}

function classifyScore(score) {
  if (score >= 85) return "excellent";
  if (score >= 65) return "good";
  if (score >= 40) return "caution";
  return "poor";
}

function fmt(value, digits = 0, suffix = "") {
  const number = finite(value);
  if (number === null) return "—";
  return `${number.toLocaleString("en-GB", { maximumFractionDigits: digits })}${suffix}`;
}

export function depthAgreementPercent(catalogueDepthPpm, modelDepthPpm) {
  const catalogue = finite(catalogueDepthPpm);
  const model = finite(modelDepthPpm);
  if (catalogue === null || model === null || catalogue <= 0) return 0;
  const fractionalDifference = Math.abs(model - catalogue) / catalogue;
  return clamp(100 - fractionalDifference * 240, 0, 100);
}

export function residualQualityPercent(residualRmsPpm, modelDepthPpm) {
  const rms = finite(residualRmsPpm);
  const depth = finite(modelDepthPpm);
  if (rms === null || depth === null || depth <= 0) return 0;
  const ratio = rms / depth;
  return clamp(100 - ratio * 220, 0, 100);
}

export function dataCompletenessPercent(target) {
  const fields = [
    target?.pl_orbper,
    target?.pl_trandep ?? target?.pl_ratror,
    target?.pl_orbincl,
    target?.st_rad,
    target?.st_mass,
    target?.st_teff,
    target?.lightcurve_available ? 1 : null
  ];
  const present = fields.filter(value => finite(value) !== null || value === true).length;
  return Math.round((present / fields.length) * 100);
}

export function renderMeter({ label, value, detail }) {
  const percent = valuePercent(value);
  const klass = classifyScore(percent);
  return `
    <article class="deck-meter ${klass}">
      <div class="deck-meter-head">
        <span>${escapeHtml(label)}</span>
        <strong>${fmt(percent, 0, "%")}</strong>
      </div>
      <div class="deck-meter-track" aria-hidden="true">
        <i style="width:${percent}%"></i>
      </div>
      <small>${escapeHtml(detail)}</small>
    </article>
  `;
}

export function renderVisualMeters({ target, metrics, audit }) {
  const score = finite(audit?.audit?.total) ?? 0;
  const depthAgreement = depthAgreementPercent(target?.pl_trandep, metrics?.modelDepthPpm);
  const residualQuality = residualQualityPercent(metrics?.residualRmsPpm, metrics?.modelDepthPpm);
  const completeness = dataCompletenessPercent(target);

  return `
    <section class="deck-meter-grid" aria-label="Target visual quality meters">
      ${renderMeter({ label: "Mission readiness", value: score, detail: audit?.audit?.rating || "catalogue/model audit" })}
      ${renderMeter({ label: "Depth agreement", value: depthAgreement, detail: "catalogue depth versus live model" })}
      ${renderMeter({ label: "Residual quality", value: residualQuality, detail: "scatter compared with transit depth" })}
      ${renderMeter({ label: "Data completeness", value: completeness, detail: "period, star, depth and local light curve" })}
    </section>
  `;
}
