import { buildTargetAudit } from "./intelligence/targetAudit.js";
import { renderVisualMeters } from "./ui/visualMeters.js";
import { renderGeometryDiagram } from "./ui/geometryDiagram.js";
import { renderSkyMap } from "./ui/skyMap.js";
import { getNeighboursForTarget } from "./data/gaiaNeighbours.js";

const TARGET_CACHE_URL = "./data/exoplanets.json";
const TARGET_SEPARATOR = " · ";
let targets = [];
let mounted = false;
let lastSignature = "";
let lastSkyMapTarget = "";

function isActiveTab() {
  return document.body.dataset.exolightTab === "observatory";
}

function numberFromText(text) {
  const clean = String(text ?? "").replace(/,/g, "");
  const match = clean.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/i);
  return match ? Number(match[0]) : null;
}

function byId(id) {
  return document.getElementById(id);
}

function controlValue(param) {
  const input = document.querySelector(`[data-param="${param}"]`);
  if (!input) return null;
  if (input.type === "checkbox") return input.checked;
  const value = Number(input.value);
  return Number.isFinite(value) ? value : input.value;
}

function readActiveTargetLabel() {
  const label = byId("active-target-label")?.textContent?.trim() || "";
  if (!label || label === "no target") return { pl_name: "Unknown target", hostname: "Unknown host" };
  const [planet, host] = label.split(TARGET_SEPARATOR);
  return {
    pl_name: planet?.trim() || label,
    hostname: host?.trim() || "Unknown host"
  };
}

function matchTargetFromCache(labelTarget) {
  const planet = String(labelTarget.pl_name || "").toLowerCase();
  const host = String(labelTarget.hostname || "").toLowerCase();
  return targets.find(target =>
    String(target.pl_name || "").toLowerCase() === planet &&
    String(target.hostname || "").toLowerCase() === host
  ) || targets.find(target => String(target.pl_name || "").toLowerCase() === planet) || null;
}

function readParamsFromControls() {
  return {
    rpRs: controlValue("rpRs"),
    aRs: controlValue("aRs"),
    inclinationDeg: controlValue("inclinationDeg"),
    eccentricity: numberFromText(byId("eccentricity-display-value")?.textContent),
    u1: controlValue("u1"),
    u2: controlValue("u2"),
    spotEnabled: Boolean(controlValue("spotEnabled")),
    moonEnabled: Boolean(controlValue("moonEnabled")),
    exposureIntegration: true,
    exposureSamples: 5
  };
}

function readMetricsFromDom() {
  const depthSecondary = byId("metric-depth-secondary")?.textContent || "";
  const depthPrimary = byId("metric-depth-percent")?.textContent || "";
  const modelDepthPpm = depthSecondary.toLowerCase().includes("ppm")
    ? numberFromText(depthSecondary)
    : depthPrimary.includes("%")
      ? numberFromText(depthPrimary) * 10000
      : null;

  return {
    modelDepthPpm,
    residualRmsPpm: numberFromText(byId("metric-residual-rms")?.textContent),
    ootRmsPpm: numberFromText(byId("metric-oot-rms")?.textContent),
    snr: numberFromText(byId("metric-snr")?.textContent)
  };
}

function readArchivalState(target) {
  const plotStatus = byId("plot-status")?.textContent || "";
  const pointMatch = plotStatus.replace(/,/g, "").match(/(\d+)\s+phase samples/i);
  return {
    points: pointMatch ? Number(pointMatch[1]) : target?.lightcurve_available ? 1 : 0,
    source: target?.lightcurve_available ? target.lightcurve_file || "local archive" : "model only"
  };
}

function buildState() {
  const labelTarget = readActiveTargetLabel();
  const cachedTarget = matchTargetFromCache(labelTarget);
  const target = { ...labelTarget, ...(cachedTarget || {}) };
  const params = readParamsFromControls();
  const metrics = readMetricsFromDom();
  const archivalCurve = readArchivalState(target);
  const audit = buildTargetAudit({ target, params, metrics, archivalCurve });

  return { target, params, metrics, archivalCurve, audit };
}

function ensureDeck() {
  if (!isActiveTab()) return null;
  const workspace = document.querySelector(".workspace");
  const mainPanel = document.querySelector(".main-panel");
  const scenePanel = document.querySelector(".scene-panel");
  if (!workspace || !mainPanel || !scenePanel) return null;

  document.body.classList.add("observatory-deck-active");
  workspace.classList.add("observatory-workspace");
  mainPanel.classList.add("observatory-main-panel");
  mainPanel.style.gridTemplateRows = "minmax(0, 1fr)";

  let shell = document.getElementById("observatory-deck-shell");
  if (!shell) {
    shell = document.createElement("section");
    shell.id = "observatory-deck-shell";
    shell.className = "card observatory-deck-shell";
    shell.innerHTML = `
      <div class="deck-topline">
        <div>
          <p>ExoLight Observatory Deck</p>
          <h2 id="deck-target-title">Target loading</h2>
        </div>
        <div class="deck-mode-strip" aria-label="Current observing mode">
          <span id="deck-data-mode">data mode</span>
          <span id="deck-model-mode">model mode</span>
          <span id="deck-hypothesis-mode">hypothesis state</span>
        </div>
      </div>
      <div id="deck-visual-meters"></div>
      <div id="deck-geometry-slot"></div>
      <div id="deck-skymap-slot"></div>
    `;
    mainPanel.insertBefore(shell, scenePanel);
  }

  return shell;
}

function renderDeck() {
  if (!isActiveTab()) return;
  const shell = ensureDeck();
  if (!shell) return;

  const state = buildState();
  const signature = JSON.stringify({
    target: state.target?.pl_name,
    host: state.target?.hostname,
    params: state.params,
    metrics: state.metrics,
    points: state.archivalCurve?.points,
    score: state.audit?.audit?.total
  });
  if (signature === lastSignature) return;
  lastSignature = signature;

  byId("deck-target-title").textContent = `${state.target?.pl_name || "Unknown target"} · ${state.target?.hostname || "Unknown host"}`;
  byId("deck-data-mode").textContent = state.target?.lightcurve_available ? "local photometry" : "model-only target";
  byId("deck-model-mode").textContent = Number(state.params?.eccentricity) > 0 ? "eccentric geometry" : "circular baseline";
  byId("deck-hypothesis-mode").textContent = state.params?.spotEnabled || state.params?.moonEnabled ? "hypothesis active" : "baseline model";

  const meterSlot = byId("deck-visual-meters");
  const geometrySlot = byId("deck-geometry-slot");
  if (meterSlot) meterSlot.innerHTML = renderVisualMeters(state);
  if (geometrySlot) geometrySlot.innerHTML = renderGeometryDiagram(state);

  const targetKey = `${state.target?.pl_name || ""}::${state.target?.hostname || ""}`;
  if (targetKey !== lastSkyMapTarget) {
    lastSkyMapTarget = targetKey;
    const skyMapSlot = byId("deck-skymap-slot");
    if (skyMapSlot) skyMapSlot.innerHTML = `<section class="deck-skymap-card loading" aria-label="Gaia sky map"><p class="skymap-unavailable-note">Loading Gaia DR3 field…</p></section>`;
    getNeighboursForTarget(state.target).then(entry => {
      if (targetKey !== lastSkyMapTarget) return; // target changed again before this resolved
      const slot = byId("deck-skymap-slot");
      if (slot) slot.innerHTML = renderSkyMap(entry, state.target);
    });
  }
}

async function loadTargets() {
  try {
    const response = await fetch(`${TARGET_CACHE_URL}?v=${Date.now()}`, { cache: "no-store", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    targets = Array.isArray(payload) ? payload : Array.isArray(payload.targets) ? payload.targets : [];
  } catch (error) {
    targets = [];
    console.warn("Observatory Deck target cache unavailable:", error);
  }
}

function watchDashboard() {
  const observer = new MutationObserver(() => {
    if (isActiveTab()) window.requestAnimationFrame(renderDeck);
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
  window.addEventListener("resize", renderDeck);
  window.addEventListener("exolight:tab-change", renderDeck);
  window.setInterval(() => { if (isActiveTab()) renderDeck(); }, 1500);
}

async function bootObservatoryDeck() {
  if (mounted) return;
  mounted = true;
  await loadTargets();
  renderDeck();
  watchDashboard();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootObservatoryDeck, { once: true });
} else {
  bootObservatoryDeck();
}
