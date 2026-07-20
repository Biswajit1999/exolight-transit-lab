import { ExoSceneRenderer } from "./scene.js?v=20260519-magnetic-v18";
import { buildTargetAudit } from "./intelligence/targetAudit.js";
import { qualityBars } from "./intelligence/auditScore.js";
import { diagnosticGauge, scoreTone } from "./ui/gauge.js";

/* ============================================================================
   ExoIntel-Prime Main Thread Orchestrator - Physics Visibility v11
   ============================================================================ */

const APP_NAME = "ExoIntel-Prime";
const WORKER_URL = new URL("./transitWorker.js?v=20260519-magnetic-v18", import.meta.url);
const TARGET_CACHE_URL = "./data/exoplanets.json";
const LIGHTCURVE_BASE_URL = "./data/lightcurves/";
const THEME_STORAGE_KEY = "exointel-prime-theme-v5";

const DEFAULT_PARAMS = Object.freeze({
  rpRs: 0.1,
  aRs: 12.0,
  inclinationDeg: 88.5,
  eccentricity: 0.0,
  omegaDeg: 90.0,
  u1: 0.32,
  u2: 0.28,
  spotEnabled: false,
  spotX: 0.2,
  spotY: 0.1,
  spotRadius: 0.12,
  spotContrast: 0.55,
  moonEnabled: false,
  moonRadius: 0.025,
  moonDistance: 0.55,
  moonPhaseDeg: 45,
  phaseShift: 0.0,
  exposureIntegration: true,
  exposureSamples: 5,
  exposurePhaseWidth: 0,
  visualQuality: "balanced",
  modelResolution: 720,
  fidelity: "preview"
});

const DEFAULT_TARGET = Object.freeze({
  id: "synthetic-hot-jupiter",
  pl_name: "Synthetic Hot Jupiter",
  hostname: "Demonstration Host",
  discoverymethod: "Transit",
  disc_year: null,
  pl_orbper: 3.0,
  pl_orblper: 90.0,
  pl_trandur: 2.4,
  pl_trandep: 10000,
  pl_ratror: 0.1,
  pl_orbsmax: null,
  pl_orbincl: 88.5,
  pl_orbeccen: 0.0,
  pl_bmassj: null,
  pl_bmasse: null,
  pl_radj: null,
  pl_rade: null,
  st_teff: 5772,
  st_rad: 1.0,
  st_mass: 1.0,
  st_logg: null,
  st_met: null,
  sy_snum: null,
  sy_pnum: null,
  lightcurve_available: false,
  lightcurve_file: ""
});

const HELP_TEXT = Object.freeze({
  ppm: "ppm means parts per million. 10,000 ppm equals a 1% brightness dip. Researchers use ppm because transit signals are often very small.",
  brightnessDip: "Brightness dip is the fractional loss of stellar light during transit. Example: 2.8% equals 28,000 ppm.",
  rpRsProxy: "Approximate radius-ratio proxy from depth: Rp/R★ ≈ sqrt(depth). This is only exact for a uniform star without dilution.",
  residualRms: "Residual RMS is the typical difference between archival data points and the theoretical model. Lower usually means a closer visual fit.",
  ootRms: "OOT RMS means out-of-transit RMS. It estimates scatter when the planet is not passing in front of the star.",
  depthContrast: "Depth contrast is model depth divided by out-of-transit scatter. It is an intuitive quick-look metric, not a formal detection statistic.",
  moonSignal: "Moon signal is an optional hypothesis term. It does not claim a real exomoon.",
  spotBoost: "Spot boost is a starspot-crossing anomaly. If a planet crosses a darker stellar region, flux can temporarily rise relative to a spotless model.",
  visualQuality: "Visual quality changes only the CGI scene. It does not change the worker physics calculation.",
  jsonContribution: "To test your own light curve, fork the GitHub repository, add your JSON file under data/lightcurves/, update data/exoplanets.json, and deploy your fork.",
  eccentricity: "Eccentricity and argument of periastron are catalogue values. They are kept read-only to avoid unphysical manual combinations."
});

class ExoIntelPrimeApp {
  constructor() {
    this.root = document.getElementById("app") || document.body;
    this.worker = null;
    this.scene = null;
    this.currentRevision = 0;
    this.lastSentRevision = 0;
    this.pendingFrame = false;
    this.workerReady = false;
    this.targets = [];
    this.activeTarget = null;
    this.latestTarget = { ...DEFAULT_TARGET };
    this.latestParams = { ...DEFAULT_PARAMS };
    this.archivalCurve = { phase: new Float32Array(0), flux: new Float32Array(0), error: new Float32Array(0), source: "none", points: 0 };
    this.latestModel = { phase: new Float32Array(0), flux: new Float32Array(0), planetOnlyFlux: new Float32Array(0), hypothesisDeltaPpm: new Float32Array(0), revision: 0 };
    this.metrics = { residualRmsPpm: null, ootRmsPpm: null, snr: null, phaseShift: null, modelDepthPpm: null, maxPlanetDepthPpm: null, maxMoonDepthPpm: null, maxSpotBoostPpm: null, hypothesisMaxAbsPpm: null, hypothesisRmsPpm: null, hypothesisFlags: { text: ["Waiting for physics engine"] }, morphologyFlags: ["waiting for physics engine"] };
    this.timings = { elapsedMs: null, samples: null, rings: null, azimuth: null, surfaceSamples: null };
    this.theme = localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
    this.dom = {};
    this.controlMap = new Map();
    this.frameCounter = 0;
    this.fps = 0;
    this.lastFpsTime = performance.now();
  }

  async boot() {
    document.title = `${APP_NAME} | Transit Photometry Laboratory`;
    this.root.className = `exointel-app theme-${this.theme}`;
    this.root.innerHTML = this.html();
    this.cacheDom();
    this.bindUi();
    this.syncControlOutputs();
    this.initWorker();
    this.initScene();
    this.startTelemetryLoop();
    await this.loadTargetCache();
    await this.selectInitialTarget();
    this.issueParameterRevision("initial boot");
    this.draw();
  }

  html() {
    return `
      <header class="app-header">
        <section class="brand">${transitLogoSvg()}<div><h1>ExoIntel-Prime</h1><p>Interactive exoplanet transit modelling with archival photometry overlays</p></div></section>
        <section class="status-strip" aria-label="Application state">
          <div class="status-tile"><span>Physics engine</span><strong id="status-worker">initialising</strong></div>
          <div class="status-tile"><span>Model iteration</span><strong id="status-revision">0</strong></div>
          <div class="status-tile"><span>Transit solver</span><strong id="status-solver">idle</strong></div>
          <div class="status-tile"><span>Frame rate</span><strong id="status-fps">-- fps</strong></div>
        </section>
        <section class="header-actions">
          <label class="theme-switch" title="Toggle light and night mode"><input id="button-theme" type="checkbox" ${this.theme === "dark" ? "checked" : ""} aria-label="Toggle night mode" /><span class="theme-switch-track"><span class="theme-switch-thumb"></span></span><span id="theme-switch-label" class="theme-switch-label">${this.theme === "dark" ? "Night mode" : "Light mode"}</span></label>
          <button class="button" id="button-reset" type="button">Reset model</button>
          <button class="button primary" id="button-high-fidelity" type="button">High-accuracy model</button>
        </section>
      </header>
      <section class="workspace">
        <aside class="left-panel">
          <section class="card target-card"><div class="card-header"><h2>Target archive</h2><div class="header-inline"><span id="target-count">loading</span>${help("jsonContribution")}</div></div><div class="card-body target-body"><input id="target-search" class="target-search" type="search" placeholder="Search planet, host star, observed data..." /><div id="target-list" class="target-list"></div></div></section>
          <section class="card science-card"><div class="card-header"><h2>Scientific readout</h2><span id="active-target-label">no target</span></div><div class="science-scroll">
            <p class="section-title">Transit observables</p>
            <div class="readout-grid">
              <div class="readout wide"><span>Brightness dip ${help("brightnessDip")}</span><strong id="metric-depth-percent">—</strong><small id="metric-depth-secondary">model depth</small></div>
              <div class="readout"><span>Radius proxy ${help("rpRsProxy")}</span><strong id="metric-rprs-proxy">—</strong><small>sqrt(depth), approximate</small></div>
              <div class="readout"><span>Depth contrast ${help("depthContrast")}</span><strong id="metric-snr">—</strong><small>depth / baseline scatter</small></div>
              <div class="readout"><span>Residual RMS ${help("residualRms")}</span><strong id="metric-residual-rms">—</strong><small>data minus model</small></div>
              <div class="readout"><span>OOT RMS ${help("ootRms")}</span><strong id="metric-oot-rms">—</strong><small>out-of-transit scatter</small></div>
              <div class="readout"><span>Moon signal ${help("moonSignal")}</span><strong id="metric-moon">—</strong><small>hypothesis only</small></div>
              <div class="readout"><span>Spot boost ${help("spotBoost")}</span><strong id="metric-spot">—</strong><small>spot anomaly</small></div>
            </div>
            <p class="section-title">Hypothesis visibility</p><div id="hypothesis-flags" class="hypothesis-grid"></div>
            <p class="section-title">Planet parameters</p><div id="planet-properties" class="property-grid"></div>
            <p class="section-title">Host star parameters</p><div id="star-properties" class="property-grid"></div>
            <p class="section-title">Catalogue / provenance</p><div id="catalogue-properties" class="property-grid"></div>
          </div></section>
        </aside>
        <main class="main-panel">
          <section class="card scene-panel">
            <div class="card-header"><h2>CGI theoretical model viewport</h2><span id="scene-status">mounting renderer</span></div>
            <div id="scene-stat-row" class="scene-stat-row" aria-label="Target quick facts"></div>
            <div class="scene-stage-wrap">
              <div id="scene-stage" class="scene-stage"></div>
              <div id="scene-readiness-card" class="scene-readiness-card" aria-label="Target mission readiness"></div>
            </div>
          </section>
          <section class="card plot-card"><div class="card-header"><h2>Archival photometry versus theoretical model</h2><span id="plot-status">waiting for model</span></div><div class="plot-wrap"><canvas id="curve-canvas" class="plot-canvas"></canvas></div><div id="assumption-strip" class="assumption-strip"></div></section>
          <section class="card evidence-summary-card" id="evidence-summary-card" aria-label="Quick-look evidence summary"></section>
        </main>
        <aside class="right-panel">
          <section class="card control-card"><div class="card-header"><h2>Model controls</h2><span>live what-if physics</span></div><div class="control-list" id="control-list">
            <div class="control-group"><h3>Rendering</h3>${selectControl("visualQuality", "Visual quality", [["low", "Low"], ["balanced", "Balanced"], ["high", "High"], ["ultra", "Ultra"]], this.latestParams.visualQuality, "visualQuality")}</div>
            <div class="control-group"><h3>Planet and orbit</h3>${rangeControl("rpRs", "Radius ratio Rp/R★", 0.01, 0.25, 0.001, this.latestParams.rpRs, 3)}${rangeControl("aRs", "Scaled distance a/R★", 2, 60, 0.1, this.latestParams.aRs, 1)}${rangeControl("inclinationDeg", "Inclination", 75, 90, 0.01, this.latestParams.inclinationDeg, 2, "°")}${readonlyControl("eccentricity-display", "Catalogue eccentricity", "—", "eccentricity")}<div class="disabled-note">Eccentricity and ω are read from the catalogue and passed to the worker model when available.</div></div>
            <div class="control-group"><h3>Stellar atmosphere</h3>${rangeControl("u1", "Quadratic limb u1", 0, 1, 0.01, this.latestParams.u1, 2)}${rangeControl("u2", "Quadratic limb u2", 0, 1, 0.01, this.latestParams.u2, 2)}</div>
            <div class="control-group"><h3>Starspot morphology</h3>${toggleControl("spotEnabled", "Enable starspot", this.latestParams.spotEnabled)}${rangeControl("spotX", "Spot x-position", -0.9, 0.9, 0.01, this.latestParams.spotX, 2)}${rangeControl("spotY", "Spot y-position", -0.9, 0.9, 0.01, this.latestParams.spotY, 2)}${rangeControl("spotRadius", "Spot radius", 0.02, 0.3, 0.005, this.latestParams.spotRadius, 3)}${rangeControl("spotContrast", "Spot contrast", 0.05, 0.95, 0.01, this.latestParams.spotContrast, 2)}</div>
            <div class="control-group"><h3>Exomoon hypothesis</h3>${toggleControl("moonEnabled", "Enable exomoon", this.latestParams.moonEnabled)}${rangeControl("moonRadius", "Moon radius", 0.004, 0.08, 0.001, this.latestParams.moonRadius, 3)}${rangeControl("moonDistance", "Moon distance", 0.05, 2.5, 0.01, this.latestParams.moonDistance, 2)}${rangeControl("moonPhaseDeg", "Moon phase", 0, 360, 1, this.latestParams.moonPhaseDeg, 0, "°")}</div>
            <div class="control-group"><h3>Model alignment</h3>${rangeControl("phaseShift", "Phase shift", -0.05, 0.05, 0.0005, this.latestParams.phaseShift, 4)}</div>
          </div></section>
        </aside>
      </section>
      <footer class="app-footer"><span id="footer-utc" class="footer-utc">UTC --</span><span class="footer-credit"><strong>Biswajit Jana</strong> © 2026</span><span id="footer-message" class="footer-status">Initialising physics engine...</span></footer>
    `;
  }

  cacheDom() {
    const ids = ["status-worker","status-revision","status-solver","status-fps","footer-utc","footer-message","scene-stage","scene-status","scene-stat-row","scene-readiness-card","evidence-summary-card","target-search","target-list","target-count","active-target-label","metric-depth-percent","metric-depth-secondary","metric-rprs-proxy","metric-residual-rms","metric-oot-rms","metric-snr","metric-moon","metric-spot","hypothesis-flags","planet-properties","star-properties","catalogue-properties","assumption-strip","plot-status","curve-canvas","button-theme","button-reset","button-high-fidelity"];
    for (const id of ids) this.dom[toCamel(id)] = document.getElementById(id);
    this.dom.canvas = this.dom.curveCanvas;
    this.dom.ctx = this.dom.canvas.getContext("2d");
    document.querySelectorAll("[data-param]").forEach(input => this.controlMap.set(input.dataset.param, input));
    new ResizeObserver(() => this.draw()).observe(this.dom.canvas);
  }

  bindUi() {
    for (const [key, input] of this.controlMap) {
      const eventName = input.type === "checkbox" || input.tagName === "SELECT" ? "change" : "input";
      input.addEventListener(eventName, () => { this.syncParamsFromControls(); this.syncControlOutputs(); this.updateScene(); this.issueParameterRevision(`control:${key}`); });
    }
    this.dom.buttonTheme.addEventListener("change", () => this.toggleTheme());
    this.dom.buttonReset.addEventListener("click", () => { const q = this.latestParams.visualQuality || "balanced"; this.latestParams = { ...DEFAULT_PARAMS, visualQuality: q }; this.syncControlsFromParams(); this.syncControlOutputs(); this.updateSciencePanels(); this.updateScene(); this.issueParameterRevision("reset"); this.setFriendlyStatus("Model controls reset to default theoretical parameters."); });
    this.dom.buttonHighFidelity.addEventListener("click", () => { this.latestParams = { ...this.latestParams, fidelity: "full", modelResolution: 1440, exposureSamples: 9 }; this.setFriendlyStatus("High-accuracy model requested. The interface remains responsive while the physics engine recalculates."); this.issueParameterRevision("high-accuracy"); });
    this.dom.targetSearch.addEventListener("input", () => this.renderTargetList(this.dom.targetSearch.value));
  }

  toggleTheme() {
    this.theme = this.dom.buttonTheme.checked ? "dark" : "light";
    localStorage.setItem(THEME_STORAGE_KEY, this.theme);
    this.root.classList.toggle("theme-dark", this.theme === "dark");
    this.root.classList.toggle("theme-light", this.theme === "light");
    const label = document.getElementById("theme-switch-label");
    if (label) label.textContent = this.theme === "dark" ? "Night mode" : "Light mode";
    this.draw();
    this.setFriendlyStatus(`${this.theme === "dark" ? "Night" : "Light"} mode enabled.`);
  }

  initWorker() {
    try {
      this.worker = new Worker(WORKER_URL, { type: "module", name: "ExoIntelTransitWorker" });
    } catch (error) {
      this.setWorkerFailed(`Physics engine could not be constructed: ${error.message}`);
      return;
    }
    this.worker.addEventListener("message", event => this.handleWorkerMessage(event.data));
    this.worker.addEventListener("error", event => this.setWorkerFailed(`Physics engine error: ${event.message || "unknown error"}`));
    this.worker.addEventListener("messageerror", () => this.setWorkerFailed("Physics engine message could not be read."));
    this.postToWorker({ type: "configure", appName: APP_NAME, protocol: "latest-state-mailbox-v10" });
    this.setText(this.dom.statusWorker, "starting");
  }

  initScene() {
    this.scene = new ExoSceneRenderer({ container: this.dom.sceneStage, onStatus: m => this.setText(this.dom.sceneStatus, m), onWarning: m => this.setText(this.dom.sceneStatus, m) });
    this.scene.mount();
    this.updateScene();
  }

  updateScene() {
    this.scene?.updateState({ params: this.latestParams, target: this.latestTarget, model: this.latestModel });
  }

  handleWorkerMessage(message) {
    if (!message || typeof message !== "object") return;
    if (message.type === "ready") { this.workerReady = true; this.setText(this.dom.statusWorker, "ready"); this.setFriendlyStatus("Physics engine ready. Parameter changes update the theoretical model off the main thread."); this.sendWorkerDataContext(); this.issueParameterRevision("engine-ready"); return; }
    if (message.type === "data-ready") { this.setFriendlyStatus(`Archival light curve loaded into the physics engine: ${Number(message.points || 0).toLocaleString("en-GB")} samples.`); return; }
    if (message.type === "accepted") { this.setText(this.dom.statusSolver, `calculating model ${message.revision}`); return; }
    if (message.type === "obsolete") { if (message.revision >= this.lastSentRevision) this.setText(this.dom.statusSolver, "updating latest model"); return; }
    if (message.type === "progress") { if (message.revision === this.currentRevision) this.setText(this.dom.statusSolver, `calculating ${Math.round(message.progress * 100)}%`); return; }
    if (message.type === "result") { this.handleWorkerResult(message); return; }
    if (message.type === "warning") { this.setFriendlyStatus(message.message || "Physics engine warning."); return; }
    if (message.type === "error") { this.setText(this.dom.statusSolver, "engine error"); this.setFriendlyStatus(message.message || "Physics engine reported an error."); }
  }

  handleWorkerResult(message) {
    if (!Number.isFinite(message.revision) || message.revision < this.currentRevision) return;
    const phase = message.phaseBuffer instanceof ArrayBuffer ? new Float32Array(message.phaseBuffer) : new Float32Array(0);
    const flux = message.fluxBuffer instanceof ArrayBuffer ? new Float32Array(message.fluxBuffer) : new Float32Array(0);
    const planetOnlyFlux = message.planetOnlyFluxBuffer instanceof ArrayBuffer ? new Float32Array(message.planetOnlyFluxBuffer) : new Float32Array(0);
    const hypothesisDeltaPpm = message.hypothesisDeltaPpmBuffer instanceof ArrayBuffer ? new Float32Array(message.hypothesisDeltaPpmBuffer) : new Float32Array(0);
    this.latestModel = { phase, flux, planetOnlyFlux, hypothesisDeltaPpm, revision: message.revision };
    const m = message.metrics || {};
    this.metrics = { residualRmsPpm: finiteOrNull(m.residualRmsPpm), ootRmsPpm: finiteOrNull(m.ootRmsPpm), snr: finiteOrNull(m.snr), phaseShift: finiteOrNull(m.phaseShift), modelDepthPpm: finiteOrNull(m.modelDepthPpm), maxPlanetDepthPpm: finiteOrNull(m.maxPlanetDepthPpm), maxMoonDepthPpm: finiteOrNull(m.maxMoonDepthPpm), maxSpotBoostPpm: finiteOrNull(m.maxSpotBoostPpm), hypothesisMaxAbsPpm: finiteOrNull(m.hypothesisMaxAbsPpm), hypothesisRmsPpm: finiteOrNull(m.hypothesisRmsPpm), hypothesisFlags: m.hypothesisFlags || { text: [] }, morphologyFlags: Array.isArray(m.morphologyFlags) ? m.morphologyFlags : [] };
    const t = message.timings || {};
    this.timings = { elapsedMs: finiteOrNull(t.elapsedMs), samples: finiteOrNull(t.samples), rings: finiteOrNull(t.rings), azimuth: finiteOrNull(t.azimuth), surfaceSamples: finiteOrNull(t.surfaceSamples) };
    this.setText(this.dom.statusSolver, "model ready");
    this.setText(this.dom.statusRevision, String(message.revision));
    this.setText(this.dom.plotStatus, `${message.mode || "theoretical model"} · ${phase.length.toLocaleString("en-GB")} phase samples`);
    this.setFriendlyStatus("Theoretical model updated. Archival data remain fixed; only the model curve changed.");
    this.renderMetrics(); this.renderHypothesisFlags(); this.updateSciencePanels(); this.updateAssumptionStrip(); this.updateScene(); this.draw();
    this.renderSceneReadiness(); this.renderEvidenceSummary();
  }

  postToWorker(payload, transfer = []) {
    if (!this.worker) return;
    try { this.worker.postMessage(payload, transfer); } catch (error) { this.setWorkerFailed(`Message to physics engine failed: ${error.message}`); }
  }

  sendWorkerDataContext() {
    if (!this.workerReady) return;
    const phaseBuffer = this.archivalCurve.phase.slice().buffer;
    const fluxBuffer = this.archivalCurve.flux.slice().buffer;
    const errorBuffer = this.archivalCurve.error.slice().buffer;
    this.postToWorker({ type: "data", target: serialiseTarget(this.latestTarget), archival: { phaseBuffer, fluxBuffer, errorBuffer, points: this.archivalCurve.points, source: this.archivalCurve.source } }, [phaseBuffer, fluxBuffer, errorBuffer]);
  }

  issueParameterRevision(reason) {
    this.currentRevision += 1;
    this.latestParams = { ...this.latestParams, reason, issuedAt: performance.now() };
    this.setText(this.dom.statusRevision, String(this.currentRevision));
    if (!this.pendingFrame) { this.pendingFrame = true; requestAnimationFrame(() => { this.pendingFrame = false; this.flushLatestSnapshotToWorker(); }); }
  }

  flushLatestSnapshotToWorker() {
    if (!this.workerReady) { this.setText(this.dom.statusSolver, "waiting for engine"); return; }
    const revision = this.currentRevision;
    const snapshot = { ...this.latestParams, fidelity: this.latestParams.fidelity === "full" ? "full" : "preview" };
    this.lastSentRevision = revision;
    this.setText(this.dom.statusSolver, `queued model ${revision}`);
    this.postToWorker({ type: "solve", revision, target: serialiseTarget(this.latestTarget), params: snapshot });
  }

  syncParamsFromControls() {
    const next = { ...this.latestParams };
    for (const [key, input] of this.controlMap) {
      if (input.type === "checkbox") next[key] = input.checked;
      else if (input.tagName === "SELECT") next[key] = input.value;
      else next[key] = Number(input.value);
    }
    next.fidelity = "preview"; next.modelResolution = 720;
    next.eccentricity = clamp(numberValue(this.latestTarget.pl_orbeccen, 0), 0, 0.95);
    next.omegaDeg = normaliseDegrees(numberValue(this.latestTarget.pl_orblper, 90));
    this.latestParams = next;
  }

  syncControlsFromParams() { for (const [key, input] of this.controlMap) { const value = this.latestParams[key]; if (input.type === "checkbox") input.checked = Boolean(value); else if (input.tagName === "SELECT") input.value = String(value); else if (value !== undefined) input.value = String(value); } }

  syncControlOutputs() {
    const p = this.latestParams;
    this.output("rpRs", p.rpRs, 3); this.output("aRs", p.aRs, 1); this.output("inclinationDeg", `${formatNumber(p.inclinationDeg, 2)}°`); this.output("u1", p.u1, 2); this.output("u2", p.u2, 2);
    this.output("spotEnabled", p.spotEnabled ? "on" : "off"); this.output("spotX", p.spotX, 2); this.output("spotY", p.spotY, 2); this.output("spotRadius", p.spotRadius, 3); this.output("spotContrast", p.spotContrast, 2);
    this.output("moonEnabled", p.moonEnabled ? "on" : "off"); this.output("moonRadius", p.moonRadius, 3); this.output("moonDistance", p.moonDistance, 2); this.output("moonPhaseDeg", `${Math.round(p.moonPhaseDeg)}°`); this.output("phaseShift", p.phaseShift, 4);
    const eccNode = document.getElementById("eccentricity-display-value"); if (eccNode) eccNode.textContent = formatMaybe(this.latestTarget.pl_orbeccen, 3);
  }
  output(key, value, digits = null) { const node = document.getElementById(`out-${key}`); if (!node) return; node.textContent = typeof value === "number" && digits !== null ? formatNumber(value, digits) : String(value); }

  async loadTargetCache() {
    try {
      const response = await fetch(`${TARGET_CACHE_URL}?v=${Date.now()}`, { cache: "no-store", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const rows = Array.isArray(payload) ? payload : Array.isArray(payload.targets) ? payload.targets : [];
      this.targets = rows.map(normaliseTarget).filter(Boolean);
      if (!this.targets.length) this.targets = [normaliseTarget(DEFAULT_TARGET)];
      this.renderTargetList("");
    } catch (error) {
      this.targets = [normaliseTarget(DEFAULT_TARGET)]; this.renderTargetList(""); this.setFriendlyStatus(`Target cache fallback active: ${error.message}`);
    }
  }

  renderTargetList(query) {
    const clean = String(query || "").trim().toLowerCase();
    const filtered = this.targets.filter(target => { if (!clean) return true; const hay = [target.pl_name, target.hostname, target.discoverymethod, target.lightcurve_available ? "observed photometry real lightcurve lc data" : "model only", target.lightcurve_file].join(" ").toLowerCase(); return clean.split(/\s+/).every(token => hay.includes(token)); }).slice(0, 120);
    this.setText(this.dom.targetCount, `${filtered.length}/${this.targets.length}`);
    const frag = document.createDocumentFragment();
    for (const target of filtered) {
      const b = document.createElement("button"); b.type = "button"; b.className = "target-row"; if (this.activeTarget?.id === target.id) b.classList.add("active");
      const text = document.createElement("div"); const title = document.createElement("strong"); const meta = document.createElement("span"); const badge = document.createElement("i");
      title.textContent = target.pl_name; meta.textContent = `${target.hostname} · ${formatMaybe(target.pl_orbper, 3)} d · ${formatMaybe(target.pl_trandep, 0)} ppm`; badge.className = target.lightcurve_available ? "pill ok" : "pill warn"; badge.textContent = target.lightcurve_available ? "observed" : "model";
      text.append(title, meta); b.append(text, badge); b.addEventListener("click", () => this.selectTarget(target)); frag.appendChild(b);
    }
    this.dom.targetList.replaceChildren(frag);
  }

  async selectInitialTarget() { const preferred = this.targets.find(t => t.lightcurve_available) || this.targets[0] || normaliseTarget(DEFAULT_TARGET); await this.selectTarget(preferred); }

  async selectTarget(target) {
    this.activeTarget = target; this.latestTarget = target; this.setText(this.dom.activeTargetLabel, `${target.pl_name} · ${target.hostname}`); this.renderTargetList(this.dom.targetSearch.value);
    const q = this.latestParams.visualQuality || "balanced"; this.latestParams = { ...targetToParams(target, this.latestParams), visualQuality: q };
    this.syncControlsFromParams(); this.syncControlOutputs(); this.updateSciencePanels(); this.updateScene();
    this.renderSceneStatRow(); this.renderSceneReadiness(); this.renderEvidenceSummary();
    await this.loadArchivalLightCurve(target); this.sendWorkerDataContext(); this.issueParameterRevision("target-change"); this.draw(); this.setFriendlyStatus(`Target locked: ${target.pl_name} around ${target.hostname}.`);
  }

  async loadArchivalLightCurve(target) {
    if (!target.lightcurve_available || !target.lightcurve_file) { this.archivalCurve = generateSyntheticArchive(target, this.latestParams); return; }
    try {
      const safeFile = encodeURIComponent(target.lightcurve_file).replace(/%2F/g, "/");
      const response = await fetch(`${LIGHTCURVE_BASE_URL}${safeFile}?v=${Date.now()}`, { cache: "no-store", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json(); this.archivalCurve = normaliseLightCurvePayload(payload);
      if (this.archivalCurve.points < 10) this.archivalCurve = generateSyntheticArchive(target, this.latestParams);
    } catch (error) { this.archivalCurve = generateSyntheticArchive(target, this.latestParams); this.setFriendlyStatus(`Observed curve unavailable for ${target.pl_name}; synthetic demonstration data shown.`); }
  }

  renderMetrics() {
    const depthPpm = this.metrics.modelDepthPpm;
    const depthPercent = Number.isFinite(depthPpm) ? depthPpm / 10000 : null;
    const rprsProxy = Number.isFinite(depthPpm) ? Math.sqrt(depthPpm / 1e6) : null;
    this.setText(this.dom.metricDepthPercent, depthPercent === null ? "—" : `${formatNumber(depthPercent, 3)} %`);
    this.setText(this.dom.metricDepthSecondary, depthPpm === null ? "model depth" : `${formatPpm(depthPpm)} · flux loss`);
    this.setText(this.dom.metricRprsProxy, rprsProxy === null ? "—" : formatNumber(rprsProxy, 4));
    this.setText(this.dom.metricResidualRms, formatPpm(this.metrics.residualRmsPpm));
    this.setText(this.dom.metricOotRms, formatPpm(this.metrics.ootRmsPpm));
    this.setText(this.dom.metricSnr, this.metrics.snr === null ? "—" : formatNumber(this.metrics.snr, 2));
    this.setText(this.dom.metricMoon, formatPpm(this.metrics.maxMoonDepthPpm));
    this.setText(this.dom.metricSpot, formatPpm(this.metrics.maxSpotBoostPpm));
  }

  renderHypothesisFlags() {
    if (!this.dom.hypothesisFlags) return;
    const flags = this.metrics.hypothesisFlags || {};
    const items = [];
    items.push({
      label: "Moon",
      value: flags.moonEnabled ? (flags.moonTransiting ? "transiting" : "not transiting") : "off",
      tone: flags.moonEnabled ? (flags.moonTransiting ? "ok" : "warn") : "muted"
    });
    items.push({
      label: "Starspot",
      value: flags.spotEnabled ? (flags.spotCrossed ? "crossed" : "not crossed") : "off",
      tone: flags.spotEnabled ? (flags.spotCrossed ? "ok" : "warn") : "muted"
    });
    items.push({
      label: "Difference",
      value: formatPpm(this.metrics.hypothesisMaxAbsPpm),
      tone: Number(this.metrics.hypothesisMaxAbsPpm) > 1 ? "ok" : "muted"
    });
    const extraText = Array.isArray(flags.text) ? flags.text : [];
    const frag = document.createDocumentFragment();
    for (const item of items) {
      const node = document.createElement("div");
      node.className = `hypothesis-card ${item.tone}`;
      node.innerHTML = `<span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong>`;
      frag.appendChild(node);
    }
    if (extraText.length) {
      const note = document.createElement("div");
      note.className = "hypothesis-note";
      note.textContent = extraText.join(" · ");
      frag.appendChild(note);
    }
    this.dom.hypothesisFlags.replaceChildren(frag);
  }

  updateSciencePanels() {
    const t = this.latestTarget;
    this.renderPropertyGrid(this.dom.planetProperties, [["Period", formatUnit(t.pl_orbper,"d",4)], ["Duration", formatUnit(t.pl_trandur,"h",3)], ["Rp/R★", formatMaybe(t.pl_ratror,4)], ["Depth", formatDepthPair(t.pl_trandep)], ["Radius", firstFiniteUnit([t.pl_rade,t.pl_radj],["R⊕","RJ"],[2,3])], ["Mass", firstFiniteUnit([t.pl_bmasse,t.pl_bmassj],["M⊕","MJ"],[2,3])], ["a", formatUnit(t.pl_orbsmax,"AU",4)], ["Inclination", formatUnit(t.pl_orbincl,"°",2)], ["Eccentricity", formatMaybe(t.pl_orbeccen,3)], ["ω", formatUnit(t.pl_orblper,"°",2)], ["Discovery", t.disc_year ? String(t.disc_year) : "—"]]);
    this.renderPropertyGrid(this.dom.starProperties, [["Teff", formatUnit(t.st_teff,"K",0)], ["R★", formatUnit(t.st_rad,"R☉",3)], ["M★", formatUnit(t.st_mass,"M☉",3)], ["log g", formatMaybe(t.st_logg,3)], ["[Fe/H]", formatMaybe(t.st_met,3)], ["Stars", formatMaybe(t.sy_snum,0)], ["Planets", formatMaybe(t.sy_pnum,0)]]);
    this.renderPropertyGrid(this.dom.catalogueProperties, [["Method", t.discoverymethod || "—"], ["Data", t.lightcurve_available ? "local LC" : "synthetic"], ["LC points", this.archivalCurve.points ? this.archivalCurve.points.toLocaleString("en-GB") : "—"], ["File", t.lightcurve_file || "—"]]);
    this.syncControlOutputs();
  }

  renderPropertyGrid(container, rows) { if (!container) return; const frag = document.createDocumentFragment(); for (const [label, value] of rows) { const node = document.createElement("div"); node.className = "property"; const s = document.createElement("span"); s.textContent = label; const v = document.createElement("strong"); v.textContent = value || "—"; node.append(s,v); frag.appendChild(node); } container.replaceChildren(frag); }

  renderSceneStatRow() {
    if (!this.dom.sceneStatRow) return;
    const t = this.latestTarget || {};
    const spectralType = t.st_spectype || t.st_spectype_approx;
    const stats = [
      ["Spectral type", spectralType || "—"],
      ["Distance", formatUnit(t.sy_dist, "pc", 1)],
      ["V mag", formatMaybe(t.sy_vmag, 2)],
      ["R+/R⊕", firstFiniteUnit([t.pl_rade, t.pl_radj], ["R⊕", "RJ"], [2, 3])],
      ["Mass", firstFiniteUnit([t.pl_bmasse, t.pl_bmassj], ["M⊕", "MJ"], [2, 3])]
    ];
    this.dom.sceneStatRow.innerHTML = stats.map(([label, value]) =>
      `<div class="scene-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
    ).join("");
  }

  buildCurrentAudit() {
    return buildTargetAudit({ target: this.latestTarget, params: this.latestParams, metrics: this.metrics, archivalCurve: this.archivalCurve });
  }

  renderSceneReadiness() {
    if (!this.dom.sceneReadinessCard) return;
    const audit = this.buildCurrentAudit();
    const quality = qualityBars(audit, { target: this.latestTarget, metrics: this.metrics, archivalCurve: this.archivalCurve });
    const checklist = quality.map(item => `
      <li class="${item.value >= 70 ? "pass" : item.value >= 40 ? "watch" : "warn"}">
        <span>${item.value >= 70 ? "✓" : item.value >= 40 ? "•" : "!"}</span>${escapeHtml(item.label)}
      </li>
    `).join("");
    const readyWord = { good: "Ready", watch: "Watch", caution: "Caution", poor: "Not ready" }[scoreTone(audit.audit.total)];
    this.dom.sceneReadinessCard.innerHTML = `
      ${diagnosticGauge({ score: audit.audit.total, label: readyWord, detail: "/100", size: "compact" })}
      <p class="scene-readiness-rating">${escapeHtml(audit.audit.rating)}</p>
      <ul class="scene-readiness-checklist">${checklist}</ul>
    `;
  }

  renderEvidenceSummary() {
    if (!this.dom.evidenceSummaryCard) return;
    const audit = this.buildCurrentAudit();
    const quality = qualityBars(audit, { target: this.latestTarget, metrics: this.metrics, archivalCurve: this.archivalCurve });
    const tiles = quality.map(item => `
      <div class="evidence-summary-tile">
        <span>${escapeHtml(item.label)}</span>
        <strong>${item.value}%</strong>
        <div class="evidence-summary-track"><i style="width:${Math.max(0, Math.min(100, item.value))}%"></i></div>
        <small>${escapeHtml(item.detail)}</small>
      </div>
    `).join("");
    this.dom.evidenceSummaryCard.innerHTML = `
      <div class="card-header"><h2>Quick-look evidence summary</h2><span>exploratory audit, not a detection claim</span></div>
      <div class="evidence-summary-body">
        <div class="evidence-summary-grid">${tiles}</div>
        <div class="evidence-summary-gauge">
          ${diagnosticGauge({ score: audit.audit.total, label: "Global score", detail: "/100", size: "compact" })}
          <small>${escapeHtml(audit.audit.rating)}</small>
        </div>
      </div>
    `;
  }

  updateAssumptionStrip() { if (!this.dom.assumptionStrip) return; const flags = [...(this.metrics.morphologyFlags.length ? this.metrics.morphologyFlags : ["baseline transit model"]), this.timings.surfaceSamples ? `${Number(this.timings.surfaceSamples).toLocaleString("en-GB")} surface samples` : null, "ppm + percent depth"].filter(Boolean); const frag = document.createDocumentFragment(); for (const flag of flags.slice(0,9)) { const pill = document.createElement("span"); const lower = String(flag).toLowerCase(); pill.className = "pill"; if (lower.includes("high") || lower.includes("loaded") || lower.includes("quadrature") || lower.includes("residuals near")) pill.classList.add("ok"); else if (lower.includes("moon") || lower.includes("spot") || lower.includes("eccentric") || lower.includes("circular") || lower.includes("exposure")) pill.classList.add("warn"); else if (lower.includes("mismatch") || lower.includes("low")) pill.classList.add("danger"); pill.textContent = flag; frag.appendChild(pill); } this.dom.assumptionStrip.replaceChildren(frag); }

  draw() {
    const canvas = this.dom.canvas;
    const ctx = this.dom.ctx;
    if (!canvas || !ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    const width = Math.max(2, Math.floor(rect.width * dpr));
    const height = Math.max(2, Math.floor(rect.height * dpr));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const theme = getComputedStyle(this.root);
    const plotBg = theme.getPropertyValue("--plot-bg").trim() || "#0b1220";
    const grid = theme.getPropertyValue("--grid").trim() || "#243247";
    const text = theme.getPropertyValue("--text").trim() || "#edf4ff";
    const muted = theme.getPropertyValue("--muted").trim() || "#9ba9bd";
    const data = theme.getPropertyValue("--data").trim() || "#50c6df";
    const model = theme.getPropertyValue("--model").trim() || "#ffb547";
    const accent = theme.getPropertyValue("--accent").trim() || "#63a7ff";
    const danger = theme.getPropertyValue("--danger").trim() || "#ff8a80";

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = plotBg;
    ctx.fillRect(0, 0, width, height);

    /*
      v13 plot layout:
      The previous two-panel canvas was too compressed, so the main flux-axis
      labels, phase labels, and the hypothesis-difference panel collided. This
      layout gives the main flux plot its own label space, keeps the difference
      panel compact, and draws the orbital-phase labels only once at the bottom.
    */
    const pad = {
      left: Math.max(76 * dpr, width * 0.072),
      right: Math.max(30 * dpr, width * 0.025),
      top: Math.max(30 * dpr, height * 0.105),
      bottom: Math.max(34 * dpr, height * 0.13)
    };

    const diffHeight = Math.max(58 * dpr, Math.min(92 * dpr, height * 0.24));
    const gap = Math.max(16 * dpr, height * 0.055);
    const diffBottom = height - pad.bottom;
    const diffTop = diffBottom - diffHeight;
    const mainBottom = Math.max(pad.top + 86 * dpr, diffTop - gap);

    const scale = computeScale(collectPlotValues(this.archivalCurve, this.latestModel));
    const xMap = phase =>
      pad.left +
      (phase - scale.minPhase) /
      Math.max(1e-9, scale.maxPhase - scale.minPhase) *
      (width - pad.left - pad.right);

    const yMap = flux =>
      pad.top +
      (scale.maxFlux - flux) /
      Math.max(1e-9, scale.maxFlux - scale.minFlux) *
      (mainBottom - pad.top);

    drawPlotGrid(
      ctx,
      { left: pad.left, right: width - pad.right, top: pad.top, bottom: mainBottom },
      scale,
      dpr,
      { grid, text, muted }
    );

    drawArchivalScatter(ctx, this.archivalCurve, xMap, yMap, dpr, data);
    drawPlanetOnlyCurve(ctx, this.latestModel, xMap, yMap, dpr, muted);
    drawModelCurve(ctx, this.latestModel, xMap, yMap, dpr, model);
    drawLegend(ctx, { left: pad.left, top: pad.top }, dpr, { text, data, model, muted });

    drawDifferencePanel(
      ctx,
      this.latestModel,
      xMap,
      {
        top: diffTop,
        bottom: diffBottom,
        left: pad.left,
        right: width - pad.right,
        minPhase: scale.minPhase,
        maxPhase: scale.maxPhase,
        periodDays: finiteOrNull(this.latestTarget?.pl_orbper)
      },
      dpr,
      { grid, text, muted, accent, danger }
    );
  }

  startTelemetryLoop() {
    const updateUtc = () => {
      const now = new Date();
      const stamp = now.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
      this.setText(this.dom.footerUtc, stamp);
    };
    updateUtc();
    setInterval(updateUtc, 1000);

    const tick = now => {
      this.frameCounter += 1;
      if (now - this.lastFpsTime >= 500) {
        this.fps = Math.round(this.frameCounter * 1000 / (now - this.lastFpsTime));
        this.frameCounter = 0;
        this.lastFpsTime = now;
        this.setText(this.dom.statusFps, `${this.fps} fps`);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  setWorkerFailed(message) { this.workerReady = false; this.setText(this.dom.statusWorker, "failed"); this.setText(this.dom.statusSolver, "offline"); this.setFriendlyStatus(message); }
  setFriendlyStatus(message) { this.setText(this.dom.footerMessage, message); }
  setText(node, value) { if (node) node.textContent = String(value); }
}

/* ============================================================================
   Cinematic boot
   ============================================================================ */
async function playCinematicBootSequence() {
  const bootScreen = document.querySelector(".boot-screen"); const statusEl = document.getElementById("boot-status"); const percentEl = document.getElementById("boot-percent"); const barEl = document.getElementById("boot-progress-bar");
  if (!bootScreen || !statusEl || !percentEl || !barEl) { await wait(1500); return; }
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const minimumBootTimeMs = reducedMotion ? 900 : 4600; const startTime = performance.now();
  const steps = [{target:6,text:"Initialising observatory systems..."},{target:14,text:"Opening the ExoLight transit laboratory..."},{target:24,text:"Loading the exoplanet target archive..."},{target:35,text:"Reading stellar and planetary parameters..."},{target:47,text:"Loading archived photometry..."},{target:58,text:"Preparing the transit physics engine..."},{target:70,text:"Rendering the stellar photosphere and magnetic field layer..."},{target:82,text:"Synchronising orbit geometry and flux model..."},{target:92,text:"Tighten your seatbelt — we are travelling to another star system..."},{target:98,text:"Finalising the scientific interface..."},{target:100,text:"ExoIntel-Prime is ready."}];
  let current = 0; const update = (value,text) => { current = Math.max(current, Math.min(100,value)); percentEl.textContent = `${Math.round(current)}%`; barEl.style.width = `${current}%`; if (text) statusEl.textContent = text; };
  update(0,"Initialising observatory systems...");
  for (const step of steps) { const start = current; const end = step.target; const frames = reducedMotion ? 2 : Math.max(10, Math.round((end - start) * 1.55)); for (let i=1;i<=frames;i++) { const t=i/frames; const eased = 1 - Math.pow(1-t,2.2); update(start + (end-start)*eased, step.text); await wait(reducedMotion ? 20 : 36); } }
  const elapsed = performance.now() - startTime; if (elapsed < minimumBootTimeMs) await wait(minimumBootTimeMs - elapsed);
  update(100,"ExoIntel-Prime is ready."); await wait(350); bootScreen.classList.add("is-fading"); await wait(650); bootScreen.remove();
}
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

/* ============================================================================
   Template helpers
   ============================================================================ */
function transitLogoSvg() { return `<svg class="brand-logo" viewBox="0 0 100 100" role="img" aria-label="ExoIntel-Prime transit logo"><defs><radialGradient id="exoStar" cx="45%" cy="42%" r="62%"><stop offset="0%" stop-color="#ffd38b"/><stop offset="42%" stop-color="#ff9f2e"/><stop offset="72%" stop-color="#d86f16"/><stop offset="100%" stop-color="#5b2508"/></radialGradient><linearGradient id="exoRing" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#63a7ff"/><stop offset="100%" stop-color="#50c6df"/></linearGradient></defs><rect x="5" y="5" width="90" height="90" rx="25" fill="rgba(12,20,35,.96)" stroke="rgba(99,167,255,.34)" stroke-width="2"/><circle cx="52" cy="52" r="25" fill="url(#exoStar)"/><path d="M18 66 C32 28, 72 20, 86 39" fill="none" stroke="url(#exoRing)" stroke-width="3.4" stroke-linecap="round" opacity=".9"/><circle cx="40" cy="52" r="8.3" fill="#06111f" stroke="#50c6df" stroke-width="1.4"/><circle cx="69" cy="29" r="2.4" fill="#ffb547"/><circle cx="24" cy="75" r="2.0" fill="#63a7ff"/></svg>`; }
function help(key) { const text = HELP_TEXT[key] || "Scientific term explanation unavailable."; return `<span class="help" tabindex="0" aria-label="${escapeHtml(text)}">?<span class="help-content">${escapeHtml(text)}</span></span>`; }
function rangeControl(key,label,min,max,step,value,digits=2,suffix="") { const safe = Number.isFinite(Number(value)) ? Number(value) : Number(min); return `<div class="control-row"><label for="${key}">${label}</label><input id="${key}" data-param="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${safe}"/><output id="out-${key}">${formatNumber(safe,digits)}${suffix}</output></div>`; }
function toggleControl(key,label,checked) { return `<div class="toggle-row"><label for="${key}">${label}</label><input id="${key}" data-param="${key}" type="checkbox" ${checked ? "checked" : ""}/><output id="out-${key}">${checked ? "on" : "off"}</output></div>`; }
function selectControl(key,label,options,value,helpKey=null) { const opts = options.map(([v,l]) => `<option value="${escapeHtml(v)}" ${String(v) === String(value) ? "selected" : ""}>${escapeHtml(l)}</option>`).join(""); return `<div class="select-row"><label for="${key}">${label}</label><select id="${key}" data-param="${key}">${opts}</select>${helpKey ? help(helpKey) : "<span></span>"}</div>`; }
function readonlyControl(id,label,value,helpKey=null) { return `<div class="control-row"><label>${label}</label><div></div><output id="${id}-value">${value}</output>${helpKey ? help(helpKey) : ""}</div>`; }

/* Data and plot helpers */
function normaliseTarget(row) { if (!row || typeof row !== "object") return null; const name = stringValue(row.pl_name || row.name || row.planet || "Unknown planet"); const host = stringValue(row.hostname || row.host || "Unknown host"); const rpRs = numberValue(row.pl_ratror, 0.1); const depth = numberValue(row.pl_trandep, rpRs * rpRs * 1e6); return { id: `${host}::${name}`.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,""), pl_name:name, hostname:host, discoverymethod:stringValue(row.discoverymethod || row.discovery_method || "Transit"), disc_year:numberValue(row.disc_year,null), pl_orbper:numberValue(row.pl_orbper,3), pl_trandur:numberValue(row.pl_trandur,2.5), pl_trandep:depth, pl_ratror:rpRs, pl_orbsmax:numberValue(row.pl_orbsmax,null), pl_orbincl:numberValue(row.pl_orbincl,88.5), pl_orbeccen:numberValue(row.pl_orbeccen,0), pl_orblper:numberValue(row.pl_orblper ?? row.omega,90), pl_bmassj:numberValue(row.pl_bmassj,null), pl_bmasse:numberValue(row.pl_bmasse,null), pl_radj:numberValue(row.pl_radj,null), pl_rade:numberValue(row.pl_rade,null), st_teff:numberValue(row.st_teff,5772), st_rad:numberValue(row.st_rad,1), st_mass:numberValue(row.st_mass,1), st_logg:numberValue(row.st_logg,null), st_met:numberValue(row.st_met,null), sy_snum:numberValue(row.sy_snum,null), sy_pnum:numberValue(row.sy_pnum,null), sy_dist:numberValue(row.sy_dist,null), sy_vmag:numberValue(row.sy_vmag,null), st_spectype:stringValue(row.st_spectype||"")||null, st_spectype_approx:stringValue(row.st_spectype_approx||"")||null, lightcurve_available:Boolean(row.lightcurve_available || row.has_lightcurve || row.has_observed_lc), lightcurve_file:stringValue(row.lightcurve_file || "") }; }
function targetToParams(target, previous) { return { ...previous, rpRs: clamp(numberValue(target.pl_ratror, previous.rpRs), .01, .25), aRs: clamp(inferARs(target, previous.aRs), 2, 60), inclinationDeg: clamp(numberValue(target.pl_orbincl, previous.inclinationDeg), 75, 90), eccentricity: clamp(numberValue(target.pl_orbeccen, 0), 0, .95), omegaDeg: normaliseDegrees(numberValue(target.pl_orblper, 90)), fidelity: "preview", modelResolution: 720 }; }
function inferARs(target,fallback) { const aAu = numberValue(target.pl_orbsmax,null); const rStar = numberValue(target.st_rad,null); if (!Number.isFinite(aAu) || !Number.isFinite(rStar) || rStar <= 0) return fallback; return aAu / (rStar * 0.00465047); }
function normaliseLightCurvePayload(payload) { const rows = extractLightCurveRows(payload); const pts = []; for (const row of rows) { const phase = numberValue(row.phase ?? row.Phase ?? row.x ?? row[0], NaN); const flux = numberValue(row.flux ?? row.Flux ?? row.normalized_flux ?? row.y ?? row[1], NaN); const error = numberValue(row.error ?? row.flux_err ?? row.err ?? row[2], NaN); if (!Number.isFinite(phase) || !Number.isFinite(flux)) continue; if (phase < -1.5 || phase > 1.5 || flux < .2 || flux > 1.8) continue; pts.push({ phase, flux, error: Number.isFinite(error) ? error : 0 }); } pts.sort((a,b) => a.phase-b.phase); return { phase:new Float32Array(pts.map(p=>p.phase)), flux:new Float32Array(pts.map(p=>p.flux)), error:new Float32Array(pts.map(p=>p.error || 0)), source:stringValue(payload?.source || "local light-curve JSON"), points:pts.length }; }
function extractLightCurveRows(payload) { if (Array.isArray(payload)) return payload; if (Array.isArray(payload?.points)) return payload.points; if (Array.isArray(payload?.data)) return payload.data; if (Array.isArray(payload?.phase) && Array.isArray(payload?.flux)) { const n = Math.min(payload.phase.length, payload.flux.length); return Array.from({ length:n }, (_,i) => ({ phase: payload.phase[i], flux: payload.flux[i], error: Array.isArray(payload.error) ? payload.error[i] : 0 })); } return []; }
function generateSyntheticArchive(target, params) { const n=480; const phase=new Float32Array(n), flux=new Float32Array(n), error=new Float32Array(n); const depth=clamp(numberValue(target.pl_trandep, params.rpRs*params.rpRs*1e6)/1e6,.0001,.08); const width=clamp(numberValue(target.pl_trandur,2.5)/24/Math.max(.2,numberValue(target.pl_orbper,3)),.008,.08); for (let i=0;i<n;i++){ const x=-.12+.24*i/(n-1); const transit=Math.exp(-.5*(x/Math.max(.002,width))**2); const noise=.00045*Math.sin(i*12.9898)+.00022*Math.sin(i*4.1414+1.7); phase[i]=x; flux[i]=1-depth*transit+noise; error[i]=.0005; } return { phase, flux, error, source:"synthetic demonstration fallback", points:n }; }
function collectPlotValues(archive,model) { return { phaseValues:[...archive.phase,...model.phase], fluxValues:[...archive.flux,...model.flux,...(model.planetOnlyFlux||[]) ] }; }
function computeScale(values) { let minPhase=Infinity,maxPhase=-Infinity,minFluxRaw=Infinity,maxFluxRaw=-Infinity; for (const v of values.phaseValues) if (Number.isFinite(v)) { minPhase=Math.min(minPhase,v); maxPhase=Math.max(maxPhase,v); } for (const v of values.fluxValues) if (Number.isFinite(v)) { minFluxRaw=Math.min(minFluxRaw,v); maxFluxRaw=Math.max(maxFluxRaw,v); } if (!Number.isFinite(minPhase)||!Number.isFinite(maxPhase)||minPhase===maxPhase){minPhase=-.12;maxPhase=.12;} if (!Number.isFinite(minFluxRaw)||!Number.isFinite(maxFluxRaw)||minFluxRaw===maxFluxRaw){minFluxRaw=.99;maxFluxRaw=1.001;} const span=Math.max(.0005,maxFluxRaw-minFluxRaw); return { minPhase,maxPhase,minFlux:minFluxRaw-span*.18,maxFlux:maxFluxRaw+span*.15 }; }
function drawPlotGrid(ctx, box, scale, dpr, colours) {
  ctx.save();

  const width = box.right - box.left;
  const height = box.bottom - box.top;

  ctx.strokeStyle = alphaColour(colours.grid, 0.88);
  ctx.lineWidth = 1 * dpr;

  for (let i = 0; i <= 10; i += 1) {
    const x = box.left + (i / 10) * width;
    ctx.beginPath();
    ctx.moveTo(x, box.top);
    ctx.lineTo(x, box.bottom);
    ctx.stroke();
  }

  for (let i = 0; i <= 5; i += 1) {
    const y = box.top + (i / 5) * height;
    ctx.beginPath();
    ctx.moveTo(box.left, y);
    ctx.lineTo(box.right, y);
    ctx.stroke();
  }

  ctx.strokeStyle = alphaColour(colours.muted, 0.78);
  ctx.strokeRect(box.left, box.top, width, height);

  ctx.fillStyle = colours.muted;
  ctx.font = `${10.5 * dpr}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  for (let i = 0; i <= 4; i += 1) {
    const flux = scale.maxFlux - (i / 4) * (scale.maxFlux - scale.minFlux);
    const y = box.top + (i / 4) * height;
    ctx.fillText(formatNumber(flux, 5), box.left - 10 * dpr, y);
  }

  /*
    v14: The top-left "Flux" label previously collided with the legend
    ("archival photometry"). Keep the legend above the panel and move the
    y-axis title into the left margin as a compact rotated label.
  */
  ctx.save();
  ctx.translate(box.left - 58 * dpr, box.top + height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = colours.text;
  ctx.font = `${10.5 * dpr}px Inter, system-ui, sans-serif`;
  ctx.fillText("Flux", 0, 0);
  ctx.restore();

  ctx.restore();
}

function drawArchivalScatter(ctx,archive,xMap,yMap,dpr,colour){ctx.save();ctx.fillStyle=alphaColour(colour,.55);const r=Math.max(1.2,1.45*dpr);for(let i=0;i<archive.phase.length;i++){ctx.beginPath();ctx.arc(xMap(archive.phase[i]),yMap(archive.flux[i]),r,0,Math.PI*2);ctx.fill();}ctx.restore();}
function drawModelCurve(ctx,model,xMap,yMap,dpr,colour){if(model.phase.length<2)return;ctx.save();ctx.beginPath();for(let i=0;i<model.phase.length;i++){const x=xMap(model.phase[i]);const y=yMap(model.flux[i]);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.strokeStyle=colour;ctx.lineWidth=Math.max(2,2.35*dpr);ctx.stroke();ctx.restore();}
function drawPlanetOnlyCurve(ctx,model,xMap,yMap,dpr,colour){if(!model.planetOnlyFlux||model.planetOnlyFlux.length<2||model.planetOnlyFlux.length!==model.phase.length)return;ctx.save();ctx.beginPath();for(let i=0;i<model.phase.length;i++){const x=xMap(model.phase[i]);const y=yMap(model.planetOnlyFlux[i]);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.setLineDash([6*dpr,4*dpr]);ctx.strokeStyle=alphaColour(colour,.72);ctx.lineWidth=Math.max(1,1.25*dpr);ctx.stroke();ctx.restore();}
function drawDifferencePanel(ctx, model, xMap, box, dpr, colours) {
  const delta = model.hypothesisDeltaPpm;

  ctx.save();

  const panelHeight = box.bottom - box.top;
  const panelWidth = box.right - box.left;

  ctx.strokeStyle = alphaColour(colours.grid, 0.72);
  ctx.lineWidth = 1 * dpr;
  ctx.strokeRect(box.left, box.top, panelWidth, panelHeight);

  ctx.font = `${10 * dpr}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = colours.text;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText("Hypothesis residual: active − planet-only [ppm]", box.left, box.top - 6 * dpr);

  if (!delta || delta.length < 2 || delta.length !== model.phase.length) {
    ctx.fillStyle = colours.muted;
    ctx.textBaseline = "middle";
    ctx.fillText("waiting for worker difference curve", box.left + 10 * dpr, (box.top + box.bottom) / 2);
    ctx.restore();
    return;
  }

  let maxAbs = 0;
  for (const value of delta) {
    if (Number.isFinite(value)) maxAbs = Math.max(maxAbs, Math.abs(value));
  }

  const span = Math.max(5, Math.ceil(maxAbs / 10) * 10);
  const y0 = (box.top + box.bottom) / 2;
  const yMap = value => y0 - (value / span) * panelHeight * 0.38;

  ctx.strokeStyle = alphaColour(colours.grid, 0.8);
  ctx.beginPath();
  ctx.moveTo(box.left, y0);
  ctx.lineTo(box.right, y0);
  ctx.stroke();

  ctx.fillStyle = colours.muted;
  ctx.font = `${9.5 * dpr}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(`+${span}`, box.left - 8 * dpr, box.top + 9 * dpr);
  ctx.fillText("0", box.left - 8 * dpr, y0);
  ctx.fillText(`-${span}`, box.left - 8 * dpr, box.bottom - 9 * dpr);

  ctx.beginPath();
  for (let i = 0; i < model.phase.length; i += 1) {
    const x = xMap(model.phase[i]);
    const y = yMap(delta[i]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = maxAbs > 1 ? colours.accent : alphaColour(colours.muted, 0.65);
  ctx.lineWidth = Math.max(1.4, 1.65 * dpr);
  ctx.stroke();

  ctx.fillStyle = maxAbs > 1 ? colours.accent : colours.muted;
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillText(`peak |Δ| ${Math.round(maxAbs).toLocaleString("en-GB")} ppm`, box.right - 8 * dpr, box.top + 7 * dpr);

  const periodDays = Number.isFinite(box.periodDays) && box.periodDays > 0 ? box.periodDays : null;

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = colours.muted;
  for (let i = 0; i <= 4; i += 1) {
    const phase = box.minPhase + (i / 4) * (box.maxPhase - box.minPhase);
    const x = box.left + (i / 4) * panelWidth;
    const label = periodDays ? formatNumber(phase * periodDays * 24, 2) : formatNumber(phase, 3);
    ctx.fillText(label, x, box.bottom + 8 * dpr);
  }

  ctx.fillStyle = colours.text;
  ctx.fillText(periodDays ? "Time from mid-transit (hours)" : "Orbital phase", box.left + panelWidth / 2, box.bottom + 23 * dpr);

  ctx.restore();
}

function drawLegend(ctx,pad,dpr,c){ctx.save();ctx.font=`${11*dpr}px Inter, system-ui, sans-serif`;ctx.textBaseline="middle";const y=pad.top-11*dpr,x0=pad.left+8*dpr;ctx.fillStyle=c.data;ctx.beginPath();ctx.arc(x0,y,3.5*dpr,0,Math.PI*2);ctx.fill();ctx.fillStyle=c.text;ctx.fillText("archival photometry",x0+10*dpr,y);const x1=x0+164*dpr;ctx.strokeStyle=c.model;ctx.lineWidth=2.5*dpr;ctx.beginPath();ctx.moveTo(x1,y);ctx.lineTo(x1+22*dpr,y);ctx.stroke();ctx.fillStyle=c.text;ctx.fillText("active model",x1+30*dpr,y);const x2=x1+138*dpr;ctx.strokeStyle=alphaColour(c.muted,.72);ctx.setLineDash([6*dpr,4*dpr]);ctx.beginPath();ctx.moveTo(x2,y);ctx.lineTo(x2+22*dpr,y);ctx.stroke();ctx.setLineDash([]);ctx.fillText("planet-only",x2+30*dpr,y);ctx.restore();}
function serialiseTarget(t){return{pl_name:t.pl_name,hostname:t.hostname,pl_orbper:numberValue(t.pl_orbper,3),pl_trandur:numberValue(t.pl_trandur,2.5),pl_trandep:numberValue(t.pl_trandep,10000),pl_orbeccen:numberValue(t.pl_orbeccen,0),pl_orblper:numberValue(t.pl_orblper,90),st_teff:numberValue(t.st_teff,5772),st_rad:numberValue(t.st_rad,1),st_mass:numberValue(t.st_mass,1)};}
function toCamel(id){return id.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());}
function normaliseDegrees(deg){let v=Number(deg);if(!Number.isFinite(v))return 0;v%=360;if(v<0)v+=360;return v;}
function numberValue(v,f){const n=Number(v);return Number.isFinite(n)?n:f;}
function stringValue(v){return v===null||v===undefined?"":String(v).trim();}
function finiteOrNull(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function formatNumber(v,d){const n=Number(v);return Number.isFinite(n)?n.toFixed(d):"—";}
function formatMaybe(v,d){const n=Number(v);return Number.isFinite(n)?n.toFixed(d):"—";}
function formatPpm(v){const n=Number(v);return Number.isFinite(n)?`${Math.round(n).toLocaleString("en-GB")} ppm`:"—";}
function formatUnit(v,u,d){const n=Number(v);return Number.isFinite(n)?`${n.toFixed(d)} ${u}`:"—";}
function formatDepthPair(ppm){const n=Number(ppm);return Number.isFinite(n)?`${(n/10000).toFixed(3)}% · ${Math.round(n).toLocaleString("en-GB")} ppm`:"—";}
function firstFiniteUnit(values,units,digits){for(let i=0;i<values.length;i++){const n=Number(values[i]);if(Number.isFinite(n))return`${n.toFixed(digits[i])} ${units[i]}`;}return"—";}
function clamp(v,min,max){const n=Number(v);if(!Number.isFinite(n))return min;return Math.min(max,Math.max(min,n));}
function escapeHtml(v){return String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}
function alphaColour(colour,alpha){const v=String(colour||"").trim();if(v.startsWith("#")&&(v.length===7||v.length===4)){let r,g,b;if(v.length===4){r=parseInt(v[1]+v[1],16);g=parseInt(v[2]+v[2],16);b=parseInt(v[3]+v[3],16);}else{r=parseInt(v.slice(1,3),16);g=parseInt(v.slice(3,5),16);b=parseInt(v.slice(5,7),16);}return`rgba(${r},${g},${b},${alpha})`;}return v||`rgba(23,107,135,${alpha})`;}

async function bootstrapApplication(){ await playCinematicBootSequence(); const app = new ExoIntelPrimeApp(); await app.boot(); }
function startWhenReady(){ bootstrapApplication().catch(error => { console.error("Application bootstrap failed:", error); const statusEl=document.getElementById("boot-status"); const percentEl=document.getElementById("boot-percent"); const barEl=document.getElementById("boot-progress-bar"); if(statusEl)statusEl.textContent="Startup failed. Please reload the page."; if(percentEl)percentEl.textContent="Error"; if(barEl)barEl.style.width="100%"; }); }
if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", startWhenReady, { once:true }); else startWhenReady();
