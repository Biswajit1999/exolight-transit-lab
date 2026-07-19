import { buildTargetAudit, auditToMarkdown } from "../intelligence/targetAudit.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function scoreClass(score) {
  if (score >= 90) return "excellent";
  if (score >= 70) return "good";
  if (score >= 40) return "caution";
  return "poor";
}

function formatMetric(value, suffix = "", digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${number.toLocaleString("en-GB", { maximumFractionDigits: digits })}${suffix}`;
}

function metricTile(label, value, detail = "") {
  return `
    <div class="mission-metric-tile">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}
    </div>
  `;
}

function statusPill(label, active, activeText = "ON", inactiveText = "OFF") {
  return `<span class="mission-pill ${active ? "active" : ""}">${escapeHtml(label)} ${active ? activeText : inactiveText}</span>`;
}

function downloadAudit(audit) {
  const markdown = auditToMarkdown(audit);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const safeName = String(audit.targetName || "target")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

  link.href = url;
  link.download = `${safeName || "target"}-exolight-audit.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function renderMissionControl(container, state) {
  if (!container) return null;

  const audit = buildTargetAudit(state);
  const klass = scoreClass(audit.audit.total);
  const firstHint = audit.hints[0];
  const catalogue = audit.state.catalogue;
  const model = audit.state.model;
  const metrics = audit.state.metrics;

  container.innerHTML = `
    <section class="mission-control-card ${klass}" aria-label="ExoLight Mission Control target audit">
      <div class="mission-control-header">
        <div class="mission-title-block">
          <p class="mission-eyebrow">ExoLight Mission Control</p>
          <h2>${escapeHtml(audit.targetName)}</h2>
          <span>${escapeHtml(audit.hostName)}</span>
        </div>
        <div class="mission-score" title="Catalogue/model readiness score">
          <strong>${audit.audit.total}</strong>
          <span>/100</span>
          <small>${escapeHtml(audit.audit.rating)}</small>
        </div>
      </div>

      <div class="mission-grid">
        <section class="mission-block">
          <h3>Catalogue lock</h3>
          <div class="mission-metric-grid">
            ${metricTile("Period", formatMetric(catalogue.periodDays, " d", 5), "catalogue")}
            ${metricTile("Depth", formatMetric(catalogue.depthPpm, " ppm", 0), "catalogue")}
            ${metricTile("Rp/R★", formatMetric(catalogue.radiusRatio, "", 4), "catalogue")}
            ${metricTile("Local data", catalogue.lightcurveAvailable ? "available" : "model only", catalogue.lightcurveFile || "fallback")}
          </div>
        </section>

        <section class="mission-block">
          <h3>Live model</h3>
          <div class="mission-metric-grid">
            ${metricTile("Model depth", formatMetric(metrics.modelDepthPpm, " ppm", 0), "worker output")}
            ${metricTile("Residual RMS", formatMetric(metrics.residualRmsPpm, " ppm", 0), "data-model")}
            ${metricTile("Inclination", formatMetric(model.inclinationDeg, "°", 2), "current")}
            ${metricTile("a/R★", formatMetric(model.scaledSemiMajorAxis, "", 2), "current")}
          </div>
        </section>

        <section class="mission-block mission-next-step">
          <h3>Research next step</h3>
          <article class="mission-hint ${escapeHtml(firstHint?.level || "info")}">
            <strong>${escapeHtml(firstHint?.title || "Inspect target")}</strong>
            <p>${escapeHtml(firstHint?.text || "Review catalogue fields and compare the model against the plotted light curve.")}</p>
          </article>
          <div class="mission-hypotheses">
            ${statusPill("Starspot", model.starspotEnabled)}
            ${statusPill("Exomoon", model.exomoonEnabled)}
            ${statusPill("Exposure", model.exposureIntegration, `${model.exposureSamples || ""}×`, "instant")}
          </div>
        </section>
      </div>

      <details class="mission-details">
        <summary>Show audit checks and extra hints</summary>
        <div class="mission-detail-grid">
          <section>
            <h4>Checks</h4>
            <ul>
              ${audit.audit.checks.map(check => `<li><strong>${escapeHtml(check.label)}</strong> — ${escapeHtml(check.detail)}</li>`).join("")}
            </ul>
          </section>
          <section>
            <h4>Hints</h4>
            <ul>
              ${audit.hints.map(hint => `<li><strong>${escapeHtml(hint.title)}</strong> — ${escapeHtml(hint.text)}</li>`).join("")}
            </ul>
          </section>
        </div>
      </details>

      <div class="mission-actions">
        <button class="button mission-export" type="button">Export target audit</button>
        <span>Exploratory audit only — not a detection claim.</span>
      </div>
    </section>
  `;

  const button = container.querySelector(".mission-export");
  button?.addEventListener("click", () => downloadAudit(audit));

  return audit;
}
