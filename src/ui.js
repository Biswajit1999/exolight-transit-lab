export class PrimeHUD {
  constructor() {
    this.$ = id => document.getElementById(id);
    this.callbacks = {};
    this.logLines = [];
    this.lastTargets = [];
    this.activeTarget = null;
    this.phaseMarker = null;
    this.cachedModelCurve = [];
    this.cachedObservedCurve = [];
    this.cachedSummary = null;
    this.observationSignature = "";
    this.observationAlpha = 1;
    this.observationFadeFrame = null;
    this.lightcurveCanvas = this.$("lightcurve-canvas");
    this.lightcurveContext = this.lightcurveCanvas ? this.lightcurveCanvas.getContext("2d") : null;
    this.diagnosticNodes = {};
    this.lastDiagnostics = null;
    this.liveReadouts = {
      orbitPhase: null,
      transitPhase: null,
      totalDepthPpm: null,
      planetDepthPpm: null,
      moonDepthPpm: null,
      spotBoostPpm: null,
      flux: null,
      impact: null,
      moon: "DISABLED",
      fps: null
    };

    this.controls = {
      rpRs: this.$("control-rp-rs"),
      aRs: this.$("control-a-rs"),
      inclinationDeg: this.$("control-inclination"),
      periodDays: this.$("control-period"),
      eccentricity: this.$("control-eccentricity"),
      u1: this.$("control-u1"),
      u2: this.$("control-u2"),
      moonEnabled: this.$("control-moon-enabled"),
      moonRadius: this.$("control-moon-radius"),
      moonDistance: this.$("control-moon-distance"),
      moonPhaseDeg: this.$("control-moon-phase"),
      moonInclinationDeg: this.$("control-moon-inclination"),
      moonNodeDeg: this.$("control-moon-node"),
      spotEnabled: this.$("control-spot-enabled"),
      spotX: this.$("control-spot-x"),
      spotY: this.$("control-spot-y"),
      spotRadius: this.$("control-spot-radius"),
      spotContrast: this.$("control-spot-contrast"),
      ttvEnabled: this.$("control-ttv-enabled"),
      ttvAmplitude: this.$("control-ttv-amplitude"),
      ttvPeriodEpochs: this.$("control-ttv-period")
    };

    this.outputs = {
      rpRs: this.$("output-rp-rs"),
      aRs: this.$("output-a-rs"),
      inclinationDeg: this.$("output-inclination"),
      periodDays: this.$("output-period"),
      eccentricity: this.$("output-eccentricity"),
      u1: this.$("output-u1"),
      u2: this.$("output-u2"),
      moonRadius: this.$("output-moon-radius"),
      moonDistance: this.$("output-moon-distance"),
      moonPhaseDeg: this.$("output-moon-phase"),
      moonInclinationDeg: this.$("output-moon-inclination"),
      moonNodeDeg: this.$("output-moon-node"),
      spotX: this.$("output-spot-x"),
      spotY: this.$("output-spot-y"),
      spotRadius: this.$("output-spot-radius"),
      spotContrast: this.$("output-spot-contrast"),
      ttvAmplitude: this.$("output-ttv-amplitude"),
      ttvPeriodEpochs: this.$("output-ttv-period")
    };
  }

  bind(callbacks = {}) {
    this.callbacks = callbacks;
    this.ensureDiagnosticsPanel();

    const search = this.$("target-search");
    const reload = this.$("cache-reload-button");
    const reset = this.$("reset-controls-button");
    const tapRun = this.$("tap-run-button");
    const tapCache = this.$("tap-cache-button");
    const tapExpand = this.$("tap-expand-button");

    if (search) {
      search.addEventListener("input", () => {
        if (this.callbacks.onSearch) this.callbacks.onSearch(search.value);
      });
    }

    if (reload) {
      reload.addEventListener("click", () => {
        if (this.callbacks.onCacheLoad) this.callbacks.onCacheLoad();
      });
    }

    if (reset) {
      reset.addEventListener("click", () => {
        if (this.callbacks.onReset) this.callbacks.onReset();
      });
    }

    if (tapRun) {
      tapRun.addEventListener("click", () => {
        if (this.callbacks.onTapRun) this.callbacks.onTapRun();
      });
    }

    if (tapCache) {
      tapCache.addEventListener("click", () => {
        if (this.callbacks.onCacheLoad) this.callbacks.onCacheLoad();
      });
    }

    if (tapExpand) {
      tapExpand.addEventListener("click", () => {
        const panel = this.$("tap-panel");
        const expanded = !panel.classList.contains("expanded");
        if (this.callbacks.onConsoleToggle) this.callbacks.onConsoleToggle(expanded);
      });
    }

    Object.entries(this.controls).forEach(([key, input]) => {
      if (!input) return;

      const eventName = input.type === "checkbox" ? "change" : "input";

      input.addEventListener(eventName, () => {
        this.syncOutputsFromInputs();

        if (this.callbacks.onControlsChange) {
          this.callbacks.onControlsChange(this.readControls());
        }

        this.updateDiagnostics();
      });
    });

    window.addEventListener("resize", () => {
      if (this.cachedModelCurve.length || this.cachedObservedCurve.length) {
        this.drawPhotometryFrame(this.phaseMarker);
      }
    }, { passive: true });
  }

  ensureDiagnosticsPanel() {
    if (this.$("diagnostic-period")) return;

    const kernelPanel = this.$("kernel-samples")?.closest(".compact-panel");
    const kernelTable = kernelPanel?.querySelector(".telemetry-table");

    if (!kernelPanel || !kernelTable) return;

    const section = document.createElement("div");
    section.className = "research-diagnostics";
    section.innerHTML = `
      <div class="diagnostics-title">
        <strong>Coupled Physics Diagnostics</strong>
        <span>scene · model · marker use one state vector</span>
      </div>
      <div class="diagnostics-grid">
        <div><span>Live Orbit Phase</span><strong id="diagnostic-live-orbit">—</strong></div>
        <div><span>Live Transit Phase</span><strong id="diagnostic-live-transit">—</strong></div>
        <div><span>Live Flux</span><strong id="diagnostic-live-flux">—</strong></div>
        <div><span>Total Depth</span><strong id="diagnostic-live-depth">—</strong></div>
        <div><span>Planet Depth</span><strong id="diagnostic-planet-depth">—</strong></div>
        <div><span>Moon Depth</span><strong id="diagnostic-moon-depth">—</strong></div>
        <div><span>Spot Boost</span><strong id="diagnostic-spot-boost">—</strong></div>
        <div><span>Geometry Source</span><strong id="diagnostic-state-source">physics.js state</strong></div>

        <div><span>Period</span><strong id="diagnostic-period">—</strong></div>
        <div><span>Transit Duration</span><strong id="diagnostic-duration">—</strong></div>
        <div><span>Duration Phase</span><strong id="diagnostic-duration-phase">—</strong></div>
        <div><span>Observed Min Phase</span><strong id="diagnostic-observed-min">—</strong></div>
        <div><span>Model Min Phase</span><strong id="diagnostic-model-min">—</strong></div>
        <div><span>Observed Phase Offset</span><strong id="diagnostic-phase-offset">—</strong></div>
        <div><span>OOT Scatter</span><strong id="diagnostic-oot-scatter">—</strong></div>
        <div><span>Residual Scatter</span><strong id="diagnostic-residual-scatter">—</strong></div>
        <div><span>Secondary Feature</span><strong id="diagnostic-secondary">—</strong></div>
        <div><span>Secondary Phase</span><strong id="diagnostic-secondary-phase">—</strong></div>
        <div><span>Star System</span><strong id="diagnostic-star-system">—</strong></div>
        <div><span>Planet System</span><strong id="diagnostic-planet-system">—</strong></div>
        <div><span>LC Points</span><strong id="diagnostic-lc-points">—</strong></div>
        <div><span>Saved Phase Window</span><strong id="diagnostic-lc-phase-window">—</strong></div>
        <div><span>Colab Phase Shift</span><strong id="diagnostic-lc-clean-shift">—</strong></div>
        <div><span>LC Schema</span><strong id="diagnostic-lc-schema">—</strong></div>
        <div><span>Max Moon Signal</span><strong id="diagnostic-max-moon-signal">—</strong></div>
        <div><span>Max Spot Signal</span><strong id="diagnostic-max-spot-signal">—</strong></div>
        <div class="diagnostic-wide"><span>Processing Provenance</span><strong id="diagnostic-lc-processing">—</strong></div>
        <div class="diagnostic-wide"><span>Exomoon Status</span><strong id="diagnostic-exomoon-status">simulation only unless externally confirmed</strong></div>
      </div>
    `;

    kernelTable.insertAdjacentElement("afterend", section);

    const style = document.createElement("style");
    style.textContent = `
      .research-diagnostics{
        margin:0 8px 8px;
        padding:8px;
        border:1px solid rgba(0,240,255,.12);
        background:
          linear-gradient(135deg,rgba(0,240,255,.055),transparent 60%),
          rgba(0,0,0,.28);
      }

      .diagnostics-title{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:8px;
        margin-bottom:6px;
        padding-bottom:6px;
        border-bottom:1px solid rgba(255,255,255,.06);
      }

      .diagnostics-title strong{
        color:#e8f7ff;
        font-size:9px;
        letter-spacing:.06em;
        text-transform:uppercase;
      }

      .diagnostics-title span{
        overflow:hidden;
        color:#7d8993;
        font-size:8px;
        white-space:nowrap;
        text-overflow:ellipsis;
        text-transform:uppercase;
      }

      .diagnostics-grid{
        display:grid;
        grid-template-columns:repeat(2,minmax(0,1fr));
        gap:5px;
      }

      .diagnostics-grid div{
        min-height:32px;
        padding:5px 6px;
        display:flex;
        flex-direction:column;
        justify-content:space-between;
        border:1px solid rgba(255,255,255,.055);
        background:rgba(0,0,0,.22);
      }

      .diagnostics-grid .diagnostic-wide{
        grid-column:1 / -1;
      }

      .diagnostics-grid span{
        color:#7d8993;
        font-size:8px;
        line-height:1;
        text-transform:uppercase;
      }

      .diagnostics-grid strong{
        overflow:hidden;
        color:#00f0ff;
        font-size:9px;
        line-height:1.15;
        white-space:nowrap;
        text-overflow:ellipsis;
        text-shadow:0 0 8px rgba(0,240,255,.22);
      }

      .diagnostics-grid strong.warn{
        color:#ffb000;
        text-shadow:0 0 8px rgba(255,176,0,.22);
      }

      .diagnostics-grid strong.bad{
        color:#ff3149;
        text-shadow:0 0 8px rgba(255,49,73,.22);
      }

      .diagnostics-grid strong.good{
        color:#63ff9f;
        text-shadow:0 0 8px rgba(99,255,159,.20);
      }

      .diagnostics-grid strong.provenance{
        color:#ffd078;
        text-shadow:0 0 8px rgba(255,176,0,.18);
      }
    `;

    document.head.appendChild(style);

    this.diagnosticNodes = {
      liveOrbit: this.$("diagnostic-live-orbit"),
      liveTransit: this.$("diagnostic-live-transit"),
      liveFlux: this.$("diagnostic-live-flux"),
      liveDepth: this.$("diagnostic-live-depth"),
      planetDepth: this.$("diagnostic-planet-depth"),
      moonDepth: this.$("diagnostic-moon-depth"),
      spotBoost: this.$("diagnostic-spot-boost"),
      stateSource: this.$("diagnostic-state-source"),

      period: this.$("diagnostic-period"),
      duration: this.$("diagnostic-duration"),
      durationPhase: this.$("diagnostic-duration-phase"),
      observedMin: this.$("diagnostic-observed-min"),
      modelMin: this.$("diagnostic-model-min"),
      phaseOffset: this.$("diagnostic-phase-offset"),
      ootScatter: this.$("diagnostic-oot-scatter"),
      residualScatter: this.$("diagnostic-residual-scatter"),
      secondary: this.$("diagnostic-secondary"),
      secondaryPhase: this.$("diagnostic-secondary-phase"),
      starSystem: this.$("diagnostic-star-system"),
      planetSystem: this.$("diagnostic-planet-system"),
      lcPoints: this.$("diagnostic-lc-points"),
      lcPhaseWindow: this.$("diagnostic-lc-phase-window"),
      lcCleanShift: this.$("diagnostic-lc-clean-shift"),
      lcSchema: this.$("diagnostic-lc-schema"),
      maxMoonSignal: this.$("diagnostic-max-moon-signal"),
      maxSpotSignal: this.$("diagnostic-max-spot-signal"),
      lcProcessing: this.$("diagnostic-lc-processing"),
      exomoonStatus: this.$("diagnostic-exomoon-status")
    };
  }

  readControls() {
    return {
      rpRs: num(this.controls.rpRs, 0.1),
      aRs: num(this.controls.aRs, 12),
      inclinationDeg: num(this.controls.inclinationDeg, 88.5),
      periodDays: num(this.controls.periodDays, 4),
      eccentricity: num(this.controls.eccentricity, 0),
      u1: num(this.controls.u1, 0.32),
      u2: num(this.controls.u2, 0.28),
      moonEnabled: checked(this.controls.moonEnabled),
      moonRadius: num(this.controls.moonRadius, 0.025),
      moonDistance: num(this.controls.moonDistance, 0.55),
      moonPhaseDeg: num(this.controls.moonPhaseDeg, 45),
      moonInclinationDeg: num(this.controls.moonInclinationDeg, 12),
      moonNodeDeg: num(this.controls.moonNodeDeg, 35),
      spotEnabled: checked(this.controls.spotEnabled),
      spotX: num(this.controls.spotX, 0.2),
      spotY: num(this.controls.spotY, 0.1),
      spotRadius: num(this.controls.spotRadius, 0.12),
      spotContrast: num(this.controls.spotContrast, 0.55),
      ttvEnabled: checked(this.controls.ttvEnabled),
      ttvAmplitude: num(this.controls.ttvAmplitude, 0.01),
      ttvPeriodEpochs: num(this.controls.ttvPeriodEpochs, 16)
    };
  }

  setControls(params = {}) {
    setInput(this.controls.rpRs, params.rpRs);
    setInput(this.controls.aRs, params.aRs);
    setInput(this.controls.inclinationDeg, params.inclinationDeg);
    setInput(this.controls.periodDays, params.periodDays);
    setInput(this.controls.eccentricity, params.eccentricity);
    setInput(this.controls.u1, params.u1);
    setInput(this.controls.u2, params.u2);
    setInput(this.controls.moonEnabled, params.moonEnabled);
    setInput(this.controls.moonRadius, params.moonRadius);
    setInput(this.controls.moonDistance, params.moonDistance);
    setInput(this.controls.moonPhaseDeg, params.moonPhaseDeg);
    setInput(this.controls.moonInclinationDeg, params.moonInclinationDeg);
    setInput(this.controls.moonNodeDeg, params.moonNodeDeg);
    setInput(this.controls.spotEnabled, params.spotEnabled);
    setInput(this.controls.spotX, params.spotX);
    setInput(this.controls.spotY, params.spotY);
    setInput(this.controls.spotRadius, params.spotRadius);
    setInput(this.controls.spotContrast, params.spotContrast);
    setInput(this.controls.ttvEnabled, params.ttvEnabled);
    setInput(this.controls.ttvAmplitude, params.ttvAmplitude);
    setInput(this.controls.ttvPeriodEpochs, params.ttvPeriodEpochs);
    this.syncOutputsFromInputs();
    this.updateDiagnostics();
  }

  syncOutputsFromInputs() {
    const p = this.readControls();

    setText(this.outputs.rpRs, fmt(p.rpRs, 3));
    setText(this.outputs.aRs, fmt(p.aRs, 1));
    setText(this.outputs.inclinationDeg, `${fmt(p.inclinationDeg, 2)}°`);
    setText(this.outputs.periodDays, `${fmt(p.periodDays, 1)} d`);
    setText(this.outputs.eccentricity, fmt(p.eccentricity, 2));
    setText(this.outputs.u1, fmt(p.u1, 2));
    setText(this.outputs.u2, fmt(p.u2, 2));
    setText(this.outputs.moonRadius, fmt(p.moonRadius, 3));
    setText(this.outputs.moonDistance, `${fmt(p.moonDistance, 2)} R*`);
    setText(this.outputs.moonPhaseDeg, `${Math.round(p.moonPhaseDeg)}°`);
    setText(this.outputs.moonInclinationDeg, `${Math.round(p.moonInclinationDeg)}°`);
    setText(this.outputs.moonNodeDeg, `${Math.round(p.moonNodeDeg)}°`);
    setText(this.outputs.spotX, fmt(p.spotX, 2));
    setText(this.outputs.spotY, fmt(p.spotY, 2));
    setText(this.outputs.spotRadius, fmt(p.spotRadius, 2));
    setText(this.outputs.spotContrast, fmt(p.spotContrast, 2));
    setText(this.outputs.ttvAmplitude, `${fmt(p.ttvAmplitude, 3)} phase`);
    setText(this.outputs.ttvPeriodEpochs, `${Math.round(p.ttvPeriodEpochs)} epochs`);
  }

  setStatus(status = {}) {
    if (status.runtime !== undefined) setText(this.$("runtime-status"), status.runtime);
    if (status.data !== undefined) setText(this.$("data-link-status"), status.data);
    if (status.solver !== undefined) setText(this.$("solver-status"), status.solver);
    if (status.render !== undefined) setText(this.$("render-layer-status"), status.render);
    if (status.tap !== undefined) setText(this.$("tap-channel-status"), status.tap);

    const warningTile = this.$("tap-warning-tile");

    if (warningTile && status.warning !== undefined) {
      warningTile.classList.toggle("warning", !!status.warning);
    }
  }

  setFooterStatus(status = {}) {
    if (status.fps !== undefined) {
      const fps = Number(status.fps);
      setText(this.$("footer-fps"), Number.isFinite(fps) ? String(Math.round(fps)) : String(status.fps));
    }

    if (status.data !== undefined) {
      setText(this.$("footer-data-status"), status.data);
    }
  }

  setKernel(kernel = {}) {
    setText(this.$("kernel-rings"), integer(kernel.rings ?? 82));
    setText(this.$("kernel-azimuth"), integer(kernel.azimuth ?? 150));
    setText(this.$("kernel-samples"), comma(kernel.samples ?? 12300));
    setText(this.$("kernel-moon-state"), kernel.moon ? "ON" : "OFF");
    setText(this.$("kernel-spot-state"), kernel.spot ? "ON" : "OFF");

    if (kernel.observation !== undefined) {
      setText(this.$("kernel-observation-state"), kernel.observation);
    }

    this.updateDiagnostics();
  }

  setObservationState(state, count = 0) {
    const text = count > 0 ? `${state} · ${comma(count)} PTS` : state;
    setText(this.$("observation-status-chip"), text);
    setText(this.$("kernel-observation-state"), state);
  }

  setClock() {
    const now = new Date();
    const text = now.toISOString().slice(11, 19) + " UTC";
    const clock = this.$("utc-clock");

    if (clock) {
      clock.textContent = text;
      clock.setAttribute("datetime", now.toISOString());
    }
  }

  setAdql(query) {
    const editor = this.$("adql-editor");
    if (editor) editor.value = query || "";
  }

  getAdql() {
    return this.$("adql-editor")?.value || "";
  }

  getSearchQuery() {
    return this.$("target-search")?.value || "";
  }

  setSearchQuery(value) {
    const search = this.$("target-search");
    if (search) search.value = value || "";
  }

  setTapExpanded(expanded) {
    const panel = this.$("tap-panel");
    const button = this.$("tap-expand-button");

    if (!panel) return;

    panel.classList.toggle("expanded", !!expanded);
    setText(button, expanded ? "COLLAPSE" : "EXPAND");
  }

  flashTapWarning(message) {
    const tile = this.$("tap-warning-tile");
    setText(this.$("tap-channel-status"), message || "TAP WARNING");

    if (tile) {
      tile.classList.add("warning");
      clearTimeout(this._tapFlashTimer);
      this._tapFlashTimer = setTimeout(() => tile.classList.remove("warning"), 5200);
    }
  }

  setTargetCount(visible, total) {
    const text = total === undefined || visible === total ? comma(visible) : `${comma(visible)}/${comma(total)}`;
    setText(this.$("target-count-chip"), text);
  }

  setActiveTarget(target) {
    this.activeTarget = target || null;

    setText(this.$("data-link-status"), target?.source ? target.source.toUpperCase() : "LOCAL CACHE");
    setText(this.$("dossier-planet"), target?.pl_name || "—");
    setText(this.$("dossier-host"), target?.hostname || "—");

    const cards = document.querySelectorAll(".target-card");

    cards.forEach(card => {
      card.classList.toggle("active", target && card.dataset.id === target.id);
    });

    this.updateDiagnostics();
  }

  renderTargets(targets = [], activeTarget = null) {
    this.lastTargets = targets;
    this.activeTarget = activeTarget || this.activeTarget;

    const list = this.$("target-list");
    if (!list) return;

    const fragment = document.createDocumentFragment();

    if (!targets.length) {
      const empty = document.createElement("div");
      empty.className = "log-line warn";
      empty.innerHTML = "<strong>NO TARGETS</strong> Search returned no matching systems.";
      fragment.appendChild(empty);
    }

    targets.forEach(target => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "target-card";
      button.dataset.id = target.id || "";

      if (activeTarget && activeTarget.id === target.id) {
        button.classList.add("active");
      }

      const main = document.createElement("div");
      const titleRow = document.createElement("div");
      const title = document.createElement("strong");
      const badge = document.createElement("i");
      const meta = document.createElement("span");
      const depth = document.createElement("em");

      titleRow.className = "target-title-row";
      title.textContent = target.pl_name || "Unknown Planet";

      badge.className = target.lightcurve_available ? "lc-badge real" : "lc-badge model";
      badge.textContent = target.lightcurve_available ? "OBS LC" : "MODEL";

      meta.textContent = [
        target.hostname || "Unknown Host",
        finite(target.st_teff) ? `${Math.round(target.st_teff)} K` : "T_eff —",
        finite(target.pl_orbper) ? `${fmt(target.pl_orbper, 2)} d` : "P —",
        target.discoverymethod || "Transit"
      ].join(" · ");

      depth.textContent = finite(target.pl_trandep) ? `${Math.round(target.pl_trandep)} ppm` : "— ppm";

      titleRow.append(title, badge);
      main.append(titleRow, meta);
      button.append(main, depth);

      button.addEventListener("click", () => {
        this.activeTarget = target;
        this.setActiveTarget(target);

        if (this.callbacks.onTargetSelect) {
          this.callbacks.onTargetSelect(target);
        }
      });

      fragment.appendChild(button);
    });

    list.replaceChildren(fragment);
  }

  renderDossier(dossier = {}) {
    setText(this.$("dossier-lock-chip"), dossier.quality || "NO LOCK");
    setText(this.$("dossier-planet"), dossier.planet || "—");
    setText(this.$("dossier-host"), dossier.host || "—");
    setText(this.$("dossier-stellar-class"), dossier.stellarClass || "Unknown");
    setText(this.$("dossier-teff"), finite(dossier.teff) ? `${Math.round(dossier.teff)} K` : "— K");
    setText(this.$("dossier-a-rs"), finite(dossier.aRs) ? fmt(dossier.aRs, 2) : "—");
    setText(this.$("dossier-rp-rs"), finite(dossier.rpRs) ? fmt(dossier.rpRs, 4) : "—");
    setText(this.$("dossier-mp-ms"), finite(dossier.mpMs) ? sci(dossier.mpMs, 2) : "—");
    setText(this.$("dossier-transit-probability"), finite(dossier.transitProbability) ? `${fmt(dossier.transitProbability, 2)} %` : "— %");
    setText(this.$("dossier-hz-index"), finite(dossier.hzIndex) ? `${fmt(dossier.hzIndex, 3)} ${hzLabel(dossier.hzIndex)}` : "—");
    setText(this.$("dossier-ingress"), finite(dossier.ingressMinutes) ? `${fmt(dossier.ingressMinutes, 1)} min` : "— min");

    this.updateDiagnostics();
  }

  renderLightCurve(modelCurve = [], summary = {}, observedCurve = []) {
    this.cachedModelCurve = Array.isArray(modelCurve) ? modelCurve : [];
    this.cachedSummary = summary || {};

    const nextObserved = Array.isArray(observedCurve) ? observedCurve : [];
    const nextSignature = this.curveSignature(nextObserved);

    if (nextSignature !== this.observationSignature) {
      this.observationSignature = nextSignature;
      this.cachedObservedCurve = nextObserved;
      this.startObservationFade();
    } else {
      this.cachedObservedCurve = nextObserved;
      this.drawPhotometryFrame(this.phaseMarker);
    }

    this.updateDiagnostics();
  }

  startObservationFade() {
    if (this.observationFadeFrame) {
      cancelAnimationFrame(this.observationFadeFrame);
      this.observationFadeFrame = null;
    }

    const start = performance.now();
    const duration = 480;
    this.observationAlpha = this.cachedObservedCurve.length ? 0 : 1;

    const animate = now => {
      const t = Math.min(1, (now - start) / duration);
      this.observationAlpha = this.cachedObservedCurve.length ? easeOutCubic(t) : 1;
      this.drawPhotometryFrame(this.phaseMarker);

      if (t < 1) {
        this.observationFadeFrame = requestAnimationFrame(animate);
      } else {
        this.observationAlpha = 1;
        this.observationFadeFrame = null;
        this.drawPhotometryFrame(this.phaseMarker);
      }
    };

    this.observationFadeFrame = requestAnimationFrame(animate);
  }

  drawPhotometryFrame(markerPhase = null) {
    const canvas = this.lightcurveCanvas;
    const ctx = this.lightcurveContext;

    if (!canvas || !ctx) return;

    this.resizeCanvasToDisplay(canvas);

    const w = canvas.width;
    const h = canvas.height;
    const dpr = devicePixelRatioSafe();
    const pad = {
      left: Math.max(52 * dpr, w * 0.048),
      right: Math.max(18 * dpr, w * 0.018),
      top: Math.max(20 * dpr, h * 0.075),
      bottom: Math.max(38 * dpr, h * 0.15)
    };

    const model = this.cachedModelCurve;
    const observed = this.cachedObservedCurve;
    const allPoints = [...model, ...observed];

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#020303";
    ctx.fillRect(0, 0, w, h);
    this.drawGrid(ctx, w, h, pad);

    if (!allPoints.length) {
      ctx.fillStyle = "#7d8993";
      ctx.font = `${12 * dpr}px JetBrains Mono, monospace`;
      ctx.fillText("No photometric samples available", pad.left, h * 0.5);
      return;
    }

    const scale = this.computeCurveScale(model, observed);
    const xMap = phase => pad.left + (phase - scale.minPhase) / Math.max(1e-9, scale.maxPhase - scale.minPhase) * (w - pad.left - pad.right);
    const yMap = flux => pad.top + (scale.yMax - flux) / Math.max(1e-9, scale.yMax - scale.yMin) * (h - pad.top - pad.bottom);

    this.drawTransitBand(ctx, w, h, pad, xMap, model);

    if (observed.length) {
      this.drawObservedScatter(ctx, observed, xMap, yMap);
    } else {
      this.drawNoObservedDataNotice(ctx, w, h, pad);
    }

    this.drawModelLine(ctx, model, xMap, yMap);
    this.drawAxesLabels(ctx, w, h, pad, scale);

    if (markerPhase !== null && Number.isFinite(markerPhase)) {
      this.drawPhaseMarker(ctx, markerPhase, scale, pad, w, h);
    }
  }

  computeCurveScale(model, observed) {
    const phases = [];
    const fluxes = [];

    for (const point of model) {
      if (finite(point.phase)) phases.push(point.phase);
      if (finite(point.flux)) fluxes.push(point.flux);
    }

    for (const point of observed) {
      if (finite(point.phase)) phases.push(point.phase);
      if (finite(point.flux)) fluxes.push(point.flux);
    }

    const minPhase = phases.length ? Math.min(...phases) : -0.085;
    const maxPhase = phases.length ? Math.max(...phases) : 0.085;
    const minFluxRaw = fluxes.length ? Math.min(...fluxes) : 0.99;
    const maxFluxRaw = fluxes.length ? Math.max(...fluxes) : 1.001;
    const fluxSpan = Math.max(0.0004, maxFluxRaw - minFluxRaw);
    const yMin = Math.min(0.999, minFluxRaw - fluxSpan * 0.18);
    const yMax = Math.max(1.0002, maxFluxRaw + fluxSpan * 0.15);

    return { minPhase, maxPhase, yMin, yMax };
  }

  drawGrid(ctx, w, h, pad) {
    const dpr = devicePixelRatioSafe();

    ctx.save();
    ctx.strokeStyle = "rgba(0,240,255,.12)";
    ctx.lineWidth = 1 * dpr;

    for (let i = 0; i <= 10; i++) {
      const x = pad.left + i / 10 * (w - pad.left - pad.right);
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, h - pad.bottom);
      ctx.stroke();
    }

    for (let i = 0; i <= 6; i++) {
      const y = pad.top + i / 6 * (h - pad.top - pad.bottom);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(255,255,255,.18)";
    ctx.strokeRect(pad.left, pad.top, w - pad.left - pad.right, h - pad.top - pad.bottom);
    ctx.restore();
  }

  drawObservedScatter(ctx, observed, xMap, yMap) {
    if (!observed.length) return;

    const dpr = devicePixelRatioSafe();
    const radius = Math.max(1.05, 1.35 * dpr);
    const alpha = clamp(this.observationAlpha, 0, 1);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "rgba(0, 240, 255, 0.45)";
    ctx.shadowColor = "rgba(0,240,255,.18)";
    ctx.shadowBlur = 4 * dpr;

    for (const point of observed) {
      if (!finite(point.phase) || !finite(point.flux)) continue;

      const x = xMap(point.phase);
      const y = yMap(point.flux);

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  drawNoObservedDataNotice(ctx, w, h, pad) {
    const dpr = devicePixelRatioSafe();
    const x = pad.left + 12 * dpr;
    const y = pad.top + 16 * dpr;

    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.42)";
    ctx.strokeStyle = "rgba(255,176,0,.25)";
    ctx.lineWidth = 1 * dpr;
    ctx.fillRect(x, y, 390 * dpr, 34 * dpr);
    ctx.strokeRect(x, y, 390 * dpr, 34 * dpr);
    ctx.fillStyle = "#ffb000";
    ctx.font = `${10 * dpr}px JetBrains Mono, monospace`;
    ctx.fillText("NO LOCAL OBSERVED LIGHT CURVE FOR THIS TARGET", x + 10 * dpr, y + 14 * dpr);
    ctx.fillStyle = "#7d8993";
    ctx.fillText("Search “real lc” or “obs lc” to select targets with MAST photometry.", x + 10 * dpr, y + 27 * dpr);
    ctx.restore();
  }

  drawModelLine(ctx, model, xMap, yMap) {
    if (!model.length) return;

    const dpr = devicePixelRatioSafe();

    ctx.save();
    ctx.beginPath();

    model.forEach((point, index) => {
      const x = xMap(point.phase);
      const y = yMap(point.flux);

      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.lineWidth = Math.max(2, 2.25 * dpr);
    ctx.strokeStyle = "#ffb000";
    ctx.shadowColor = "rgba(255,176,0,.55)";
    ctx.shadowBlur = 12 * dpr;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.beginPath();

    model.forEach((point, index) => {
      const x = xMap(point.phase);
      const y = yMap(point.flux);

      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.lineWidth = Math.max(0.8, 0.9 * dpr);
    ctx.strokeStyle = "#ffd078";
    ctx.globalAlpha = 0.7;
    ctx.stroke();
    ctx.restore();
  }

  drawAxesLabels(ctx, w, h, pad, scale) {
    const dpr = devicePixelRatioSafe();

    ctx.save();
    ctx.fillStyle = "#7d8993";
    ctx.font = `${10 * dpr}px JetBrains Mono, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    for (let i = 0; i <= 4; i++) {
      const phase = scale.minPhase + i / 4 * (scale.maxPhase - scale.minPhase);
      const x = pad.left + i / 4 * (w - pad.left - pad.right);
      ctx.fillText(fmt(phase, 3), x, h - pad.bottom + 10 * dpr);
    }

    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    for (let i = 0; i <= 4; i++) {
      const flux = scale.yMax - i / 4 * (scale.yMax - scale.yMin);
      const y = pad.top + i / 4 * (h - pad.top - pad.bottom);
      ctx.fillText(fmt(flux, 5), pad.left - 9 * dpr, y);
    }

    ctx.fillStyle = "#00f0ff";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("phase", pad.left, h - 18 * dpr);

    ctx.save();
    ctx.translate(14 * dpr, h * 0.5);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("normalized flux", 0, 0);
    ctx.restore();
    ctx.restore();
  }

  drawTransitBand(ctx, w, h, pad, xMap, model) {
    const transit = model.filter(point => point.depth > 1e-6);

    if (!transit.length) return;

    const x0 = xMap(transit[0].phase);
    const x1 = xMap(transit[transit.length - 1].phase);

    ctx.save();
    ctx.fillStyle = "rgba(0,240,255,.045)";
    ctx.fillRect(x0, pad.top, x1 - x0, h - pad.top - pad.bottom);
    ctx.strokeStyle = "rgba(0,240,255,.26)";
    ctx.setLineDash([5 * devicePixelRatioSafe(), 4 * devicePixelRatioSafe()]);
    ctx.beginPath();
    ctx.moveTo(x0, pad.top);
    ctx.lineTo(x0, h - pad.bottom);
    ctx.moveTo(x1, pad.top);
    ctx.lineTo(x1, h - pad.bottom);
    ctx.stroke();
    ctx.restore();
  }

  markCurvePhase(phase) {
    this.phaseMarker = Number.isFinite(phase) ? phase : null;
    this.drawPhotometryFrame(this.phaseMarker);
  }

  drawPhaseMarker(ctx, phase, scale, pad, w, h) {
    if (phase < scale.minPhase || phase > scale.maxPhase) return;

    const dpr = devicePixelRatioSafe();
    const x = pad.left + (phase - scale.minPhase) / Math.max(1e-9, scale.maxPhase - scale.minPhase) * (w - pad.left - pad.right);

    ctx.save();
    ctx.strokeStyle = "rgba(0,240,255,.92)";
    ctx.lineWidth = 1.5 * dpr;
    ctx.shadowColor = "rgba(0,240,255,.65)";
    ctx.shadowBlur = 10 * dpr;
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, h - pad.bottom);
    ctx.stroke();

    ctx.fillStyle = "rgba(0,240,255,.95)";
    ctx.beginPath();
    ctx.arc(x, pad.top + 7 * dpr, 3.5 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  setFluxSummary(summary = {}) {
    this.cachedSummary = summary || {};

    setText(this.$("flux-min-chip"), finite(summary.minFlux) ? `MIN ${fmt(summary.minFlux, 6)}` : "MIN —");
    setText(this.$("model-depth-chip"), finite(summary.depthPpm) ? `MODEL ${Math.round(summary.depthPpm)} PPM` : "MODEL — PPM");
    setText(this.$("scene-depth-readout"), finite(summary.depthPpm) ? `${Math.round(summary.depthPpm)} ppm` : "— ppm");
    setText(this.$("ttv-chip"), this.controls.ttvEnabled?.checked ? "TTV ON" : "TTV OFF");

    this.updateDiagnostics();
  }

  setSceneReadouts(readouts = {}) {
    const totalDepth = firstFinite(readouts.depthPpm, readouts.totalDepthPpm);
    const transitPhase = firstFinite(readouts.transitPhase, readouts.phase);
    const orbitPhase = firstFinite(readouts.orbitPhase, readouts.rawOrbitPhase);
    const flux = firstFinite(readouts.flux, finite(totalDepth) ? 1 - totalDepth / 1e6 : null);

    this.liveReadouts = {
      ...this.liveReadouts,
      orbitPhase,
      transitPhase,
      totalDepthPpm: totalDepth,
      planetDepthPpm: firstFinite(readouts.planetDepthPpm, readouts.planetDepth),
      moonDepthPpm: firstFinite(readouts.moonDepthPpm, readouts.moonDepth),
      spotBoostPpm: firstFinite(readouts.spotBoostPpm, readouts.spotBoost),
      flux,
      impact: firstFinite(readouts.impact, null),
      moon: readouts.moon || this.liveReadouts.moon || "DISABLED",
      fps: firstFinite(readouts.fps, null)
    };

    setText(this.$("phase-readout"), finite(transitPhase) ? fmt(transitPhase, 4) : "0.0000");
    setText(this.$("impact-readout"), finite(readouts.impact) ? fmt(readouts.impact, 3) : "—");
    setText(this.$("moon-transform-readout"), readouts.moon || "DISABLED");
    setText(this.$("scene-depth-readout"), finite(totalDepth) ? `${Math.round(totalDepth)} ppm` : "— ppm");
    setText(this.$("fps-chip"), finite(readouts.fps) ? `${Math.round(readouts.fps)} FPS` : "-- FPS");
    setText(this.$("footer-fps"), finite(readouts.fps) ? `${Math.round(readouts.fps)}` : "--");
    setText(this.$("scene-state-chip"), "COUPLED STATE");

    this.updateDiagnostics();
  }

  updateDiagnostics() {
    this.ensureDiagnosticsPanel();

    if (!this.diagnosticNodes.period) return;

    const target = this.activeTarget || {};
    const model = this.cachedModelCurve || [];
    const observed = this.cachedObservedCurve || [];
    const controls = this.readControls();
    const diagnostics = computeDiagnostics(target, model, observed, controls, this.cachedSummary);

    this.lastDiagnostics = diagnostics;

    setText(this.diagnosticNodes.liveOrbit, finite(this.liveReadouts.orbitPhase) ? fmt(this.liveReadouts.orbitPhase, 4) : "—");
    setText(this.diagnosticNodes.liveTransit, finite(this.liveReadouts.transitPhase) ? signed(this.liveReadouts.transitPhase, 4) : "—");
    setText(this.diagnosticNodes.liveFlux, finite(this.liveReadouts.flux) ? fmt(this.liveReadouts.flux, 7) : "—");
    setText(this.diagnosticNodes.liveDepth, finite(this.liveReadouts.totalDepthPpm) ? `${Math.round(this.liveReadouts.totalDepthPpm)} ppm` : "—");
    setText(this.diagnosticNodes.planetDepth, finite(this.liveReadouts.planetDepthPpm) ? `${Math.round(this.liveReadouts.planetDepthPpm)} ppm` : "—");
    setText(this.diagnosticNodes.moonDepth, finite(this.liveReadouts.moonDepthPpm) ? `${Math.round(this.liveReadouts.moonDepthPpm)} ppm` : controls.moonEnabled ? "0 ppm" : "disabled");
    setText(this.diagnosticNodes.spotBoost, finite(this.liveReadouts.spotBoostPpm) ? `${Math.round(this.liveReadouts.spotBoostPpm)} ppm` : controls.spotEnabled ? "0 ppm" : "disabled");
    setText(this.diagnosticNodes.stateSource, "physics.js state vector");

    setText(this.diagnosticNodes.period, finite(diagnostics.periodDays) ? `${fmt(diagnostics.periodDays, 6)} d` : "—");
    setText(this.diagnosticNodes.duration, finite(diagnostics.durationHours) ? `${fmt(diagnostics.durationHours, 3)} h` : "—");
    setText(this.diagnosticNodes.durationPhase, finite(diagnostics.durationPhase) ? fmt(diagnostics.durationPhase, 5) : "—");
    setText(this.diagnosticNodes.observedMin, finite(diagnostics.observedMinPhase) ? signed(diagnostics.observedMinPhase, 4) : "—");
    setText(this.diagnosticNodes.modelMin, finite(diagnostics.modelMinPhase) ? signed(diagnostics.modelMinPhase, 4) : "—");
    setText(this.diagnosticNodes.phaseOffset, finite(diagnostics.phaseOffset) ? signed(diagnostics.phaseOffset, 4) : "—");
    setText(this.diagnosticNodes.ootScatter, finite(diagnostics.ootScatterPpm) ? `${Math.round(diagnostics.ootScatterPpm)} ppm` : "—");
    setText(this.diagnosticNodes.residualScatter, finite(diagnostics.residualScatterPpm) ? `${Math.round(diagnostics.residualScatterPpm)} ppm` : "—");
    setText(this.diagnosticNodes.secondary, diagnostics.secondaryLabel || "—");
    setText(this.diagnosticNodes.secondaryPhase, finite(diagnostics.secondaryPhase) ? signed(diagnostics.secondaryPhase, 4) : "—");
    setText(this.diagnosticNodes.starSystem, diagnostics.starSystemLabel || "—");
    setText(this.diagnosticNodes.planetSystem, diagnostics.planetSystemLabel || "—");
    setText(this.diagnosticNodes.lcPoints, finite(diagnostics.lcPoints) ? comma(diagnostics.lcPoints) : observed.length ? comma(observed.length) : "—");
    setText(this.diagnosticNodes.lcPhaseWindow, finite(diagnostics.lcPhaseWindow) ? `±${fmt(diagnostics.lcPhaseWindow, 5)}` : "—");
    setText(this.diagnosticNodes.lcCleanShift, finite(diagnostics.lcCleanShift) ? signed(diagnostics.lcCleanShift, 5) : "—");
    setText(this.diagnosticNodes.lcSchema, diagnostics.lcSchema || "—");
    setText(this.diagnosticNodes.maxMoonSignal, finite(diagnostics.maxMoonSignalPpm) ? `${Math.round(diagnostics.maxMoonSignalPpm)} ppm` : "—");
    setText(this.diagnosticNodes.maxSpotSignal, finite(diagnostics.maxSpotSignalPpm) ? `${Math.round(diagnostics.maxSpotSignalPpm)} ppm` : "—");
    setText(this.diagnosticNodes.lcProcessing, diagnostics.lcProcessing || "—");

    const moonText = controls.moonEnabled
      ? "simulation enabled · moon flux term is computed by physics.js · observed feature not confirmed moon"
      : "simulation off · observed secondary feature is not a moon claim";

    setText(this.diagnosticNodes.exomoonStatus, moonText);

    setDiagnosticClass(this.diagnosticNodes.stateSource, "good");
    setDiagnosticClass(this.diagnosticNodes.liveDepth, (this.liveReadouts.totalDepthPpm || 0) > 0 ? "good" : "");
    setDiagnosticClass(this.diagnosticNodes.moonDepth, controls.moonEnabled && (this.liveReadouts.moonDepthPpm || diagnostics.maxMoonSignalPpm || 0) > 0 ? "warn" : "");
    setDiagnosticClass(this.diagnosticNodes.spotBoost, controls.spotEnabled && (this.liveReadouts.spotBoostPpm || diagnostics.maxSpotSignalPpm || 0) > 0 ? "warn" : "");
    setDiagnosticClass(this.diagnosticNodes.phaseOffset, Math.abs(diagnostics.phaseOffset || 0) > 0.01 ? "warn" : "");
    setDiagnosticClass(this.diagnosticNodes.secondary, diagnostics.secondaryRisk === "possible" ? "warn" : diagnostics.secondaryRisk === "strong" ? "bad" : "");
    setDiagnosticClass(this.diagnosticNodes.residualScatter, diagnostics.residualScatterPpm > 3000 ? "warn" : "");
    setDiagnosticClass(this.diagnosticNodes.lcCleanShift, Math.abs(diagnostics.lcCleanShift || 0) > 0.01 ? "warn" : "");
    setDiagnosticClass(this.diagnosticNodes.lcProcessing, diagnostics.lcProcessing ? "provenance" : "");
  }

  log(message, level = "info") {
    const now = new Date();
    const entry = {
      time: now.toISOString().slice(11, 19),
      message: String(message || ""),
      level: ["info", "warn", "error"].includes(level) ? level : "info"
    };

    this.logLines.unshift(entry);
    this.logLines = this.logLines.slice(0, 120);

    const log = this.$("telemetry-log");
    if (!log) return;

    const fragment = document.createDocumentFragment();

    this.logLines.slice(0, 80).forEach(item => {
      const line = document.createElement("div");
      line.className = `log-line ${item.level === "info" ? "" : item.level}`;
      const strong = document.createElement("strong");
      strong.textContent = `[${item.time}] `;
      line.appendChild(strong);
      line.append(document.createTextNode(item.message));
      fragment.appendChild(line);
    });

    log.replaceChildren(fragment);
    setText(this.$("log-count-chip"), comma(this.logLines.length));
  }

  resizeCanvasToDisplay(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = devicePixelRatioSafe();
    const width = Math.max(2, Math.floor(rect.width * dpr));
    const height = Math.max(2, Math.floor(rect.height * dpr));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  curveSignature(curve) {
    if (!Array.isArray(curve) || !curve.length) {
      return "empty";
    }

    const first = curve[0];
    const last = curve[curve.length - 1];
    const mid = curve[Math.floor(curve.length / 2)];

    return [
      curve.length,
      finite(first.phase) ? first.phase.toFixed(6) : "x",
      finite(first.flux) ? first.flux.toFixed(6) : "y",
      finite(mid.phase) ? mid.phase.toFixed(6) : "x",
      finite(mid.flux) ? mid.flux.toFixed(6) : "y",
      finite(last.phase) ? last.phase.toFixed(6) : "x",
      finite(last.flux) ? last.flux.toFixed(6) : "y"
    ].join("|");
  }
}

function computeDiagnostics(target, model, observed, controls, summaryInput = {}) {   
  const summary = summaryInput && typeof summaryInput === "object" ? summaryInput : {};
  
  const periodDays = finiteNumber(target.pl_orbper, controls.periodDays);
  const durationHours = finiteNumber(target.pl_trandur, null);

  const durationPhaseFromCatalog = finite(periodDays) && finite(durationHours) && periodDays > 0
    ? durationHours / 24 / periodDays
    : null;

  const durationPhase = finiteNumber(target.lc_duration_phase, durationPhaseFromCatalog);

  const modelMinPhase = getMinPhase(model);
  const observedMinPhase = getRobustMinPhase(observed);

  const phaseOffset = finite(observedMinPhase) && finite(modelMinPhase)
    ? observedMinPhase - modelMinPhase
    : null;

  const transitHalfWidth = finite(durationPhase)
    ? Math.max(0.006, 1.7 * durationPhase)
    : 0.018;

  const oot = observed.filter(point =>
    finite(point.phase) &&
    finite(point.flux) &&
    Math.abs(point.phase) > transitHalfWidth
  );

  const ootFlux = oot.map(point => point.flux).filter(finite);
  const ootMedian = median(ootFlux);
  const ootScatter = robustSigma(ootFlux);
  const ootScatterPpm = finite(ootScatter) ? ootScatter * 1e6 : null;

  const residuals = [];

  if (model.length && observed.length) {
    for (const point of observed) {
      if (!finite(point.phase) || !finite(point.flux)) continue;

      const modelFlux = interpolateModelFlux(model, point.phase);
      if (!finite(modelFlux)) continue;

      residuals.push(point.flux - modelFlux);
    }
  }

  const residualScatter = robustSigma(residuals);
  const residualScatterPpm = finite(residualScatter) ? residualScatter * 1e6 : null;

  const secondary = detectSecondaryFeature(observed, model, durationPhase, ootMedian, ootScatter);

  const starCount = finiteNumber(target.sy_snum, null);
  const planetCount = finiteNumber(target.sy_pnum, null);

  const starSystemLabel = finite(starCount)
    ? starCount > 1 ? `${Math.round(starCount)} stars · possible dilution` : "single-star catalog entry"
    : "stellar count unknown";

  const planetSystemLabel = finite(planetCount)
    ? planetCount > 1 ? `${Math.round(planetCount)} known planets` : "one known planet"
    : "planet count unknown";

  const processingRaw = String(target.lc_processing || "").trim();
  const schemaRaw = String(target.lc_schema || "").trim();

  const lcProcessing = processingRaw
    ? compactProcessingLabel(processingRaw)
    : observed.length
      ? "cleaned local JSON loaded"
      : "no local light curve loaded";

  const lcSchema = schemaRaw
    ? schemaRaw.replace("exointel-prime-", "").replace("real-lightcurve-", "lc-")
    : observed.length
      ? "local-json"
      : "";

  const maxMoonSignalPpm = finite(summary.maxMoonDepthPpm)
    ? summary.maxMoonDepthPpm
    : maxFromCurve(model, "moonDepthPpm");

  const maxSpotSignalPpm = finite(summary.maxSpotBoostPpm)
    ? summary.maxSpotBoostPpm
    : maxFromCurve(model, "spotBoostPpm");

  return {
    periodDays,
    durationHours,
    durationPhase,
    modelMinPhase,
    observedMinPhase,
    phaseOffset,
    ootScatterPpm,
    residualScatterPpm,
    secondaryLabel: secondary.label,
    secondaryPhase: secondary.phase,
    secondaryRisk: secondary.risk,
    starSystemLabel,
    planetSystemLabel,
    lcPoints: finiteNumber(target.lc_points_count, observed.length || null),
    lcPhaseWindow: finiteNumber(target.lc_phase_window_used, null),
    lcCleanShift: finiteNumber(target.lc_phase_shift_applied, null),
    lcProcessing,
    lcSchema,
    maxMoonSignalPpm,
    maxSpotSignalPpm
  };
}

function compactProcessingLabel(text) {
  const value = String(text || "").trim();

  if (!value) return "";

  const lower = value.toLowerCase();

  if (lower.includes("merged json cleaned")) {
    return "merged JSON · OOT detrend · adaptive crop · median bin";
  }

  if (lower.includes("post-processed")) {
    return "post-processed JSON · detrended · cropped";
  }

  if (lower.includes("flattened")) {
    return "flattened MAST LC · phase-folded";
  }

  if (value.length > 72) {
    return value.slice(0, 69) + "...";
  }

  return value;
}

function detectSecondaryFeature(observed, model, durationPhase, ootMedian, ootScatter) {
  if (!Array.isArray(observed) || observed.length < 80) {
    return { label: "insufficient data", phase: null, risk: "none" };
  }

  const mainWidth = finite(durationPhase) ? Math.max(0.012, 2.4 * durationPhase) : 0.025;
  const points = observed
    .filter(point =>
      finite(point.phase) &&
      finite(point.flux) &&
      Math.abs(point.phase) > mainWidth &&
      Math.abs(point.phase) < 0.18
    )
    .sort((a, b) => a.phase - b.phase);

  if (points.length < 25) {
    return { label: "not enough OOT phase", phase: null, risk: "none" };
  }

  const baseline = finite(ootMedian) ? ootMedian : median(points.map(point => point.flux));
  const scatter = finite(ootScatter) && ootScatter > 0 ? ootScatter : robustSigma(points.map(point => point.flux));

  if (!finite(baseline) || !finite(scatter) || scatter <= 0) {
    return { label: "baseline uncertain", phase: null, risk: "none" };
  }

  const window = Math.max(5, Math.round(points.length * 0.035));
  let best = { depth: -Infinity, phase: null };

  for (let i = 0; i < points.length; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(points.length, i + window + 1);
    const slice = points.slice(lo, hi);
    const phase = median(slice.map(point => point.phase));
    const flux = median(slice.map(point => point.flux));
    const depth = baseline - flux;

    if (finite(depth) && depth > best.depth) {
      best = { depth, phase };
    }
  }

  const depthPpm = best.depth * 1e6;
  const sigmaPpm = scatter * 1e6;

  if (!finite(depthPpm) || depthPpm <= 0) {
    return { label: "none detected", phase: null, risk: "none" };
  }

  if (depthPpm > Math.max(5 * sigmaPpm, 1200)) {
    return {
      label: `possible secondary dip · ${Math.round(depthPpm)} ppm`,
      phase: best.phase,
      risk: "strong"
    };
  }

  if (depthPpm > Math.max(3 * sigmaPpm, 650)) {
    return {
      label: `weak candidate · ${Math.round(depthPpm)} ppm`,
      phase: best.phase,
      risk: "possible"
    };
  }

  return { label: "none significant", phase: null, risk: "none" };
}

function getMinPhase(points) {
  if (!Array.isArray(points) || !points.length) return null;

  let best = null;

  for (const point of points) {
    if (!finite(point.phase) || !finite(point.flux)) continue;

    if (!best || point.flux < best.flux) {
      best = point;
    }
  }

  return best ? best.phase : null;
}

function getRobustMinPhase(points) {
  if (!Array.isArray(points) || points.length < 10) return null;

  const clean = points
    .filter(point => finite(point.phase) && finite(point.flux))
    .sort((a, b) => a.flux - b.flux);

  if (!clean.length) return null;

  const n = Math.max(5, Math.ceil(clean.length * 0.035));
  return median(clean.slice(0, n).map(point => point.phase));
}

function interpolateModelFlux(model, phase) {
  if (!Array.isArray(model) || model.length < 2 || !finite(phase)) return null;

  const sorted = model;

  if (phase < sorted[0].phase || phase > sorted[sorted.length - 1].phase) {
    return null;
  }

  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];

    if (phase >= a.phase && phase <= b.phase) {
      const t = (phase - a.phase) / Math.max(1e-12, b.phase - a.phase);
      return a.flux + t * (b.flux - a.flux);
    }
  }

  return null;
}

function median(values) {
  const clean = values.filter(finite).sort((a, b) => a - b);

  if (!clean.length) return null;

  const mid = Math.floor(clean.length / 2);

  return clean.length % 2 ? clean[mid] : 0.5 * (clean[mid - 1] + clean[mid]);
}

function robustSigma(values) {
  const clean = values.filter(finite);

  if (clean.length < 5) return null;

  const med = median(clean);
  const deviations = clean.map(value => Math.abs(value - med));
  const mad = median(deviations);

  if (!finite(mad) || mad <= 0) return null;

  return 1.4826 * mad;
}

function maxFromCurve(curve, key) {
  if (!Array.isArray(curve) || !curve.length) return null;

  let best = 0;

  for (const point of curve) {
    const value = Number(point?.[key]);
    if (Number.isFinite(value) && value > best) best = value;
  }

  return best;
}

function firstFinite(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }

  return null;
}

function setDiagnosticClass(node, className) {
  if (!node) return;

  node.classList.remove("warn", "bad", "good", "provenance");

  if (className) {
    node.classList.add(className);
  }
}

function setText(node, value) {
  if (node) node.textContent = String(value);
}

function setInput(input, value) {
  if (!input || value === undefined || value === null) return;

  if (input.type === "checkbox") {
    input.checked = !!value;
  } else {
    input.value = String(value);
  }
}

function num(input, fallback) {
  if (!input) return fallback;

  const value = Number(input.value);

  return Number.isFinite(value) ? value : fallback;
}

function checked(input) {
  return !!input?.checked;
}

function finite(value) {
  return Number.isFinite(value);
}

function finiteNumber(value, fallback) {
  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
}

function fmt(value, digits) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : "—";
}

function signed(value, digits) {
  if (!Number.isFinite(value)) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${Number(value).toFixed(digits)}`;
}

function integer(value) {
  return Number.isFinite(Number(value)) ? Math.round(Number(value)).toString() : "—";
}

function comma(value) {
  const number = Number(value);

  return Number.isFinite(number) ? number.toLocaleString("en-GB") : "—";
}

function sci(value, digits = 2) {
  return Number.isFinite(value) ? Number(value).toExponential(digits) : "—";
}

function hzLabel(value) {
  if (!Number.isFinite(value)) return "";

  if (value >= 0.75) return "prime";
  if (value >= 0.45) return "near";
  if (value >= 0.20) return "marginal";

  return "remote";
}

function devicePixelRatioSafe() {
  return Math.min(window.devicePixelRatio || 1, 1.5);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function easeOutCubic(t) {
  const x = clamp(t, 0, 1);

  return 1 - Math.pow(1 - x, 3);
}
