export class PrimeHUD {
  constructor() {
    this.$ = id => document.getElementById(id);
    this.callbacks = {};
    this.logLines = [];
    this.lastTargets = [];
    this.activeTarget = null;
    this.phaseMarker = null;

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

    this.lightcurveCanvas = this.$("lightcurve-canvas");
    this.lightcurveContext = this.lightcurveCanvas ? this.lightcurveCanvas.getContext("2d") : null;
    this.cachedCurve = [];
    this.cachedSummary = null;
  }

  bind(callbacks = {}) {
    this.callbacks = callbacks;

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
        if (this.callbacks.onControlsChange) this.callbacks.onControlsChange(this.readControls());
      });
    });

    window.addEventListener("resize", () => {
      if (this.cachedCurve.length && this.cachedSummary) {
        this.renderLightCurve(this.cachedCurve, this.cachedSummary);
        if (this.phaseMarker !== null) this.markCurvePhase(this.phaseMarker);
      }
    }, { passive: true });
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

  setKernel(kernel = {}) {
    setText(this.$("kernel-rings"), integer(kernel.rings ?? 82));
    setText(this.$("kernel-azimuth"), integer(kernel.azimuth ?? 150));
    setText(this.$("kernel-samples"), comma(kernel.samples ?? 12300));
    setText(this.$("kernel-moon-state"), kernel.moon ? "ON" : "OFF");
    setText(this.$("kernel-spot-state"), kernel.spot ? "ON" : "OFF");
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
      if (activeTarget && activeTarget.id === target.id) button.classList.add("active");

      const main = document.createElement("div");
      const title = document.createElement("strong");
      const meta = document.createElement("span");
      const depth = document.createElement("em");

      title.textContent = target.pl_name || "Unknown Planet";
      meta.textContent = [
        target.hostname || "Unknown Host",
        finite(target.st_teff) ? `${Math.round(target.st_teff)} K` : "T_eff —",
        finite(target.pl_orbper) ? `${fmt(target.pl_orbper, 2)} d` : "P —",
        target.discoverymethod || "Transit"
      ].join(" · ");
      depth.textContent = finite(target.pl_trandep) ? `${Math.round(target.pl_trandep)} ppm` : "— ppm";

      main.append(title, meta);
      button.append(main, depth);
      button.addEventListener("click", () => {
        this.activeTarget = target;
        this.setActiveTarget(target);
        if (this.callbacks.onTargetSelect) this.callbacks.onTargetSelect(target);
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
  }

  renderLightCurve(curve = [], summary = {}) {
    this.cachedCurve = curve;
    this.cachedSummary = summary;

    const canvas = this.lightcurveCanvas;
    const ctx = this.lightcurveContext;
    if (!canvas || !ctx) return;

    this.resizeCanvasToDisplay(canvas);
    const w = canvas.width;
    const h = canvas.height;
    const pad = {
      left: Math.max(52, w * 0.048),
      right: Math.max(18, w * 0.018),
      top: Math.max(20, h * 0.075),
      bottom: Math.max(36, h * 0.14)
    };

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#020303";
    ctx.fillRect(0, 0, w, h);

    this.drawGrid(ctx, w, h, pad);

    if (!curve.length) {
      ctx.fillStyle = "#7d8993";
      ctx.font = `${12 * devicePixelRatioSafe()}px JetBrains Mono, monospace`;
      ctx.fillText("No photometric samples available", pad.left, h * 0.5);
      return;
    }

    const phases = curve.map(p => p.phase);
    const fluxes = curve.map(p => p.flux);
    const minPhase = Math.min(...phases);
    const maxPhase = Math.max(...phases);
    const minFluxRaw = Math.min(...fluxes);
    const maxFluxRaw = Math.max(...fluxes);
    const yMin = Math.min(0.999, minFluxRaw - Math.max(0.0001, (1 - minFluxRaw) * 0.18));
    const yMax = Math.max(1.0002, maxFluxRaw + 0.00012);

    const xMap = phase => pad.left + (phase - minPhase) / Math.max(1e-9, maxPhase - minPhase) * (w - pad.left - pad.right);
    const yMap = flux => pad.top + (yMax - flux) / Math.max(1e-9, yMax - yMin) * (h - pad.top - pad.bottom);

    ctx.save();
    ctx.beginPath();
    curve.forEach((point, index) => {
      const x = xMap(point.phase);
      const y = yMap(point.flux);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineWidth = Math.max(2, 2.2 * devicePixelRatioSafe());
    ctx.strokeStyle = "#ffb000";
    ctx.shadowColor = "rgba(255,176,0,.45)";
    ctx.shadowBlur = 12 * devicePixelRatioSafe();
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    curve.forEach((point, index) => {
      const x = xMap(point.phase);
      const y = yMap(point.flux);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(xMap(maxPhase), yMap(yMin));
    ctx.lineTo(xMap(minPhase), yMap(yMin));
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, pad.top, 0, h - pad.bottom);
    fill.addColorStop(0, "rgba(255,176,0,.20)");
    fill.addColorStop(1, "rgba(255,176,0,0)");
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();

    this.drawAxesLabels(ctx, w, h, pad, { minPhase, maxPhase, yMin, yMax });
    this.drawTransitBand(ctx, w, h, pad, xMap, yMap, curve);
    this.phaseMarker = null;
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

  drawTransitBand(ctx, w, h, pad, xMap, yMap, curve) {
    const transit = curve.filter(p => p.depth > 1e-6);
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
    if (!this.cachedCurve.length || !this.lightcurveCanvas || !this.lightcurveContext) return;
    this.renderLightCurve(this.cachedCurve, this.cachedSummary || {});
    this.phaseMarker = phase;

    const canvas = this.lightcurveCanvas;
    const ctx = this.lightcurveContext;
    const w = canvas.width;
    const h = canvas.height;
    const pad = {
      left: Math.max(52, w * 0.048),
      right: Math.max(18, w * 0.018),
      top: Math.max(20, h * 0.075),
      bottom: Math.max(36, h * 0.14)
    };

    const minPhase = Math.min(...this.cachedCurve.map(p => p.phase));
    const maxPhase = Math.max(...this.cachedCurve.map(p => p.phase));
    if (phase < minPhase || phase > maxPhase) return;

    const x = pad.left + (phase - minPhase) / Math.max(1e-9, maxPhase - minPhase) * (w - pad.left - pad.right);
    ctx.save();
    ctx.strokeStyle = "#00f0ff";
    ctx.lineWidth = 1.5 * devicePixelRatioSafe();
    ctx.shadowColor = "rgba(0,240,255,.65)";
    ctx.shadowBlur = 10 * devicePixelRatioSafe();
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, h - pad.bottom);
    ctx.stroke();
    ctx.restore();
  }

  setFluxSummary(summary = {}) {
    setText(this.$("flux-min-chip"), finite(summary.minFlux) ? `MIN ${fmt(summary.minFlux, 6)}` : "MIN —");
    setText(this.$("scene-depth-readout"), finite(summary.depthPpm) ? `${Math.round(summary.depthPpm)} ppm` : "— ppm");
    setText(this.$("ttv-chip"), this.controls.ttvEnabled?.checked ? "TTV ON" : "TTV OFF");
  }

  setSceneReadouts(readouts = {}) {
    setText(this.$("phase-readout"), finite(readouts.phase) ? fmt(readouts.phase, 4) : "0.0000");
    setText(this.$("impact-readout"), finite(readouts.impact) ? fmt(readouts.impact, 3) : "—");
    setText(this.$("moon-transform-readout"), readouts.moon || "DISABLED");
    setText(this.$("scene-depth-readout"), finite(readouts.depthPpm) ? `${Math.round(readouts.depthPpm)} ppm` : "— ppm");
    setText(this.$("fps-chip"), finite(readouts.fps) ? `${Math.round(readouts.fps)} FPS` : "-- FPS");
    setText(this.$("scene-state-chip"), "SCENE ONLINE");
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
}

function setText(node, value) {
  if (node) node.textContent = String(value);
}

function setInput(input, value) {
  if (!input || value === undefined || value === null) return;
  if (input.type === "checkbox") input.checked = !!value;
  else input.value = String(value);
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

function fmt(value, digits) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : "—";
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
  return Math.min(window.devicePixelRatio || 1, 2);
}
