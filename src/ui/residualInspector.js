import { analyseResidualState } from "../intelligence/residualAnalysis.js";
import { diagnosticGauge } from "./gauge.js";
import { drawResidualCharts } from "./residualCharts.js";

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatPpm(value, digits = 0) {
  const number = finite(value);
  if (number === null) return "—";
  return `${number.toLocaleString("en-GB", { maximumFractionDigits: digits })} ppm`;
}

function classify(value) {
  const number = finite(value) ?? 0;
  if (number >= 82) return "stable";
  if (number >= 58) return "watch";
  if (number >= 35) return "caution";
  return "poor";
}

function regionLabel(key) {
  return { ingress: "Ingress", centre: "Transit centre", egress: "Egress", outOfTransit: "Out of transit", unknown: "Unknown" }[key] || key;
}

function regionBar(key, region, maxRms) {
  const rms = finite(region?.rmsPpm);
  const width = rms === null || !maxRms ? 0 : Math.max(5, Math.min(100, (rms / maxRms) * 100));
  return `
    <article class="residual-region ${key}">
      <div class="residual-region-head"><span>${escapeHtml(regionLabel(key))}</span><strong>${escapeHtml(formatPpm(rms))}</strong></div>
      <div class="residual-region-track" aria-hidden="true"><i style="width:${width}%"></i></div>
      <small>${region?.count === null || region?.count === undefined ? "inferred region" : `${region.count} samples`}</small>
    </article>
  `;
}

function chartShell(id, title, caption) {
  return `
    <section class="residual-chart-card">
      <div class="residual-chart-head"><h3>${escapeHtml(title)}</h3><span>${escapeHtml(caption)}</span></div>
      <canvas id="${escapeHtml(id)}" class="residual-chart-canvas" height="190"></canvas>
    </section>
  `;
}

export function renderResidualInspector(container, state) {
  if (!container) return null;
  const analysis = analyseResidualState(state);
  const score = finite(analysis.quality?.score) ?? 0;
  const klass = classify(score);
  const regions = analysis.regions || {};
  const maxRms = Math.max(...Object.values(regions).map(region => finite(region?.rmsPpm) ?? 0), 0);
  const samples = Array.isArray(state?.residualSamples) ? state.residualSamples : [];

  container.innerHTML = `
    <section class="residual-inspector-card ${klass}" aria-label="Residual Intelligence Layer">
      <div class="residual-header">
        <div>
          <p class="residual-eyebrow">Residual Intelligence</p>
          <h2>Model disagreement map</h2>
          <span>${escapeHtml(analysis.source)} · ${escapeHtml(analysis.quality?.label || "pending")}</span>
        </div>
        ${diagnosticGauge({ score, label: analysis.quality?.label || "pending", className: "residual-score-gauge", size: "compact" })}
      </div>

      <div class="residual-grid">
        <section class="residual-summary">
          <h3>Strongest mismatch</h3>
          <strong>${escapeHtml(regionLabel(analysis.strongestRegion))}</strong>
          <p>${escapeHtml(analysis.researchHint)}</p>
          <div class="residual-outlier-row"><span>Outlier estimate</span><strong>${analysis.outliers?.count ?? "—"}</strong><small>threshold ${escapeHtml(formatPpm(analysis.outliers?.thresholdPpm))}</small></div>
        </section>
        <section class="residual-regions" aria-label="Residual regions">
          ${["ingress", "centre", "egress", "outOfTransit"].map(key => regionBar(key, regions[key], maxRms)).join("")}
        </section>
      </div>

      <div class="residual-chart-grid">
        ${chartShell("residual-scatter-canvas", "Residual scatter", samples.length ? `${samples.length.toLocaleString("en-GB")} observed samples` : "waiting for local photometry")}
        ${chartShell("residual-binned-canvas", "Binned residuals", "phase bins with uncertainty bars")}
        ${chartShell("residual-periodogram-canvas", "Periodogram", "quick-look systematics scan")}
      </div>

      <div class="residual-footer">
        <span>${escapeHtml(analysis.quality?.detail || "Waiting for residual diagnostics.")}</span>
        <small>${escapeHtml(samples.length ? "Charts use local light-curve samples and the current smooth model approximation." : analysis.caution)}</small>
      </div>
    </section>
  `;

  drawResidualCharts(container, samples);
  return analysis;
}
