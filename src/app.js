import { DataOrchestrator, DEFAULT_ADQL } from "./dataOrchestrator.js";
import { TransitPhysicsEngine, createDefaultParams, deriveDossier, mergeTargetIntoParams } from "./physics.js";
import { ObservatoryScene } from "./scene.js";
import { PrimeHUD } from "./ui.js";

const APP_VERSION = "ExoIntel-Prime Iteration VI Orbit-Synchronised Observatory";
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

    this.visualOrbitPhase = INITIAL_ORBIT_PHASE;
    this.transitPhase = orbitPhaseToTransitPhase(this.visualOrbitPhase);
    this.epoch = 0;

    this.running = false;
    this.lastFrame = 0;
    this.lastCurveHash = "";
    this.lastRenderTick = 0;
    this.lastObservationTargetId = "";

    const urlParams = new URLSearchParams(window.location.search);

    this.sceneMode = urlParams.get("orbit") === "window"
      ? "transit-window"
      : "full-orbit-sync";

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
      tap: "CACHE-FIRST",
      warning: false
    });

    this.hud.setFooterStatus?.({
      fps: "--",
      data: "DATA INGESTION STATUS: INITIALISING // TARGET CATALOG: AWAITING CACHE"
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

    if (this.sceneMode === "full-orbit-sync") {
      this.hud.log(
        "Scene timing mode: FULL-ORBIT SYNC. The planet completes a full orbit; the light-curve phase is derived from the same orbital clock.",
        "info"
      );
    } else {
      this.hud.log(
        "Scene timing mode: TRANSIT-WINDOW. The 3D scene is zoomed into the transit chord only.",
        "warn"
      );
    }

    try {
      await this.scene.init();
      this.hud.setStatus({ render: "WEBGL ONLINE" });
      this.hud.log(
        "WebGL scene online with full-orbit phase, front/back ordering, and transit-synchronised photometry.",
        "info"
      );
    } catch (error) {
      this.hud.setStatus({ render: "CANVAS SAFE MODE" });
      this.hud.log(`WebGL initialization degraded: ${error.message}`, "warn");
    }

    await this.loadCache(true);

    const firstRealTarget = this.targets.find(target => target.lightcurve_available) || this.targets[0];

    if (firstRealTarget) {
      await this.selectTarget(firstRealTarget);
    } else {
      this.recompute(true);
      this.hud.renderDossier(deriveDossier(null, this.params));
      this.hud.setObservationState?.("NO TARGET", 0);
    }

    this.running = true;
    this.hud.setStatus({ runtime: "ONLINE" });

    requestAnimationFrame(time => this.loop(time));
  }

  async loadCache(force) {
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
        data: `DATA INGESTION STATUS: SECURE // TARGET CATALOG: ${targets.length} NODES ACTIVE // REAL LC: ${realCount}`
      });

      this.hud.log(
        `Loaded ${targets.length} local exoplanet targets; ${realCount} have real local light curves.`,
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
        data: `DATA INGESTION STATUS: DEGRADED // TARGET CATALOG: ${this.targets.length} EMBEDDED NODES ACTIVE // REAL LC: ${realCount}`
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
      "Browser TAP query dispatched. On GitHub Pages, the static Colab-generated cache remains the reliable data path.",
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
        data: `DATA INGESTION STATUS: LIVE TAP SECURE // TARGET CATALOG: ${targets.length} NODES ACTIVE // REAL LC: ${realCount}`
      });

      this.hud.log(
        `TAP query returned ${targets.length} normalized targets. Live TAP rows do not include local MAST light-curve flags unless the static JSON cache is used.`,
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
      const firstRealTarget = fallback.find(target => target.lightcurve_available) || fallback[0];

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

    this.visualOrbitPhase = INITIAL_ORBIT_PHASE;
    this.transitPhase = orbitPhaseToTransitPhase(this.visualOrbitPhase);
    this.epoch = 0;

    this.observedCurve = [];
    this.lastObservationTargetId = target?.id || "";

    this.hud.setActiveTarget(target);
    this.hud.setControls(this.params);
    this.hud.renderDossier(deriveDossier(target, this.params));
    this.hud.setObservationState?.(target.lightcurve_available ? "LOADING REAL LC" : "MODEL ONLY", 0);

    this.hud.log(
      `Target lock: ${target.pl_name || "Unknown planet"} around ${target.hostname || "unknown host"}.`,
      "info"
    );

    this.recompute(true);

    if (!target.lightcurve_available) {
      this.observedCurve = [];

      this.hud.setObservationState?.("NO LOCAL LC", 0);

      this.hud.setKernel({
        rings: 82,
        azimuth: 150,
        samples: 12300,
        moon: !!this.params.moonEnabled,
        spot: !!this.params.spotEnabled,
        observation: "MISSING"
      });

      this.hud.log(`Target has no local real light-curve JSON yet: ${target.lightcurve_file}.`, "warn");
      this.renderPhotometry();

      return;
    }

    try {
      const observed = await this.data.loadLightCurve(target);

      if ((target?.id || "") !== this.lastObservationTargetId) {
        return;
      }

      this.observedCurve = observed;

      this.hud.setObservationState?.("REAL LC ONLINE", observed.length);

      this.hud.setKernel({
        rings: 82,
        azimuth: 150,
        samples: 12300,
        moon: !!this.params.moonEnabled,
        spot: !!this.params.spotEnabled,
        observation: "ONLINE"
      });

      this.hud.log(`Loaded ${observed.length} real photometric samples from ${target.lightcurve_file}.`, "info");

      this.renderPhotometry();
    } catch (error) {
      if ((target?.id || "") !== this.lastObservationTargetId) {
        return;
      }

      this.observedCurve = [];

      this.hud.setObservationState?.("LC 404/MISSING", 0);

      this.hud.setKernel({
        rings: 82,
        azimuth: 150,
        samples: 12300,
        moon: !!this.params.moonEnabled,
        spot: !!this.params.spotEnabled,
        observation: "MISSING"
      });

      this.hud.log(`Could not load ${target.lightcurve_file}: ${error.message}`, "error");

      this.renderPhotometry();
    }
  }

  updateParams(nextParams, recomputeCurve) {
    this.params = { ...this.params, ...nextParams };

    this.hud.setKernel({
      rings: 82,
      azimuth: 150,
      samples: 12300,
      moon: !!this.params.moonEnabled,
      spot: !!this.params.spotEnabled,
      observation: this.observedCurve.length ? "ONLINE" : "MISSING"
    });

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

    this.visualOrbitPhase = INITIAL_ORBIT_PHASE;
    this.transitPhase = orbitPhaseToTransitPhase(this.visualOrbitPhase);
    this.epoch = 0;

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
  }

  loop(time) {
    if (!this.running) {
      return;
    }

    const dt = Math.min(0.05, Math.max(0, (time - this.lastFrame) / 1000 || 0));
    this.lastFrame = time;

    const previousOrbitPhase = this.visualOrbitPhase;

    this.visualOrbitPhase = wrap01(
      this.visualOrbitPhase + dt * ORBIT_RATE_REV_PER_SECOND
    );

    if (this.visualOrbitPhase < previousOrbitPhase) {
      this.epoch += 1;
    }

    const orbitDerivedTransitPhase = orbitPhaseToTransitPhase(this.visualOrbitPhase);
    const shiftedTransitPhase = this.physics.applyTTV(
      orbitDerivedTransitPhase,
      this.params,
      this.epoch
    );

    this.transitPhase = shiftedTransitPhase;

    const visualPhaseForScene = this.sceneMode === "transit-window"
      ? shiftedTransitPhase
      : this.visualOrbitPhase;

    const sample = this.physics.evaluateAtPhase(
      shiftedTransitPhase,
      this.params,
      this.epoch
    );

    const moonState = this.physics.computeMoonState(
      shiftedTransitPhase,
      this.params
    );

    const impact = this.physics.computeImpactParameter(this.params);
    const fps = this.scene.getFPS();

    this.hud.setSceneReadouts({
      phase: shiftedTransitPhase,
      impact,
      depthPpm: sample.depthPpm,
      moon: this.params.moonEnabled ? moonState.label : "DISABLED",
      fps
    });

    this.hud.setFooterStatus?.({ fps });

    this.scene.render({
      time: time * 0.001,
      phase: shiftedTransitPhase,
      visualPhase: visualPhaseForScene,
      params: this.params,
      sample,
      moonState,
      target: this.target
    });

    if (time - this.lastRenderTick > 240) {
      this.lastRenderTick = time;
      this.hud.markCurvePhase(shiftedTransitPhase);
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
      p.spotEnabled,
      p.spotX,
      p.spotY,
      p.spotRadius,
      p.spotContrast,
      p.ttvEnabled,
      p.ttvAmplitude,
      p.ttvPeriodEpochs
    ]
      .map(value => typeof value === "number" ? value.toFixed(6) : String(value))
      .join("|");
  }
}

function wrap01(value) {
  return ((value % 1) + 1) % 1;
}

function orbitPhaseToTransitPhase(orbitPhase) {
  const phase = wrap01(orbitPhase);

  if (phase > 0.5) {
    return phase - 1.0;
  }

  return phase;
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

    hud.setFooterStatus?.({
      fps: "--",
      data: "DATA INGESTION STATUS: BOOT FAILURE // TARGET CATALOG: OFFLINE"
    });

    console.error(error);
  });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
