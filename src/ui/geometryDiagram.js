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

function format(value, digits = 2, fallback = "—") {
  const number = finite(value);
  return number === null ? fallback : number.toLocaleString("en-GB", { maximumFractionDigits: digits });
}

function impactParameter(params) {
  const aRs = finite(params?.aRs);
  const inclination = finite(params?.inclinationDeg);
  if (aRs === null || inclination === null) return null;
  return Math.abs(aRs * Math.cos(inclination * Math.PI / 180));
}

export function buildGeometryState({ target, params }) {
  const b = impactParameter(params);
  const rpRs = finite(params?.rpRs) ?? finite(target?.pl_ratror) ?? 0.1;
  const inclination = finite(params?.inclinationDeg) ?? finite(target?.pl_orbincl);
  const aRs = finite(params?.aRs);
  const chordY = b === null ? 0 : clamp(b, 0, 1.15);
  const chordVisible = b !== null && b <= 1 + rpRs;

  return {
    impact: b,
    rpRs,
    inclination,
    aRs,
    chordY,
    chordVisible,
    grazing: b !== null && b > Math.max(0, 1 - rpRs) && b <= 1 + rpRs,
    missing: b === null
  };
}

export function renderGeometryDiagram(state) {
  const geometry = buildGeometryState(state);
  const y = 100 + geometry.chordY * 74;
  const planetRadius = clamp(geometry.rpRs * 72, 5, 19);
  const chordOpacity = geometry.chordVisible ? 1 : 0.28;
  const classification = geometry.missing
    ? "geometry unavailable"
    : geometry.chordVisible
      ? geometry.grazing ? "grazing / near-limb transit" : "full chord transit"
      : "non-transiting geometry";

  return `
    <section class="deck-geometry" aria-label="Transit geometry diagram">
      <div class="deck-section-heading">
        <span>Geometry</span>
        <strong>${escapeHtml(classification)}</strong>
      </div>
      <svg class="deck-geometry-svg" viewBox="0 0 320 210" role="img" aria-label="Simplified star, planet chord, and observer line of sight">
        <defs>
          <radialGradient id="deckStarGlow" cx="45%" cy="42%" r="62%">
            <stop offset="0%" stop-color="#ffe0a3" />
            <stop offset="52%" stop-color="#ffb547" />
            <stop offset="100%" stop-color="#7a3411" />
          </radialGradient>
          <filter id="deckSoftGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect x="1" y="1" width="318" height="208" rx="22" class="deck-geometry-bg" />
        <line x1="30" y1="105" x2="290" y2="105" class="deck-sight-line" />
        <text x="33" y="94" class="deck-geometry-label">observer line</text>
        <circle cx="160" cy="105" r="70" fill="url(#deckStarGlow)" filter="url(#deckSoftGlow)" />
        <circle cx="160" cy="105" r="70" class="deck-star-edge" />
        <line x1="55" y1="${y}" x2="265" y2="${y}" class="deck-chord" style="opacity:${chordOpacity}" />
        <circle cx="82" cy="${y}" r="${planetRadius}" class="deck-planet" />
        <circle cx="238" cy="${y}" r="${planetRadius}" class="deck-planet ghost" />
        <path d="M248 22 C278 55, 286 116, 252 179" class="deck-orbit-arc" />
        <text x="214" y="35" class="deck-geometry-label">projected orbit</text>
      </svg>
      <div class="deck-geometry-stats">
        <span><strong>b</strong>${format(geometry.impact, 3)}</span>
        <span><strong>i</strong>${format(geometry.inclination, 2)}°</span>
        <span><strong>a/R★</strong>${format(geometry.aRs, 2)}</span>
        <span><strong>Rp/R★</strong>${format(geometry.rpRs, 4)}</span>
      </div>
    </section>
  `;
}
