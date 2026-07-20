import { renderResidualInspector } from "./ui/residualInspector.js";

const TARGET_CACHE_URL = "./data/exoplanets.json";
const LIGHTCURVE_BASE_URL = "./data/lightcurves/";
const TARGET_SEPARATOR = " · ";
let targets = [];
let mounted = false;
let lastSignature = "";
let lightcurveCache = new Map();
let activeResidualSamples = [];
let activeLightcurveFile = "";

function isActiveTab() {
  return document.body.dataset.exolightTab === "residuals";
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

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function readActiveTargetLabel() {
  const label = byId("active-target-label")?.textContent?.trim() || "";
  if (!label || label === "no target") return { pl_name: "Unknown target", hostname: "Unknown host" };
  const [planet, host] = label.split(TARGET_SEPARATOR);
  return { pl_name: planet?.trim() || label, hostname: host?.trim() || "Unknown host" };
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
    phaseShift: controlValue("phaseShift") || 0,
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

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-9, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function smoothTransitModel(phase, target, params, metrics) {
  const shifted = Number(phase) - finite(params.phaseShift, 0);
  const depth = Math.max(0, finite(metrics.modelDepthPpm, finite(target.pl_trandep, 10000)) / 1e6);
  const durationPhase = finite(target.duration_phase, null)
    ?? (finite(target.pl_trandur, null) && finite(target.pl_orbper, null) ? finite(target.pl_trandur) / (finite(target.pl_orbper) * 24) : 0.025);
  const half = Math.max(0.002, durationPhase / 2);
  const ingress = Math.max(0.0012, half * 0.22);
  const distance = Math.abs(shifted);
  const core = 1 - smoothstep(half - ingress, half, distance);
  return 1 - depth * core;
}

function normaliseLightcurvePayload(payload) {
  const phase = Array.isArray(payload?.phase) ? payload.phase : [];
  const flux = Array.isArray(payload?.flux) ? payload.flux : Array.isArray(payload?.relative_flux) ? payload.relative_flux : [];
  const n = Math.min(phase.length, flux.length);
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const p = finite(phase[i], null);
    const f = finite(flux[i], null);
    if (p === null || f === null) continue;
    rows.push({ phase: p, flux: f });
  }
  return rows;
}

async function loadLightcurveRows(file) {
  if (!file) return [];
  if (lightcurveCache.has(file)) return lightcurveCache.get(file);
  try {
    const response = await fetch(`${LIGHTCURVE_BASE_URL}${file}?v=20260720-residuals-v02`, { cache: "force-cache", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const rows = normaliseLightcurvePayload(payload);
    lightcurveCache.set(file, rows);
    return rows;
  } catch (error) {
    console.warn("Residual light curve unavailable:", file, error);
    lightcurveCache.set(file, []);
    return [];
  }
}

function buildResidualSamples(rows, target, params, metrics) {
  return rows.map(row => {
    const model = smoothTransitModel(row.phase, target, params, metrics);
    return { phase: row.phase, flux: row.flux, modelFlux: model, residualPpm: (row.flux - model) * 1e6 };
  }).filter(sample => Number.isFinite(sample.residualPpm));
}

async function refreshResidualSamples(target, params, metrics) {
  const file = target?.lightcurve_file || "";
  if (!file || !target?.lightcurve_available) {
    activeLightcurveFile = "";
    activeResidualSamples = [];
    return;
  }
  if (file === activeLightcurveFile && activeResidualSamples.length) return;
  activeLightcurveFile = file;
  const rows = await loadLightcurveRows(file);
  activeResidualSamples = buildResidualSamples(rows, target, params, metrics);
}

function buildState() {
  const labelTarget = readActiveTargetLabel();
  const cachedTarget = matchTargetFromCache(labelTarget);
  const target = { ...labelTarget, ...(cachedTarget || {}) };
  const params = readParamsFromControls();
  const metrics = readMetricsFromDom();
  return { target, params, metrics, archivalCurve: readArchivalState(target), residualSamples: activeResidualSamples };
}

function reserveResidualSpace(mainPanel) {
  if (!isActiveTab()) return;
  mainPanel.classList.add("residual-inspector-mounted");
  mainPanel.style.gridTemplateRows = "minmax(0, 1fr)";
}

function ensureContainer() {
  if (!isActiveTab()) return null;
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

async function updateResidualInspector() {
  if (!isActiveTab()) return;
  const container = ensureContainer();
  if (!container) return;
  let state = buildState();
  await refreshResidualSamples(state.target, state.params, state.metrics);
  state = buildState();
  const signature = JSON.stringify({ target: state.target?.pl_name, host: state.target?.hostname, params: state.params, metrics: state.metrics, points: state.archivalCurve?.points, residuals: state.residualSamples.length });
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
  const observer = new MutationObserver(() => { if (isActiveTab()) window.requestAnimationFrame(updateResidualInspector); });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
  window.addEventListener("resize", () => {
    if (!isActiveTab()) return;
    const mainPanel = document.querySelector(".main-panel");
    if (mainPanel) reserveResidualSpace(mainPanel);
    updateResidualInspector();
  });
  window.addEventListener("exolight:tab-change", updateResidualInspector);
  window.setInterval(() => { if (isActiveTab()) updateResidualInspector(); }, 1500);
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
