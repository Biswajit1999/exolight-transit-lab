import { buildTargetAudit, auditToMarkdown } from "../intelligence/targetAudit.js";
import { diagnosticGauge } from "./gauge.js";

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

function auditScoreFromLabel(checks, label, fallback = 0) {
  const match = checks.find(check => String(check.label || "").toLowerCase().includes(label));
  return Number.isFinite(Number(match?.score)) ? Number(match.score) : fallback;
}

function qualityBars(audit, state) {
  const checks = audit.audit.checks || [];
  const target = state?.target || {};
  const metrics = state?.metrics || {};
  const points = Number(state?.archivalCurve?.points || 0);
  const catalogueDepth = Number(target.pl_trandep);
  const modelDepth = Number(metrics.modelDepthPpm);
  const depthMismatch = Number.isFinite(catalogueDepth) && catalogueDepth > 0 && Number.isFinite(modelDepth)
    ? Math.abs(modelDepth - catalogueDepth) / catalogueDepth
    : null;
  const depthScore = depthMismatch === null ? auditScoreFromLabel(checks, "depth", 40) : Math.max(0, Math.round(100 - depthMismatch * 420));
  const residualScore = Number.isFinite(Number(metrics.residualRmsPpm)) && Number.isFinite(modelDepth) && modelDepth > 0
    ? Math.max(0, Math.round(100 - (Number(metrics.residualRmsPpm) / modelDepth) * 220))
    : auditScoreFromLabel(checks, "residual", 55);
  const completeness = [target.pl_orbper, target.pl_ratror || target.pl_trandep, target.st_rad, target.st_mass, points > 20].filter(Boolean).length;
  const completenessScore = Math.round((completeness / 5) * 100);
  const evidenceScore = Math.max(0, Math.min(100, Math.round((audit.audit.total + completenessScore) / 2)));

  return [
    { label: "Data completeness", value: completenessScore, detail: "period, star, depth, local data" },
    { label: "Depth agreement", value: depthScore, detail: depthMismatch === null ? "waiting for model" : `${(depthMismatch * 100).toFixed(1)}% mismatch` },
    { label: "Residual quality", value: residualScore, detail: "scatter compared with depth" },
    { label: "Evidence readiness", value: evidenceScore, detail: "quick-look audit coverage" }
  ];
}

function qualityBar(item) {
  const value = Math.max(0, Math.min(100, Number(item.value) || 0));
  return `
    <div class="mission-quality-row">
      <div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></div>
      <span>${Math.round(value)}%</span>
      <i aria-hidden="true"><b style="width:${value}%"></b></i>
    </div>
  `;
}

function provenanceSnapshot(state) {
  const target = state?.target || {};
  const points = Number(state?.archivalCurve?.points || 0);
  const source = target.lightcurve_file || state?.archivalCurve?.source || "model only";
  const cadence = Number(target.cadence_seconds || target.exposure_time || target.exp_time);
  const lastUpdated = target.provenance?.retrieved_utc || target.generated_utc || target.provenance?.updated || "not recorded";
  const archives = [target.disc_facility, target.discoverymethod, source].filter(Boolean).length;
  return { points, source, cadence, lastUpdated, archives };
}

function recentEvents(audit, state) {
  const now = new Date().toISOString().slice(11, 19);
  return [
    { time: now, text: `Target switched to ${audit.targetName}` },
    { time: now, text: `Model audit refreshed at score ${audit.audit.total}/100` },
    { time: now, text: `${Number(state?.archivalCurve?.points || 0).toLocaleString("en-GB")} visible photometric samples` },
    { time: now, text: "Evidence state synced with current controls" }
  ];
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

function downloadJson(audit) {
  const blob = new Blob([JSON.stringify(audit, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const safeName = String(audit.targetName || "target").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  link.href = url;
  link.download = `${safeName || "target"}-exolight-audit.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function copyShareLink(audit) {
  const url = new URL(window.location.href);
  url.hash = `target=${encodeURIComponent(audit.targetName)}`;
  navigator.clipboard?.writeText(url.href).catch(() => {});
}

export function renderMissionControl(container, state) {
  if (!container) return null;

  const audit = buildTargetAudit(state);
  const klass = scoreClass(audit.audit.total);
  const firstHint = audit.hints[0];
  const catalogue = audit.state.catalogue;
  const model = audit.state.model;
  const metrics = audit.state.metrics;
  const provenance = provenanceSnapshot(state);
  const quality = qualityBars(audit, state);
  const events = recentEvents(audit, state);

  container.innerHTML = `
    <section class="mission-control-card ${klass}" aria-label="ExoLight Mission Control target audit">
      <div class="mission-control-header">
        <div class="mission-title-block">
          <p class="mission-eyebrow">ExoLight Mission Control</p>
          <h2>${escapeHtml(audit.targetName)}</h2>
          <span>${escapeHtml(audit.hostName)}</span>
        </div>
        ${diagnosticGauge({ score: audit.audit.total, label: audit.audit.rating, className: "mission-score", size: "large" })}
      </div>

      <div class="mission-dashboard-grid">
        <section class="mission-block mission-summary-block">
          <h3>Target summary</h3>
          <div class="mission-metric-grid">
            ${metricTile("Period", formatMetric(catalogue.periodDays, " d", 5), "catalogue")}
            ${metricTile("Depth", formatMetric(catalogue.depthPpm, " ppm", 0), "catalogue")}
            ${metricTile("Rp/R★", formatMetric(catalogue.radiusRatio, "", 4), "catalogue")}
            ${metricTile("Local data", catalogue.lightcurveAvailable ? "available" : "model only", catalogue.lightcurveFile || "fallback")}
            ${metricTile("Model depth", formatMetric(metrics.modelDepthPpm, " ppm", 0), "worker output")}
            ${metricTile("Residual RMS", formatMetric(metrics.residualRmsPpm, " ppm", 0), "data-model")}
          </div>
        </section>

        <section class="mission-block mission-quality-block">
          <h3>Data quality overview</h3>
          ${quality.map(qualityBar).join("")}
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

        <section class="mission-block mission-provenance-block">
          <h3>Provenance snapshot</h3>
          <div class="mission-provenance-grid">
            ${metricTile("Archives", formatMetric(provenance.archives, "", 0), provenance.source)}
            ${metricTile("Photometric points", formatMetric(provenance.points, "", 0), "visible in dashboard")}
            ${metricTile("Cadence", Number.isFinite(provenance.cadence) ? `${provenance.cadence.toFixed(1)} s` : "not recorded", "metadata")}
            ${metricTile("Last updated", provenance.lastUpdated, "source manifest")}
          </div>
        </section>

        <section class="mission-block mission-events-block">
          <h3>Recent events</h3>
          <ol class="mission-events">
            ${events.map(event => `<li><time>${escapeHtml(event.time)}</time><span>${escapeHtml(event.text)}</span></li>`).join("")}
          </ol>
        </section>

        <section class="mission-block mission-actions-block">
          <h3>Quick actions</h3>
          <div class="mission-quick-actions">
            <button class="button mission-export" type="button">Export audit Markdown</button>
            <button class="button mission-export-json" type="button">Export JSON</button>
            <button class="button mission-share-link" type="button">Share target link</button>
            <button class="button" type="button" disabled title="Session snapshots will be enabled after the audit schema is formalised.">Save snapshot soon</button>
          </div>
          <small>Exploratory audit only — not a detection claim.</small>
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
    </section>
  `;

  container.querySelector(".mission-export")?.addEventListener("click", () => downloadAudit(audit));
  container.querySelector(".mission-export-json")?.addEventListener("click", () => downloadJson(audit));
  container.querySelector(".mission-share-link")?.addEventListener("click", () => copyShareLink(audit));

  return audit;
}
