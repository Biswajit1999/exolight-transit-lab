import { renderMissionControl } from "./ui/missionControl.js";

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
    archivalCurve: readArchivalState(target)
  };
}

function ensureContainer() {
  const mainPanel = document.querySelector(".main-panel");
  const plotCard = document.querySelector(".plot-card");
  if (!mainPanel || !plotCard) return null;

  let shell = document.getElementById("mission-control-shell");
  if (!shell) {
    shell = document.createElement("section");
    shell.className = "card mission-control-shell";
    shell.id = "mission-control-shell";
    shell.innerHTML = `<div id="mission-control" aria-live="polite"></div>`;
    mainPanel.insertBefore(shell, plotCard);
  }

  return document.getElementById("mission-control");
}

function updateMissionControl() {
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
  renderMissionControl(container, state);
}

async function loadTargets() {
  try {
    const response = await fetch(`${TARGET_CACHE_URL}?v=${Date.now()}`, { cache: "no-store", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    targets = Array.isArray(payload) ? payload : Array.isArray(payload.targets) ? payload.targets : [];
  } catch (error) {
    targets = [];
    console.warn("Mission Control target cache unavailable:", error);
  }
}

function watchDashboard() {
  const observer = new MutationObserver(() => window.requestAnimationFrame(updateMissionControl));
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
  window.addEventListener("resize", updateMissionControl);
  window.setInterval(updateMissionControl, 1500);
}

async function bootMissionControl() {
  if (mounted) return;
  mounted = true;
  await loadTargets();
  updateMissionControl();
  watchDashboard();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootMissionControl, { once: true });
} else {
  bootMissionControl();
}
