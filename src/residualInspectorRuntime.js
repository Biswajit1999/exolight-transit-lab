import { renderResidualInspector } from "./ui/residualInspector.js";

const TARGET_CACHE_URL = "./data/exoplanets.json";
const TARGET_SEPARATOR = " · ";
let targets = [];
let mounted = false;
let lastSignature = "";

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
  return {
    target,
    params: readParamsFromControls(),
    metrics: readMetricsFromDom(),
    archivalCurve: readArchivalState(target),
    residualSamples: []
  };
}

function reserveResidualSpace(mainPanel) {
  const compact = window.matchMedia("(max-width: 1180px)").matches;
  const hasDeck = Boolean(document.getElementById("observatory-deck-shell"));
  const hasMission = Boolean(document.getElementById("mission-control-shell"));
  mainPanel.classList.add("residual-inspector-mounted");

  if (hasDeck && hasMission) {
    mainPanel.style.gridTemplateRows = compact
      ? "minmax(320px, auto) 420px minmax(220px, auto) minmax(190px, auto) 320px"
      : "minmax(250px, auto) minmax(255px, 1fr) minmax(210px, auto) minmax(175px, auto) 300px";
    return;
  }

  if (hasDeck) {
    mainPanel.style.gridTemplateRows = compact
      ? "minmax(320px, auto) 420px minmax(190px, auto) 320px"
      : "minmax(250px, auto) minmax(255px, 1fr) minmax(175px, auto) 300px";
    return;
  }

  mainPanel.style.gridTemplateRows = compact
    ? "420px minmax(190px, auto) 320px"
    : "minmax(255px, 1fr) minmax(175px, auto) 300px";
}

function ensureContainer() {
  const mainPanel = document.querySelector(".main-panel");
  const plotCard = document.querySelector(".plot-card");
  if (!mainPanel || !plotCard) return null;

  reserveResidualSpace(mainPanel);

  let shell = document.getElementById("residual-inspector-shell");
  if (!shell) {
    shell = document.createElement("section");
    shell.className = "card residual-inspector-shell";
    shell.id = "residual-inspector-shell";
    shell.innerHTML = `<div id="residual-inspector" aria-live="polite"></div>`;
    mainPanel.insertBefore(shell, plotCard);
  }

  return document.getElementById("residual-inspector");
}

function updateResidualInspector() {
  const container = ensureContainer();
  if (!container) return;

  const state = buildState();
  const signature = JSON.stringify({
    target: state.target?.pl_name,
    host: state.target?.hostname,
    params: state.params,
    metrics: state.metrics,
    points: state.archivalCurve?.points
  });

  if (signature === lastSignature) return;
  lastSignature = signature;
  renderResidualInspector(container, state);
}

async function loadTargets() {
  try {
    const response = await fetch(`${TARGET_CACHE_URL}?v=${Date.now()}`, { cache: "no-store", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    targets = Array.isArray(payload) ? payload : Array.isArray(payload.targets) ? payload.targets : [];
  } catch (error) {
    targets = [];
    console.warn("Residual Intelligence target cache unavailable:", error);
  }
}

function watchDashboard() {
  const observer = new MutationObserver(() => window.requestAnimationFrame(updateResidualInspector));
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
  window.addEventListener("resize", () => {
    const mainPanel = document.querySelector(".main-panel");
    if (mainPanel) reserveResidualSpace(mainPanel);
    updateResidualInspector();
  });
  window.setInterval(updateResidualInspector, 1500);
}

async function bootResidualInspector() {
  if (mounted) return;
  mounted = true;
  await loadTargets();
  updateResidualInspector();
  watchDashboard();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootResidualInspector, { once: true });
} else {
  bootResidualInspector();
}
