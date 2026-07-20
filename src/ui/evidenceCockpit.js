import { buildEvidenceCockpit } from "../intelligence/evidenceBuilder.js";
import { diagnosticGauge } from "./gauge.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function statusLabel(status) {
  return ({ pass: "PASS", caution: "CAUTION", warn: "WARNING", fail: "FAIL", unknown: "UNKNOWN" }[status] || "UNKNOWN");
}

function evidenceCard(item) {
  return `
    <article class="evidence-card ${escapeHtml(item.status)}" tabindex="0">
      <div class="evidence-card-head">
        <strong>${escapeHtml(item.label)}</strong>
        <span>${statusLabel(item.status)}</span>
      </div>
      <p>${escapeHtml(item.detail)}</p>
      <dl>
        <div><dt>Source</dt><dd>${escapeHtml(item.source)}</dd></div>
        <div><dt>Next step</dt><dd>${escapeHtml(item.nextStep)}</dd></div>
      </dl>
    </article>
  `;
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function renderEvidenceCockpit(container, state) {
  if (!container) return null;
  const cockpit = buildEvidenceCockpit(state);
  const safeName = String(cockpit.targetName || "target").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "target";

  container.innerHTML = `
    <section class="evidence-cockpit-card" aria-label="False-positive evidence cockpit">
      <div class="evidence-header">
        <div>
          <p class="evidence-eyebrow">Phase III vetting evidence</p>
          <h2>${escapeHtml(cockpit.targetName)}</h2>
          <span>${escapeHtml(cockpit.hostName)}</span>
        </div>
        ${diagnosticGauge({ score: cockpit.score, label: "Evidence readiness", className: "evidence-score-gauge", size: "large" })}
      </div>

      <div class="evidence-summary">
        <strong>Quick-look result</strong>
        <p>${escapeHtml(cockpit.summary)}</p>
      </div>

      <div class="evidence-grid">
        ${cockpit.evidence.map(evidenceCard).join("")}
      </div>

      <details class="evidence-provenance">
        <summary>Show provenance manifest preview</summary>
        <pre>${escapeHtml(JSON.stringify(cockpit.provenance, null, 2))}</pre>
      </details>

      <div class="evidence-actions">
        <button class="button evidence-export-json" type="button">Export evidence JSON</button>
        <span>${escapeHtml(cockpit.disclaimer)}</span>
      </div>
    </section>
  `;

  const button = container.querySelector(".evidence-export-json");
  button?.addEventListener("click", () => downloadJson(`${safeName}-exolight-evidence.json`, cockpit));

  return cockpit;
}
