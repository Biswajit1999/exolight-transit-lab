import { DataOrchestrator, DEFAULT_ADQL } from "./dataOrchestrator.js";
import { TransitPhysicsEngine, createDefaultParams, deriveDossier, mergeTargetIntoParams } from "./physics.js";
import { ObservatoryScene } from "./scene.js";
import { PrimeHUD } from "./ui.js";

const APP_VERSION = "ExoIntel-Prime v1.0.0";
const TARGET_CACHE_URL = "./data/exoplanets.json";
const FRAME_BUDGET_MS = 1000 / 60;
const CURVE_PHASE_MIN = -0.085;
const CURVE_PHASE_MAX = 0.085;
const CURVE_POINTS = 241;

class ExoIntelPrimeApp {
  constructor() {
    this.params = createDefaultParams();
    this.target = null;
    this.targets = [];
    this.curve = [];
    this.phase = -0.075;
    this.epoch = 0;
    this.running = false;
    this.lastFrame = 0;
    this.lastCurveHash = "";
    this.lastRenderTick = 0;
    this.physics = new TransitPhysicsEngine({ rings: 82, azimuth: 150 });
    this.data = new DataOrchestrator({ cacheUrl: TARGET_CACHE_URL });
    this.hud = new PrimeHUD();
    this.scene = new ObservatoryScene({
      canvas: document.getElementById("scene-canvas"),
      onStatus: message => this.hud.log(message, "info"),
      onWarn: message => this.hud.log(message, "warn")
    });
  }

  async boot() {
    this.hud.bind({
      onSearch: query => this.renderTargetList(query),
      onTargetSelect: target => this.selectTarget(target),
      onControlsChange: params => this.updateParams(params, true),
      onReset: () => this.resetControls(),
      onTapRun: () => this.runTapQuery(),
      onCacheLoad: () => this.loadCache(true),
      onConsoleToggle: expanded => this.hud.setTapExpanded(expanded)
    });

    this.hud.setClock();
    setInterval(() => this.hud.setClock(), 1000);

    this.hud.setStatus({
      runtime: "BOOTING",
      data: "CACHE LOAD",
      solver: "82×150 POLAR",
      render: "WEBGL INIT",
      tap: "IDLE",
      warning: false
    });

    this.hud.setAdql(DEFAULT_ADQL);
    this.hud.setKernel({ rings: 82, azimuth: 150, samples: 12300, moon: false, spot: false });
    this.hud.setControls(this.params);
    this.hud.log(`${APP_VERSION} bootstrap sequence engaged.`, "info");

    try {
      await this.scene.init();
      this.hud.setStatus({ render: "WEBGL ONLINE" });
      this.hud.log("Native WebGL scene layer initialized with volumetric star shader pipeline.", "info");
    } catch (error) {
      this.hud.setStatus({ render: "CANVAS SAFE MODE" });
      this.hud.log(`WebGL initialization degraded: ${error.message}`, "warn");
    }

    await this.loadCache(false);

    if (this.targets.length > 0) {
      this.selectTarget(this.targets[0]);
    } else {
      this.recompute(true);
      this.hud.renderDossier(deriveDossier(null, this.params));
    }

    this.running = true;
    this.hud.setStatus({ runtime: "ONLINE" });
    requestAnimationFrame(time => this.loop(time));
  }

  async loadCache(force) {
    this.hud.setStatus({ data: "CACHE LOAD", tap: force ? "CACHE REQUEST" : "IDLE", warning: false });
    try {
      const targets = await this.data.loadLocalCache(force);
      this.targets = targets;
      this.hud.setStatus({ data: "LOCAL CACHE", tap: "IDLE", warning: false });
      this.hud.log(`Loaded ${targets.length} local exoplanet targets.`, "info");
      this.renderTargetList(this.hud.getSearchQuery());
      return targets;
    } catch (error) {
      this.targets = this.data.getEmbeddedFallback();
      this.hud.setStatus({ data: "EMBEDDED FALLBACK", tap: "CACHE ERROR", warning: true });
      this.hud.flashTapWarning("LOCAL CACHE ERROR / EMBEDDED FALLBACK ACTIVE");
      this.hud.log(`Local cache load failed: ${error.message}`, "error");
      this.renderTargetList(this.hud.getSearchQuery());
      return this.targets;
    }
  }

  async runTapQuery() {
    const adql = this.hud.getAdql().trim();
    if (!adql) {
      this.hud.log("TAP query blocked because ADQL editor is empty.", "warn");
      return;
    }

    this.hud.setStatus({ tap: "QUERYING", data: "NASA TAP", warning: false });
    this.hud.log("NASA TAP synchronous query dispatched.", "info");

    try {
      const targets = await this.data.queryTap(adql);
      this.targets = targets;
      this.hud.setStatus({ tap: "LIVE TAP OK", data: "NASA TAP", warning: false });
      this.hud.log(`TAP query returned ${targets.length} normalized targets.`, "info");
      this.renderTargetList("");
      this.hud.setSearchQuery("");
      if (targets.length > 0) this.selectTarget(targets[0]);
    } catch (error) {
      this.hud.setStatus({ tap: "CORS WALL", data: "LOCAL CACHE", warning: true });
      this.hud.flashTapWarning("TAP TIMEOUT / CORS WALL DETECTED");
      this.hud.log(`TAP live query failed: ${error.message}`, "error");
      const fallback = await this.loadCache(false);
      if (fallback.length > 0) this.selectTarget(fallback[0]);
    }
  }

  renderTargetList(query = "") {
    const filtered = this.data.filterTargets(this.targets, query);
    this.hud.renderTargets(filtered, this.target);
    this.hud.setTargetCount(filtered.length, this.targets.length);
  }

  selectTarget(target) {
    this.target = target;
    this.params = mergeTargetIntoParams(this.params, target);
    this.phase = -0.075;
    this.epoch = 0;
    this.hud.setActiveTarget(target);
    this.hud.setControls(this.params);
    this.hud.renderDossier(deriveDossier(target, this.params));
    this.hud.log(`Target lock: ${target.pl_name || target.name || "Unknown planet"} around ${target.hostname || target.host || "unknown host"}.`, "info");
    this.recompute(true);
  }

  updateParams(nextParams, recomputeCurve) {
    this.params = { ...this.params, ...nextParams };
    this.hud.setKernel({
      rings: 82,
      azimuth: 150,
      samples: 12300,
      moon: !!this.params.moonEnabled,
      spot: !!this.params.spotEnabled
    });
    this.hud.renderDossier(deriveDossier(this.target, this.params));
    if (recomputeCurve) this.recompute(false);
  }

  resetControls() {
    const base = createDefaultParams();
    this.params = this.target ? mergeTargetIntoParams(base, this.target) : base;
    this.phase = -0.075;
    this.epoch = 0;
    this.hud.setControls(this.params);
    this.hud.renderDossier(deriveDossier(this.target, this.params));
    this.hud.log("Control matrix reset to target-calibrated defaults.", "info");
    this.recompute(true);
  }

  recompute(force) {
    const hash = this.hashParams(this.params);
    if (!force && hash === this.lastCurveHash) return;

    this.lastCurveHash = hash;
    this.curve = this.physics.generateLightCurve({
      params: this.params,
      phaseMin: CURVE_PHASE_MIN,
      phaseMax: CURVE_PHASE_MAX,
      points: CURVE_POINTS,
      epoch: this.epoch
    });

    const summary = this.physics.summarizeCurve(this.curve);
    this.hud.renderLightCurve(this.curve, summary);
    this.hud.setFluxSummary(summary);
    this.scene.setCurveSummary(summary);
  }

  loop(time) {
    if (!this.running) return;

    const dt = Math.min(0.05, Math.max(0, (time - this.lastFrame) / 1000 || 0));
    this.lastFrame = time;

    this.phase += dt * 0.012;
    if (this.phase > 0.085) {
      this.phase = -0.085;
      this.epoch += 1;
    }

    const shiftedPhase = this.physics.applyTTV(this.phase, this.params, this.epoch);
    const sample = this.physics.evaluateAtPhase(shiftedPhase, this.params, this.epoch);
    const moonState = this.physics.computeMoonState(shiftedPhase, this.params);
    const impact = this.physics.computeImpactParameter(this.params);

    this.hud.setSceneReadouts({
      phase: shiftedPhase,
      impact,
      depthPpm: sample.depthPpm,
      moon: this.params.moonEnabled ? moonState.label : "DISABLED",
      fps: this.scene.getFPS()
    });

    this.scene.render({
      time: time * 0.001,
      phase: shiftedPhase,
      params: this.params,
      sample,
      moonState,
      target: this.target
    });

    if (time - this.lastRenderTick > FRAME_BUDGET_MS * 12) {
      this.lastRenderTick = time;
      this.hud.markCurvePhase(shiftedPhase);
    }

    requestAnimationFrame(next => this.loop(next));
  }

  hashParams(p) {
    return [
      p.rpRs, p.aRs, p.inclinationDeg, p.periodDays, p.eccentricity,
      p.u1, p.u2, p.moonEnabled, p.moonRadius, p.moonDistance,
      p.moonPhaseDeg, p.moonInclinationDeg, p.moonNodeDeg,
      p.spotEnabled, p.spotX, p.spotY, p.spotRadius, p.spotContrast,
      p.ttvEnabled, p.ttvAmplitude, p.ttvPeriodEpochs
    ].map(v => typeof v === "number" ? v.toFixed(6) : String(v)).join("|");
  }
}

const start = () => {
  const app = new ExoIntelPrimeApp();
  app.boot().catch(error => {
    const hud = new PrimeHUD();
    hud.log(`Fatal bootstrap failure: ${error.message}`, "error");
    hud.setStatus({
      runtime: "BOOT FAILED",
      data: "UNKNOWN",
      solver: "HALTED",
      render: "HALTED",
      tap: "HALTED",
      warning: true
    });
    console.error(error);
  });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
