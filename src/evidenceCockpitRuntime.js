import { renderEvidenceCockpit } from "./ui/evidenceCockpit.js";

const TARGET_CACHE_URL = "./data/exoplanets.json";
const DATASET_MANIFEST_BASE_URL = "./data/provenance/";
const TARGET_SEPARATOR = " · ";
let targets = [];
let mounted = false;
let lastSignature = "";
const manifestCache = new Map();

function isActiveTab() {
  return document.body.dataset.exolightTab === "evidence";
}

function byId(id) {
  return document.getElementById(id);
}

function numberFromText(text) {
  const clean = String(text ?? "").replace(/,/g, "");
  const match = clean.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/i);
  return match ? Number(match[0]) : null;
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

function manifestFilename(target) {
  const lightcurveFile = String(target?.lightcurve_file || "").trim();
  if (!target?.lightcurve_available || !lightcurveFile) return null;
  const basename = lightcurveFile.split("/").pop();
  return basename.replace(/\.json$/i, "") + ".manifest.json";
}

async function loadDatasetManifest(target) {
  const filename = manifestFilename(target);
  if (!filename) return null;
  if (manifestCache.has(filename)) return manifestCache.get(filename);

  const request = fetch(`${DATASET_MANIFEST_BASE_URL}${encodeURIComponent(filename)}?v=${Date.now()}`, {
    cache: "no-store",
    headers: { Accept: "application/json" }
  }).then(async response => {
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }).catch(error => {
    console.warn(`Evidence Cockpit provenance manifest unavailable for ${target?.pl_name || filename}:`, error);
    return null;
  });

  manifestCache.set(filename, request);
  return request;
}

function ensureContainer() {
  if (!isActiveTab()) return null;
  const mainPanel = document.querySelector(".main-panel");
  const plotCard = document.querySelector(".plot-card");
  if (!mainPanel || !plotCard) return null;
  mainPanel.style.gridTemplateRows = "minmax(0, 1fr)";

  let shell = byId("evidence-cockpit-shell");
  if (!shell) {
    shell = document.createElement("section");
    shell.className = "card evidence-cockpit-shell";
    shell.id = "evidence-cockpit-shell";
    shell.innerHTML = `<div id="evidence-cockpit" aria-live="polite"></div>`;
    mainPanel.insertBefore(shell, plotCard);
  }

  return byId("evidence-cockpit");
}

async function updateEvidenceCockpit() {
  if (!isActiveTab()) return;
  const container = ensureContainer();
  if (!container) return;

  const state = buildState();
  state.datasetManifest = await loadDatasetManifest(state.target);

  const signature = JSON.stringify({
    target: state.target?.pl_name,
    host: state.target?.hostname,
    params: state.params,
    metrics: state.metrics,
    points: state.archivalCurve?.points,
    manifest: state.datasetManifest
      ? [state.datasetManifest.schemaVersion, state.datasetManifest.upstream?.archive, state.datasetManifest.upstream?.productId]
      : null
  });

  if (signature === lastSignature) return;
  lastSignature = signature;
  renderEvidenceCockpit(container, state);
}

async function loadTargets() {
  try {
    const response = await fetch(`${TARGET_CACHE_URL}?v=${Date.now()}`, { cache: "no-store", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    targets = Array.isArray(payload) ? payload : Array.isArray(payload.targets) ? payload.targets : [];
  } catch (error) {
    targets = [];
    console.warn("Evidence Cockpit target cache unavailable:", error);
  }
}

function watchDashboard() {
  const observer = new MutationObserver(() => {
    if (isActiveTab()) window.requestAnimationFrame(() => { void updateEvidenceCockpit(); });
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
  window.addEventListener("resize", () => { void updateEvidenceCockpit(); });
  window.addEventListener("exolight:tab-change", () => { void updateEvidenceCockpit(); });
  window.setInterval(() => { if (isActiveTab()) void updateEvidenceCockpit(); }, 1500);
}

async function bootEvidenceCockpit() {
  if (mounted) return;
  mounted = true;
  await loadTargets();
  await updateEvidenceCockpit();
  watchDashboard();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootEvidenceCockpit, { once: true });
} else {
  void bootEvidenceCockpit();
}
