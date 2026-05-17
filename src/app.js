import { DataOrchestrator, DEFAULT_ADQL } from "./dataOrchestrator.js";
import {
  TransitPhysicsEngine,
  createDefaultParams,
  deriveDossier,
  mergeTargetIntoParams
} from "./physics.js";
import { ObservatoryScene } from "./scene.js";
import { PrimeHUD } from "./ui.js";

const APP_VERSION = "ExoIntel-Prime Iteration VII Coupled Orbit Observatory";
const TARGET_CACHE_URL = "./data/exoplanets.json";

const CURVE_PHASE_MIN = -0.085;
const CURVE_PHASE_MAX = 0.085;
const CURVE_POINTS = 281;

const ORBIT_RATE_REV_PER_SECOND = 0.035;
const INITIAL_ORBIT_PHASE = 0.91;

class ExoIntelPrimeApp {
  constructor() {
    this.params = createDefaultParams();
    this.target = null;
    this.targets = [];
    this.modelCurve = [];
    this.observedCurve = [];

    this.orbitPhase = INITIAL_ORBIT_PHASE;
    this.transitPhase = 0;
    this.epoch = 0;
    this.systemState = null;

    this.running = false;
    this.lastFrame = 0;
    this.lastCurveHash = "";
    this.lastRenderTick = 0;
    this.lastObservationTargetId = "";

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
      solver: "COUPLED",
      render: "WEBGL INIT",
      tap: "CACHE-FIRST",
      warning: false
    });

    this.hud.setFooterStatus?.({
      fps: "--",
      data: "DATA INGESTION STATUS: INITIALISING // COUPLED ORBIT + PHOTOMETRY"
    });

    this.hud.setAdql(DEFAULT_ADQL);

    this.hud.setKernel({
      rings: 82,
      azimuth: 150,
      samples: 12300,
      moon: false,
      spot: false,
      observation: "WAITING"
    });

    this.hud.setControls(this.params);

    this.hud.log(`${APP_VERSION} bootstrap sequence engaged.`, "info");
    this.hud.log(
      "Architecture mode: physics.js is the state authority. Orbit, projected geometry, model flux, marker phase, and renderer input now come from one physical state vector.",
      "info"
    );

    try {
      await this.scene.init();

      this.hud.setStatus({
        render: "WEBGL ONLINE",
        solver: "82×150 COUPLED"
      });

      this.hud.log(
        "WebGL scene online. Current renderer still has a compatibility path; next rewrite will make scene.js consume systemState directly.",
        "info"
      );
    } catch (error) {
      this.hud.setStatus({ render: "CANVAS SAFE MODE" });
      this.hud.log(`WebGL initialization degraded: ${error.message}`, "warn");
    }

    await this.loadCache(true);

    const firstRealTarget =
      this.targets.find(target => target.lightcurve_available) ||
      this.targets[0];

    if (firstRealTarget) {
      await this.selectTarget(firstRealTarget);
    } else {
      this.systemState = this.physics.evaluateAtOrbitPhase(
        this.orbitPhase,
        this.params,
        this.epoch,
        { includeVisual: true }
      );

      this.transitPhase = this.systemState.transitPhase;
      this.recompute(true);
      this.hud.renderDossier(deriveDossier(null, this.params));
      this.hud.setObservationState?.("NO TARGET", 0);
    }

    this.running = true;
    this.hud.setStatus({ runtime: "ONLINE" });

    requestAnimationFrame(time => this.loop(time));
  }

  async loadCache(force = false) {
    this.hud.setStatus({
      data: "CACHE LOAD",
      tap: force ? "CACHE RELOAD" : "CACHE-FIRST",
      warning: false
    });

    try {
      const targets = await this.data.loadLocalCache(force);
      this.targets = targets;

      const realCount = targets.filter(target => target.lightcurve_available).length;

      this.hud.setStatus({
        data: "LOCAL CACHE",
        tap: "CACHE MODE",
        warning: false
      });

      this.hud.setFooterStatus?.({
        data: `DATA INGESTION STATUS: SECURE // TARGET CATALOG: ${targets.length} NODES ACTIVE // OBSERVED LC: ${realCount}`
      });

      this.hud.log(
        `Loaded ${targets.length} local exoplanet targets; ${realCount} have observed photometry overlays.`,
        "info"
      );

      this.renderTargetList(this.hud.getSearchQuery());

      return targets;
    } catch (error) {
      this.targets = this.data.getEmbeddedFallback();

      const realCount = this.targets.filter(target => target.lightcurve_available).length;

      this.hud.setStatus({
        data: "EMBEDDED FALLBACK",
        tap: "CACHE ERROR",
        warning: true
      });

      this.hud.setFooterStatus?.({
        data: `DATA INGESTION STATUS: DEGRADED // TARGET CATALOG: ${this.targets.length} EMBEDDED NODES ACTIVE // OBSERVED LC: ${realCount}`
      });

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

    this.hud.setStatus({
      tap: "QUERYING",
      data: "NASA TAP",
      warning: false
    });

    this.hud.setFooterStatus?.({
      data: "DATA INGESTION STATUS: LIVE TAP QUERY RUNNING // TARGET CATALOG: HOLDING"
    });

    this.hud.log(
      "Browser TAP query dispatched. On GitHub Pages, the static Colab-generated cache remains the reliable observed-photometry path.",
      "info"
    );

    try {
      const targets = await this.data.queryTap(adql);
      this.targets = targets;

      const realCount = targets.filter(target => target.lightcurve_available).length;

      this.hud.setStatus({
        tap: "LIVE TAP OK",
        data: "NASA TAP",
        warning: false
      });

      this.hud.setFooterStatus?.({
        data: `DATA INGESTION STATUS: LIVE TAP SECURE // TARGET CATALOG: ${targets.length} NODES ACTIVE // OBSERVED LC: ${realCount}`
      });

      this.hud.log(
        `TAP query returned ${targets.length} normalized targets. Live TAP rows do not automatically include local observed-light-curve flags.`,
        "info"
      );

      this.renderTargetList("");
      this.hud.setSearchQuery("");

      if (targets.length > 0) {
        await this.selectTarget(targets[0]);
      }
    } catch (error) {
      this.hud.setStatus({
        tap: "CORS WALL",
        data: "LOCAL CACHE",
        warning: true
      });

      this.hud.setFooterStatus?.({
        data: "DATA INGESTION STATUS: TAP WALL DETECTED // LOCAL STATIC CACHE ENGAGED"
      });

      this.hud.flashTapWarning("TAP TIMEOUT / CORS WALL DETECTED");

      this.hud.log(
        `Browser TAP failed: ${error.message}. Reloading the static NASA/MAST cache.`,
        "warn"
      );

      const fallback = await this.loadCache(true);
      const firstRealTarget =
        fallback.find(target => target.lightcurve_available) ||
        fallback[0];

      if (firstRealTarget) {
        await this.selectTarget(firstRealTarget);
      }
    }
  }

  renderTargetList(query = "") {
    const filtered = this.data.filterTargets(this.targets, query);
    this.hud.renderTargets(filtered, this.target);
    this.hud.setTargetCount(filtered.length, this.targets.length);
  }

  async selectTarget(target) {
    this.target = target;
    this.params = mergeTargetIntoParams(this.params, target);

    this.orbitPhase = INITIAL_ORBIT_PHASE;
    this.transitPhase = 0;
    this.epoch = 0;

    this.systemState = this.physics.evaluateAtOrbitPhase(
      this.orbitPhase,
      this.params,
      this.epoch,
      { includeVisual: true }
    );

    this.transitPhase = this.systemState.transitPhase;

    this.observedCurve = [];
    this.lastObservationTargetId = target?.id || "";

    this.hud.setActiveTarget(target);
    this.hud.setControls(this.params);
    this.hud.renderDossier(deriveDossier(target, this.params));

    this.hud.setObservationState?.(
      target.lightcurve_available ? "LOADING OBSERVED LC" : "MODEL ONLY",
      0
    );

    this.hud.log(
      `Target lock: ${target.pl_name || "Unknown planet"} around ${target.hostname || "unknown host"}.`,
      "info"
    );

    if (target?.lc_source || target?.lc_processing || finiteNumber(target?.lc_phase_shift_applied) !== null) {
      this.hud.log(
        `Observed LC provenance: ${target.lc_source || "local JSON"} | preprocessing shift ${signedMaybe(target.lc_phase_shift_applied)} | points ${finiteNumber(target.lc_points_count, null) ?? "—"}.`,
        "info"
      );
    }

    this.recompute(true);

    if (!target.lightcurve_available) {
      this.observedCurve = [];

      this.hud.setObservationState?.("NO LOCAL LC", 0);
      this.syncKernelObservation("MISSING");

      this.hud.log(
        `Target has no local observed light-curve JSON yet: ${target.lightcurve_file}.`,
        "warn"
      );

      this.renderPhotometry();
      return;
    }

    try {
      const observed = await this.data.loadLightCurve(target);

      if ((target?.id || "") !== this.lastObservationTargetId) {
        return;
      }

      this.observedCurve = observed;

      this.hud.setObservationState?.("OBSERVED LC ONLINE", observed.length);
      this.syncKernelObservation("ONLINE");

      this.hud.log(
        `Loaded ${observed.length} observed photometric samples from ${target.lightcurve_file}.`,
        "info"
      );

      this.renderPhotometry();
    } catch (error) {
      if ((target?.id || "") !== this.lastObservationTargetId) {
        return;
      }

      this.observedCurve = [];

      this.hud.setObservationState?.("LC 404/MISSING", 0);
      this.syncKernelObservation("MISSING");

      this.hud.log(
        `Could not load ${target.lightcurve_file}: ${error.message}`,
        "error"
      );

      this.renderPhotometry();
    }
  }

  updateParams(nextParams, recomputeCurve) {
    this.params = { ...this.params, ...nextParams };

    this.systemState = this.physics.evaluateAtOrbitPhase(
      this.orbitPhase,
      this.params,
      this.epoch,
      { includeVisual: true }
    );

    this.transitPhase = this.systemState.transitPhase;

    this.syncKernelObservation(this.observedCurve.length ? "ONLINE" : "MISSING");
    this.hud.renderDossier(deriveDossier(this.target, this.params));

    if (recomputeCurve) {
      this.recompute(false);
    }
  }

  resetControls() {
    const base = createDefaultParams();

    this.params = this.target
      ? mergeTargetIntoParams(base, this.target)
      : base;

    this.orbitPhase = INITIAL_ORBIT_PHASE;
    this.transitPhase = 0;
    this.epoch = 0;

    this.systemState = this.physics.evaluateAtOrbitPhase(
      this.orbitPhase,
      this.params,
      this.epoch,
      { includeVisual: true }
    );

    this.transitPhase = this.systemState.transitPhase;

    this.hud.setControls(this.params);
    this.hud.renderDossier(deriveDossier(this.target, this.params));
    this.hud.log("Control matrix reset to target-calibrated defaults.", "info");

    this.recompute(true);
  }

  recompute(force) {
    const hash = this.hashParams(this.params);

    if (!force && hash === this.lastCurveHash) {
      this.renderPhotometry();
      return;
    }

    this.lastCurveHash = hash;

    this.modelCurve = this.physics.generateLightCurve({
      params: this.params,
      phaseMin: CURVE_PHASE_MIN,
      phaseMax: CURVE_PHASE_MAX,
      points: CURVE_POINTS,
      epoch: this.epoch
    });

    this.renderPhotometry();
  }

  renderPhotometry() {
    const summary = this.physics.summarizeCurve(this.modelCurve);

    this.hud.renderLightCurve(this.modelCurve, summary, this.observedCurve);
    this.hud.setFluxSummary(summary);
    this.scene.setCurveSummary(summary);

    this.syncKernelObservation(this.observedCurve.length ? "ONLINE" : "MISSING");
  }

  syncKernelObservation(observation) {
    this.hud.setKernel({
      rings: 82,
      azimuth: 150,
      samples: 12300,
      moon: !!this.params.moonEnabled,
      spot: !!this.params.spotEnabled,
      observation
    });
  }

  loop(time) {
    if (!this.running) {
      return;
    }

    const dt = Math.min(0.05, Math.max(0, (time - this.lastFrame) / 1000 || 0));
    this.lastFrame = time;

    const previousOrbitPhase = this.orbitPhase;

    this.orbitPhase = wrap01(
      this.orbitPhase + dt * ORBIT_RATE_REV_PER_SECOND
    );

    if (this.orbitPhase < previousOrbitPhase) {
      this.epoch += 1;
      this.recompute(true);
    }

    const state = this.physics.evaluateAtOrbitPhase(
      this.orbitPhase,
      this.params,
      this.epoch,
      { includeVisual: true }
    );

    this.systemState = state;
    this.transitPhase = state.transitPhase;

    const fps = this.scene.getFPS();

    this.hud.setSceneReadouts({
      phase: state.transitPhase,
      impact: state.impact,
      depthPpm: state.depthPpm,
      moon: this.params.moonEnabled ? state.moon.label : "DISABLED",
      fps
    });

    this.hud.setFooterStatus?.({ fps });

    this.scene.render({
      time: time * 0.001,
      phase: state.transitPhase,
      visualPhase: state.rawOrbitPhase,
      params: this.params,
      sample: state,
      moonState: state.moon,
      target: this.target,
      systemState: state
    });

    if (time - this.lastRenderTick > 240) {
      this.lastRenderTick = time;
      this.hud.markCurvePhase(state.transitPhase);
    }

    requestAnimationFrame(next => this.loop(next));
  }

  hashParams(p) {
    return [
      p.rpRs,
      p.aRs,
      p.inclinationDeg,
      p.periodDays,
      p.eccentricity,
      p.u1,
      p.u2,
      p.moonEnabled,
      p.moonRadius,
      p.moonDistance,
      p.moonPhaseDeg,
      p.moonInclinationDeg,
      p.moonNodeDeg,
      p.moonAngularRate,
      p.spotEnabled,
      p.spotX,
      p.spotY,
      p.spotRadius,
      p.spotContrast,
      p.ttvEnabled,
      p.ttvAmplitude,
      p.ttvPeriodEpochs
    ]
      .map(value => typeof value === "number" ? value.toFixed(7) : String(value))
      .join("|");
  }
}

function wrap01(value) {
  let phase = Number(value) || 0;
  phase %= 1;

  if (phase < 0) {
    phase += 1;
  }

  return phase;
}

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function signedMaybe(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "—";
  }

  return `${number >= 0 ? "+" : ""}${number.toFixed(5)}`;
}

function start() {
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

    hud.setFooterStatus?.({
      fps: "--",
      data: "DATA INGESTION STATUS: BOOT FAILURE // TARGET CATALOG: OFFLINE"
    });

    console.error(error);
  });

  if (new URLSearchParams(window.location.search).has("debug")) {
    window.__EXOINTEL_DEBUG__ = app;
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
