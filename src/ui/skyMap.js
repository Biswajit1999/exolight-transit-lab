function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

function riskLabel(risk) {
  if (risk === "high") return "High";
  if (risk === "medium") return "Medium";
  if (risk === "low") return "Low";
  return "Unknown";
}

function magToRadius(gMag, targetMag) {
  const delta = Number.isFinite(gMag) && Number.isFinite(targetMag) ? gMag - targetMag : 4;
  const clamped = Math.max(-2, Math.min(10, delta));
  return Math.max(1.4, 6 - clamped * 0.55);
}

function polarPosition(separationArcsec, index, radiusPx, maxArcsec) {
  const angle = (index * 137.508) % 360; // golden-angle spread so nearby points don't overlap
  const distance = Math.min(1, separationArcsec / maxArcsec) * radiusPx;
  const rad = (angle * Math.PI) / 180;
  return { x: 110 + distance * Math.cos(rad), y: 110 + distance * Math.sin(rad) };
}

function renderStarField(entry) {
  const maxArcsec = entry.searchRadiusArcsec || 100;
  const neighbours = entry.neighbours || [];
  const dots = neighbours.slice(0, 20).map((n, i) => {
    const { x, y } = polarPosition(n.separationArcsec, i, 92, maxArcsec);
    const r = magToRadius(n.gMag, entry.targetGMag);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" class="skymap-star risk-${n.contaminationRisk}">
      <title>${escapeHtml(n.sourceId)} · sep ${n.separationArcsec}&quot; · G ${n.gMag ?? "—"}</title>
    </circle>`;
  }).join("");

  return `
    <svg class="skymap-svg" viewBox="0 0 220 220" role="img" aria-label="Gaia DR3 field around the target, ${neighbours.length} neighbours within ${maxArcsec} arcseconds">
      <circle cx="110" cy="110" r="92" class="skymap-radius-ring" />
      <circle cx="110" cy="110" r="46" class="skymap-radius-ring inner" />
      <circle cx="110" cy="110" r="5.5" class="skymap-target-star" />
      ${dots}
    </svg>
    <div class="skymap-legend">
      <span><i class="skymap-dot risk-low"></i>Low</span>
      <span><i class="skymap-dot risk-medium"></i>Medium</span>
      <span><i class="skymap-dot risk-high"></i>High</span>
      <span class="skymap-radius-label">field radius ${maxArcsec}&quot;</span>
    </div>
  `;
}

function renderNeighbourTable(entry) {
  const rows = (entry.neighbours || []).slice(0, 8).map(n => `
    <tr>
      <td class="skymap-source-id">${escapeHtml(String(n.sourceId || "—").slice(-8))}</td>
      <td>${n.separationArcsec != null ? `${n.separationArcsec}&Prime;` : "—"}</td>
      <td>${n.deltaMag != null ? (n.deltaMag > 0 ? "+" : "") + n.deltaMag : "—"}</td>
      <td><span class="skymap-risk-pill risk-${n.contaminationRisk}">${riskLabel(n.contaminationRisk)}</span></td>
    </tr>
  `).join("");

  return `
    <table class="skymap-table">
      <thead>
        <tr><th>Gaia source</th><th>Separation</th><th>&Delta;G</th><th>Contamination</th></tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="4" class="skymap-empty-row">No neighbours resolved within the search radius.</td></tr>`}</tbody>
    </table>
  `;
}

export function renderSkyMap(entry, target) {
  if (!entry) {
    return `
      <section class="deck-skymap-card unavailable" aria-label="Gaia sky map">
        <div class="deck-section-heading">
          <span>Sky map</span>
          <strong>Gaia DR3 neighbours</strong>
        </div>
        <p class="skymap-unavailable-note">
          Gaia neighbour data is not yet cached for ${escapeHtml(target?.pl_name || "this target")}.
          Run <code>python tools/fetch_gaia_neighbours.py</code> to add it — this panel never fabricates a field.
        </p>
      </section>
    `;
  }

  return `
    <section class="deck-skymap-card" aria-label="Gaia sky map and neighbour analysis">
      <div class="deck-section-heading">
        <span>Sky map · ${escapeHtml(entry.release || "Gaia DR3")}</span>
        <strong>${entry.neighbourCount ?? 0} sources within ${entry.searchRadiusArcsec ?? 100}&Prime;</strong>
      </div>
      <div class="deck-skymap-body">
        <div class="skymap-field">${renderStarField(entry)}</div>
        <div class="skymap-analysis">${renderNeighbourTable(entry)}</div>
      </div>
      <p class="skymap-footnote">
        Contamination band is a quick-look heuristic (flux ratio versus separation), not a formal blend probability.
        Retrieved ${escapeHtml(entry.retrievedUtc || "—")}.
      </p>
    </section>
  `;
}
