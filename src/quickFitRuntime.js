/* ============================================================================
   ExoIntel-Prime — Quick-look transit refit
   Author: Biswajit Jana

   Estimates depth, transit centre and approximate duration from the selected
   local light curve, updates the existing physical controls, and hands the
   result back to the worker model. This is a deterministic exploratory fit,
   not posterior inference or a formal parameter measurement.
   ============================================================================ */

const TARGET_URL = "./data/exoplanets.json";
const LIGHTCURVE_BASE = "./data/lightcurves/";
const TARGET_SEPARATOR = " · ";

let targets = [];
let button = null;
let statusNode = null;
let lastTargetName = "";

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function centredPhase(value) {
  const phase = finite(value);
  if (phase === null) return null;
  return phase >= 0 && phase <= 1 ? ((phase + 0.5) % 1) - 0.5 : phase;
}

function parseSeries(payload) {
  if (Array.isArray(payload?.phase) && Array.isArray(payload?.flux)) {
    return payload.phase.map((phase, index) => ({
      phase: centredPhase(phase),
      flux: finite(payload.flux[index])
    })).filter(sample => sample.phase !== null && sample.flux !== null);
  }

  if (Array.isArray(payload?.points)) {
    return payload.points.map(point => ({
      phase: centredPhase(point?.phase ?? point?.time),
      flux: finite(point?.flux)
    })).filter(sample => sample.phase !== null && sample.flux !== null);
  }

  return [];
}

function movingMedian(values, radius = 4) {
  return values.map((_, index) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(values.length, index + radius + 1);
    return median(values.slice(start, end));
  });
}

function estimateTransit(samples) {
  if (samples.length < 40) throw new Error("At least 40 finite light-curve samples are required.");
  const ordered = [...samples].sort((a, b) => a.phase - b.phase);
  const maxAbs = Math.max(...ordered.map(sample => Math.abs(sample.phase)));
  const outer = ordered.filter(sample => Math.abs(sample.phase) >= maxAbs * 0.62);
  const baseline = median((outer.length >= 16 ? outer : ordered).map(sample => sample.flux));
  if (!Number.isFinite(baseline) || baseline <= 0) throw new Error("A finite out-of-transit baseline could not be estimated.");

  const normalised = ordered.map(sample => ({ ...sample, flux: sample.flux / baseline }));
  const smoothedFlux = movingMedian(normalised.map(sample => sample.flux), Math.max(3, Math.floor(normalised.length / 180)));
  const minimum = Math.min(...smoothedFlux.filter(Number.isFinite));
  const depth = clamp(1 - minimum, 0.00001, 0.0625);
  const centreThreshold = 1 - depth * 0.32;
  const weights = normalised.map((sample, index) => Math.max(0, centreThreshold - smoothedFlux[index]));
  const weightSum = weights.reduce((sum, value) => sum + value, 0);
  const centre = weightSum > 0
    ? normalised.reduce((sum, sample, index) => sum + sample.phase * weights[index], 0) / weightSum
    : normalised[smoothedFlux.indexOf(minimum)].phase;

  const halfDepthLevel = 1 - depth * 0.5;
  const inTransit = normalised.filter((sample, index) => smoothedFlux[index] <= halfDepthLevel);
  const durationPhase = inTransit.length >= 2
    ? Math.max(...inTransit.map(sample => sample.phase)) - Math.min(...inTransit.map(sample => sample.phase))
    : null;

  return {
    baseline,
    depth,
    rpRs: Math.sqrt(depth),
    centre,
    durationPhase,
    points: normalised.length
  };
}

function modelDurationPhase(rpRs, aRs, inclinationDeg) {
  const inclination = inclinationDeg * Math.PI / 180;
  const sinI = Math.sin(inclination);
  const impact = aRs * Math.cos(inclination);
  const chordSquared = (1 + rpRs) ** 2 - impact ** 2;
  if (chordSquared <= 0 || sinI <= 0) return 0;
  const argument = clamp(Math.sqrt(chordSquared) / (aRs * sinI), 0, 1);
  return Math.asin(argument) / Math.PI;
}

function solveDurationGeometry(rpRs, durationPhase, currentA, currentI) {
  if (!Number.isFinite(durationPhase) || durationPhase <= 0 || durationPhase >= 0.25) {
    return { aRs: currentA, inclinationDeg: currentI };
  }

  let best = { score: Infinity, aRs: currentA, inclinationDeg: currentI };
  for (let aRs = 2.5; aRs <= 45; aRs += 0.25) {
    for (let inclination = 80; inclination <= 90; inclination += 0.10) {
      const predicted = modelDurationPhase(rpRs, aRs, inclination);
      if (predicted <= 0) continue;
      const durationError = Math.abs(predicted - durationPhase) / durationPhase;
      const prior = Math.abs(aRs - currentA) / 80 + Math.abs(inclination - currentI) / 50;
      const score = durationError + prior * 0.08;
      if (score < best.score) best = { score, aRs, inclinationDeg: inclination };
    }
  }

  return best;
}

function activeTargetLabel() {
  const label = document.getElementById("active-target-label")?.textContent?.trim() || "";
  const [planet, host] = label.split(TARGET_SEPARATOR);
  return { planet: planet?.trim() || label, host: host?.trim() || "" };
}

function findTarget() {
  const label = activeTargetLabel();
  const planet = label.planet.toLowerCase();
  const host = label.host.toLowerCase();
  return targets.find(target =>
    String(target.pl_name || "").toLowerCase() === planet &&
    (!host || String(target.hostname || "").toLowerCase() === host)
  ) || targets.find(target => String(target.pl_name || "").toLowerCase() === planet) || null;
}

function control(name) {
  return document.querySelector(`[data-param="${name}"]`);
}

function controlNumber(name, fallback) {
  const value = finite(control(name)?.value);
  return value === null ? fallback : value;
}

function setControl(name, value, digits = null) {
  const input = control(name);
  if (!input || !Number.isFinite(value)) return;
  const minimum = finite(input.min);
  const maximum = finite(input.max);
  const bounded = clamp(value, minimum ?? -Infinity, maximum ?? Infinity);
  input.value = digits === null ? String(bounded) : bounded.toFixed(digits);
  input.dispatchEvent(new Event(input.type === "checkbox" ? "change" : "input", { bubbles: true }));
}

function setStatus(message, tone = "info") {
  if (!statusNode) return;
  statusNode.textContent = message;
  statusNode.dataset.tone = tone;
}

async function runFit() {
  const target = findTarget();
  if (!target?.lightcurve_available || !target.lightcurve_file) {
    setStatus("Quick refit requires a local light curve for the selected target.", "warn");
    return;
  }

  button.disabled = true;
  setStatus("Estimating depth, centre and duration…", "working");

  try {
    const response = await fetch(`${LIGHTCURVE_BASE}${encodeURIComponent(target.lightcurve_file)}?fit=${Date.now()}`, {
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`Light curve returned HTTP ${response.status}.`);
    const payload = await response.json();
    const estimate = estimateTransit(parseSeries(payload));
    const currentA = controlNumber("aRs", finite(target.pl_ratdor) ?? 12);
    const currentI = controlNumber("inclinationDeg", finite(target.pl_orbincl) ?? 88.5);
    const geometry = solveDurationGeometry(estimate.rpRs, estimate.durationPhase, currentA, currentI);

    setControl("rpRs", estimate.rpRs, 3);
    setControl("phaseShift", clamp(estimate.centre, -0.05, 0.05), 4);
    setControl("aRs", geometry.aRs, 1);
    setControl("inclinationDeg", geometry.inclinationDeg, 2);

    const durationText = Number.isFinite(estimate.durationPhase)
      ? `${estimate.durationPhase.toFixed(4)} phase`
      : "duration unavailable";
    setStatus(
      `Quick refit applied: depth ${(estimate.depth * 100).toFixed(3)}%, centre ${estimate.centre >= 0 ? "+" : ""}${estimate.centre.toFixed(4)}, ${durationText}. Review Residuals before interpretation.`,
      "ok"
    );
  } catch (error) {
    console.warn("ExoIntel-Prime quick refit failed:", error);
    setStatus(error instanceof Error ? error.message : "Quick refit failed.", "warn");
  } finally {
    button.disabled = false;
  }
}

function mount() {
  const plotHeader = document.querySelector(".plot-card .card-header");
  if (!plotHeader || document.getElementById("quick-refit-button")) return false;

  const existingStatus = plotHeader.querySelector("span");
  const actions = document.createElement("div");
  actions.className = "plot-header-actions";
  if (existingStatus) actions.appendChild(existingStatus);

  button = document.createElement("button");
  button.id = "quick-refit-button";
  button.className = "button quick-refit-button";
  button.type = "button";
  button.textContent = "Refit model";
  button.title = "Estimate a quick-look transit depth, centre and duration from the selected local light curve.";
  button.addEventListener("click", runFit);
  actions.appendChild(button);
  plotHeader.appendChild(actions);

  statusNode = document.createElement("div");
  statusNode.id = "quick-refit-status";
  statusNode.className = "quick-refit-status";
  statusNode.textContent = "Quick-look refit available for local light curves; not a posterior fit.";
  const assumptionStrip = document.getElementById("assumption-strip");
  assumptionStrip?.parentElement?.insertBefore(statusNode, assumptionStrip);
  return true;
}

async function loadTargets() {
  try {
    const response = await fetch(`${TARGET_URL}?fit-cache=1`, { cache: "no-store" });
    const payload = await response.json();
    targets = Array.isArray(payload) ? payload : Array.isArray(payload.targets) ? payload.targets : [];
  } catch (error) {
    targets = [];
    console.warn("Quick refit target cache unavailable:", error);
  }
}

function watchTarget() {
  const observer = new MutationObserver(() => {
    const name = activeTargetLabel().planet;
    if (name && name !== lastTargetName) {
      lastTargetName = name;
      setStatus("Quick-look refit available for local light curves; not a posterior fit.");
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

async function boot() {
  await loadTargets();
  if (!mount()) {
    const observer = new MutationObserver(() => {
      if (mount()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  watchTarget();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
