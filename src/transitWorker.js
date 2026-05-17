/* ============================================================================
   ExoIntel-Prime
   Worker-backed Transit Physics Engine
   ---------------------------------------------------------------------------
   Architecture:
   - Latest-state mailbox: one active solve + one pending latest snapshot.
   - No FIFO backlog: slider drags overwrite the pending snapshot.
   - Stale revisions are cancelled cooperatively.
   - Heavy model generation stays off the main thread.
   - Results return as Transferable ArrayBuffers.

   Scientific model in this version:
   - Deterministic stellar-disk quadrature.
   - Quadratic limb darkening:
       I(mu) = 1 - u1(1 - mu) - u2(1 - mu)^2
   - Planet occultation over projected stellar surface samples.
   - Optional moon occultation as a hypothesis term.
   - Optional irregular starspot map with umbra/penumbra intensity reduction.
   - Dynamic residual metrics against archival phase-folded photometry.

   This is not yet a full Mandel & Agol analytic implementation. It is a
   deterministic numerical forward model designed to be stable, explainable,
   and suitable for client-side interaction.
   ============================================================================ */

const WORKER_PROTOCOL = "latest-state-mailbox-v2";
const TWO_PI = Math.PI * 2;

let configured = false;
let active = false;
let pendingSnapshot = null;
let newestRequestedRevision = 0;

let archivalContext = {
  target: null,
  phase: new Float32Array(0),
  flux: new Float32Array(0),
  error: new Float32Array(0),
  points: 0,
  source: "none"
};

const gridCache = new Map();

self.onmessage = event => {
  const message = event.data;

  if (!message || typeof message !== "object") {
    postWarning("Worker received an invalid message.");
    return;
  }

  if (message.type === "configure") {
    configured = true;

    self.postMessage({
      type: "ready",
      protocol: WORKER_PROTOCOL,
      appName: message.appName || "ExoIntel-Prime"
    });

    return;
  }

  if (message.type === "data") {
    handleDataMessage(message);
    return;
  }

  if (message.type === "solve") {
    handleSolveMessage(message);
    return;
  }

  if (message.type === "ping") {
    self.postMessage({
      type: "pong",
      configured,
      active,
      pendingRevision: pendingSnapshot?.revision ?? null,
      newestRequestedRevision,
      archivalPoints: archivalContext.phase.length
    });

    return;
  }

  postWarning(`Worker ignored unknown message type: ${String(message.type)}`);
};

function handleDataMessage(message) {
  try {
    const phase = message.archival?.phaseBuffer instanceof ArrayBuffer
      ? new Float32Array(message.archival.phaseBuffer)
      : new Float32Array(0);

    const flux = message.archival?.fluxBuffer instanceof ArrayBuffer
      ? new Float32Array(message.archival.fluxBuffer)
      : new Float32Array(0);

    const error = message.archival?.errorBuffer instanceof ArrayBuffer
      ? new Float32Array(message.archival.errorBuffer)
      : new Float32Array(0);

    archivalContext = {
      target: message.target || null,
      phase,
      flux,
      error,
      points: Number.isFinite(message.archival?.points) ? message.archival.points : phase.length,
      source: message.archival?.source || "unknown"
    };

    self.postMessage({
      type: "data-ready",
      points: archivalContext.phase.length,
      source: archivalContext.source
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: `Failed to install archival data context: ${error.message}`
    });
  }
}

function handleSolveMessage(message) {
  const revision = Number(message.revision);

  if (!Number.isFinite(revision)) {
    postWarning("Solve message rejected because it has no numeric revision.");
    return;
  }

  newestRequestedRevision = Math.max(newestRequestedRevision, revision);

  pendingSnapshot = {
    revision,
    target: message.target || archivalContext.target || {},
    params: normaliseParams(message.params || {}),
    receivedAt: performance.now()
  };

  self.postMessage({
    type: "accepted",
    revision,
    mailbox: active ? "pending-slot" : "active-next"
  });

  if (!active) {
    drainMailbox();
  }
}

async function drainMailbox() {
  if (active) return;

  active = true;

  try {
    while (pendingSnapshot) {
      const snapshot = pendingSnapshot;
      pendingSnapshot = null;

      if (snapshot.revision < newestRequestedRevision) {
        self.postMessage({
          type: "obsolete",
          revision: snapshot.revision,
          newestRevision: newestRequestedRevision,
          stage: "before-start"
        });

        continue;
      }

      try {
        const result = await solveTransitArchitecture(snapshot);

        if (!result) {
          self.postMessage({
            type: "obsolete",
            revision: snapshot.revision,
            newestRevision: newestRequestedRevision,
            stage: "solver-aborted"
          });

          continue;
        }

        if (snapshot.revision < newestRequestedRevision) {
          self.postMessage({
            type: "obsolete",
            revision: snapshot.revision,
            newestRevision: newestRequestedRevision,
            stage: "after-solve"
          });

          continue;
        }

        self.postMessage(
          {
            type: "result",
            revision: snapshot.revision,
            mode: result.mode,
            phaseBuffer: result.phase.buffer,
            fluxBuffer: result.flux.buffer,
            metrics: result.metrics,
            timings: result.timings
          },
          [result.phase.buffer, result.flux.buffer]
        );
      } catch (error) {
        self.postMessage({
          type: "error",
          revision: snapshot.revision,
          message: error.message || "Unknown worker solve error"
        });
      }
    }
  } finally {
    active = false;

    if (pendingSnapshot) {
      drainMailbox();
    }
  }
}

async function solveTransitArchitecture(snapshot) {
  const t0 = performance.now();
  const revision = snapshot.revision;
  const params = snapshot.params;
  const target = snapshot.target || {};
  const full = params.fidelity === "full";

  const resolution = clampInt(params.modelResolution || (full ? 1440 : 720), 160, full ? 2400 : 960);
  const gridSpec = full
    ? { rings: 82, azimuth: 150 }
    : { rings: 46, azimuth: 96 };

  const grid = getQuadratureGrid(gridSpec.rings, gridSpec.azimuth);
  const intensity = buildIntensityMap(grid, params);
  const baselineFlux = sumArray(intensity.weightedIntensity);

  const phase = new Float32Array(resolution);
  const flux = new Float32Array(resolution);

  const periodDays = numberValue(target.pl_orbper, 3);
  const durationHours = numberValue(target.pl_trandur, 2.5);
  const durationPhase = clamp(durationHours / 24 / Math.max(0.1, periodDays), 0.006, 0.12);
  const phaseWindow = Math.max(0.12, durationPhase * 4.2);

  const phaseMin = -phaseWindow;
  const phaseMax = phaseWindow;
  const chunkSize = full ? 10 : 18;
  const totalChunks = Math.ceil(resolution / chunkSize);

  let maxPlanetDepth = 0;
  let maxMoonDepth = 0;
  let maxSpotBoost = 0;
  let minFlux = Infinity;

  for (let start = 0, chunk = 0; start < resolution; start += chunkSize, chunk++) {
    if (isObsolete(revision)) {
      return null;
    }

    const end = Math.min(resolution, start + chunkSize);

    for (let i = start; i < end; i++) {
      const modelPhase = phaseMin + (phaseMax - phaseMin) * i / Math.max(1, resolution - 1);
      const shiftedPhase = modelPhase - params.phaseShift;

      const geometry = computeProjectedGeometry(shiftedPhase, params, target);
      const result = integrateFluxAtGeometry(grid, intensity, baselineFlux, geometry, params);

      phase[i] = modelPhase;
      flux[i] = result.flux;

      maxPlanetDepth = Math.max(maxPlanetDepth, result.planetDepthPpm);
      maxMoonDepth = Math.max(maxMoonDepth, result.moonDepthPpm);
      maxSpotBoost = Math.max(maxSpotBoost, result.spotBoostPpm);
      minFlux = Math.min(minFlux, result.flux);
    }

    self.postMessage({
      type: "progress",
      revision,
      progress: Math.min(1, (chunk + 1) / totalChunks)
    });

    await yieldToEventLoop();
  }

  if (isObsolete(revision)) {
    return null;
  }

  const metrics = computeScientificMetrics({
    modelPhase: phase,
    modelFlux: flux,
    archivalPhase: archivalContext.phase,
    archivalFlux: archivalContext.flux,
    params,
    target,
    minFlux,
    maxPlanetDepth,
    maxMoonDepth,
    maxSpotBoost,
    gridSpec
  });

  const t1 = performance.now();

  return {
    phase,
    flux,
    mode: full ? "full-fidelity numerical quadrature" : "preview numerical quadrature",
    metrics,
    timings: {
      startedAt: t0,
      finishedAt: t1,
      elapsedMs: t1 - t0,
      samples: resolution,
      rings: gridSpec.rings,
      azimuth: gridSpec.azimuth,
      surfaceSamples: grid.x.length
    }
  };
}

function getQuadratureGrid(rings, azimuth) {
  const key = `${rings}x${azimuth}`;

  if (gridCache.has(key)) {
    return gridCache.get(key);
  }

  const x = [];
  const y = [];
  const r = [];
  const mu = [];
  const area = [];

  for (let ir = 0; ir < rings; ir++) {
    const r0 = ir / rings;
    const r1 = (ir + 1) / rings;
    const rc = Math.sqrt(0.5 * (r0 * r0 + r1 * r1));
    const ringArea = Math.PI * (r1 * r1 - r0 * r0);
    const cellArea = ringArea / azimuth;

    for (let ia = 0; ia < azimuth; ia++) {
      const theta = TWO_PI * (ia + 0.5) / azimuth;
      const px = rc * Math.cos(theta);
      const py = rc * Math.sin(theta);
      const pmu = Math.sqrt(Math.max(0, 1 - rc * rc));

      x.push(px);
      y.push(py);
      r.push(rc);
      mu.push(pmu);
      area.push(cellArea);
    }
  }

  const grid = {
    x: new Float32Array(x),
    y: new Float32Array(y),
    r: new Float32Array(r),
    mu: new Float32Array(mu),
    area: new Float32Array(area),
    rings,
    azimuth
  };

  gridCache.set(key, grid);

  return grid;
}

function buildIntensityMap(grid, params) {
  const n = grid.x.length;
  const baseIntensity = new Float32Array(n);
  const spotFactor = new Float32Array(n);
  const weightedIntensity = new Float32Array(n);
  const unspottedWeightedIntensity = new Float32Array(n);

  const u1 = params.u1;
  const u2 = params.u2;
  const spot = buildSpotModel(params);

  for (let i = 0; i < n; i++) {
    const mu = grid.mu[i];
    const q = 1 - mu;
    const limb = Math.max(0, 1 - u1 * q - u2 * q * q);
    const spotDarkening = params.spotEnabled
      ? computeSpotDarkening(grid.x[i], grid.y[i], spot, params)
      : 0;

    baseIntensity[i] = limb;
    spotFactor[i] = spotDarkening;
    unspottedWeightedIntensity[i] = limb * grid.area[i];
    weightedIntensity[i] = limb * (1 - spotDarkening) * grid.area[i];
  }

  return {
    baseIntensity,
    spotFactor,
    weightedIntensity,
    unspottedWeightedIntensity
  };
}

function buildSpotModel(params) {
  const x = clamp(params.spotX, -0.95, 0.95);
  const y = clamp(params.spotY, -0.95, 0.95);
  const radius = clamp(params.spotRadius, 0.005, 0.6);

  return {
    components: [
      {
        x,
        y,
        rx: radius * 1.05,
        ry: radius * 0.72,
        angle: 0.35,
        weight: 0.62
      },
      {
        x: x + radius * 0.32,
        y: y - radius * 0.18,
        rx: radius * 0.56,
        ry: radius * 0.38,
        angle: -0.82,
        weight: 0.45
      },
      {
        x: x - radius * 0.24,
        y: y + radius * 0.30,
        rx: radius * 0.44,
        ry: radius * 0.31,
        angle: 1.15,
        weight: 0.38
      }
    ]
  };
}

function computeSpotDarkening(x, y, spot, params) {
  let penumbra = 0;
  let umbra = 0;

  for (const component of spot.components) {
    const dx = x - component.x;
    const dy = y - component.y;
    const c = Math.cos(component.angle);
    const s = Math.sin(component.angle);
    const xr = c * dx + s * dy;
    const yr = -s * dx + c * dy;
    const q = Math.sqrt((xr / component.rx) ** 2 + (yr / component.ry) ** 2);
    const ragged = 0.88 + 0.18 * deterministicNoise(x * 31.7 + component.x * 8.1, y * 29.3 + component.y * 5.7);

    const p = 1 - smoothstep(0.78 * ragged, 1.24 * ragged, q);
    const u = 1 - smoothstep(0.22 * ragged, 0.56 * ragged, q);

    penumbra = Math.max(penumbra, p * component.weight);
    umbra = Math.max(umbra, u * component.weight);
  }

  const contrast = clamp(params.spotContrast, 0, 0.98);
  return clamp(contrast * (0.54 * penumbra + 0.46 * umbra), 0, 0.98);
}

function computeProjectedGeometry(phase, params, target) {
  const aRs = Math.max(1.1, params.aRs);
  const inc = params.inclinationDeg * Math.PI / 180;
  const theta = TWO_PI * phase;
  const eccentricityScale = Math.max(0.35, 1 - params.eccentricity * Math.cos(theta));

  const px = aRs * eccentricityScale * Math.sin(theta);
  const py = -aRs * eccentricityScale * Math.cos(theta) * Math.cos(inc);
  const pz = aRs * eccentricityScale * Math.cos(theta) * Math.sin(inc);

  const planet = {
    x: px,
    y: py,
    z: pz,
    radius: params.rpRs,
    front: pz >= 0
  };

  const moonEnabled = params.moonEnabled;
  const moonAngle = params.moonPhaseDeg * Math.PI / 180 + TWO_PI * phase * 6.0;
  const moonDistance = params.moonDistance;
  const moonX = px + moonDistance * Math.cos(moonAngle);
  const moonY = py + moonDistance * Math.sin(moonAngle) * 0.55;
  const moonZ = pz + moonDistance * Math.sin(moonAngle) * 0.55;

  const moon = {
    enabled: moonEnabled,
    x: moonX,
    y: moonY,
    z: moonZ,
    radius: params.moonRadius,
    front: moonZ >= 0
  };

  return { planet, moon };
}

function integrateFluxAtGeometry(grid, intensity, baselineFlux, geometry, params) {
  let visibleFlux = 0;
  let planetBlocked = 0;
  let moonBlocked = 0;
  let spotBoost = 0;

  const p = geometry.planet;
  const m = geometry.moon;

  const pActive = p.front && p.radius > 0;
  const mActive = m.enabled && m.front && m.radius > 0;

  const pr2 = p.radius * p.radius;
  const mr2 = m.radius * m.radius;

  for (let i = 0; i < grid.x.length; i++) {
    const sx = grid.x[i];
    const sy = grid.y[i];
    const weighted = intensity.weightedIntensity[i];

    let occultedByPlanet = false;
    let occultedByMoon = false;

    if (pActive) {
      const dx = sx - p.x;
      const dy = sy - p.y;
      occultedByPlanet = dx * dx + dy * dy <= pr2;
    }

    if (mActive) {
      const dx = sx - m.x;
      const dy = sy - m.y;
      occultedByMoon = dx * dx + dy * dy <= mr2;
    }

    if (occultedByPlanet || occultedByMoon) {
      if (occultedByPlanet) {
        planetBlocked += weighted;
      } else {
        moonBlocked += weighted;
      }

      if (intensity.spotFactor[i] > 0) {
        const unspotted = intensity.unspottedWeightedIntensity[i];
        spotBoost += unspotted - weighted;
      }

      continue;
    }

    visibleFlux += weighted;
  }

  const flux = baselineFlux > 0 ? visibleFlux / baselineFlux : 1;
  const planetDepthPpm = baselineFlux > 0 ? planetBlocked / baselineFlux * 1e6 : 0;
  const moonDepthPpm = baselineFlux > 0 ? moonBlocked / baselineFlux * 1e6 : 0;
  const spotBoostPpm = baselineFlux > 0 ? spotBoost / baselineFlux * 1e6 : 0;

  return {
    flux,
    planetDepthPpm,
    moonDepthPpm,
    spotBoostPpm
  };
}

function computeScientificMetrics({
  modelPhase,
  modelFlux,
  archivalPhase,
  archivalFlux,
  params,
  target,
  minFlux,
  maxPlanetDepth,
  maxMoonDepth,
  maxSpotBoost,
  gridSpec
}) {
  const residuals = [];
  const ootFlux = [];

  const durationHours = numberValue(target.pl_trandur, 2.5);
  const periodDays = numberValue(target.pl_orbper, 3);
  const durationPhase = clamp(durationHours / 24 / Math.max(0.1, periodDays), 0.006, 0.12);
  const ootLimit = durationPhase * 1.8;

  for (let i = 0; i < archivalPhase.length; i++) {
    const p = archivalPhase[i];
    const f = archivalFlux[i];

    if (!Number.isFinite(p) || !Number.isFinite(f)) continue;

    const mf = interpolate(modelPhase, modelFlux, p);

    if (Number.isFinite(mf)) {
      residuals.push(f - mf);
    }

    if (Math.abs(p) > ootLimit) {
      ootFlux.push(f);
    }
  }

  const residualRms = rms(residuals);
  const ootRms = robustRmsAroundMedian(ootFlux);
  const modelDepth = Number.isFinite(minFlux) ? Math.max(0, 1 - minFlux) : maxPlanetDepth / 1e6;
  const modelDepthPpm = modelDepth * 1e6;
  const ootRmsPpm = Number.isFinite(ootRms) ? ootRms * 1e6 : null;
  const residualRmsPpm = Number.isFinite(residualRms) ? residualRms * 1e6 : null;
  const snr = Number.isFinite(ootRmsPpm) && ootRmsPpm > 0 ? modelDepthPpm / ootRmsPpm : null;

  const morphologyFlags = [];

  morphologyFlags.push(`${gridSpec.rings}×${gridSpec.azimuth} disk quadrature`);
  morphologyFlags.push("quadratic limb darkening");

  if (params.spotEnabled) {
    morphologyFlags.push("irregular starspot hypothesis");
  }

  if (params.moonEnabled) {
    morphologyFlags.push("moon hypothesis active");
  }

  if (Math.abs(params.phaseShift) > 0.005) {
    morphologyFlags.push("phase shift applied");
  }

  if (Number.isFinite(snr)) {
    if (snr >= 10) morphologyFlags.push("high S/N transit");
    else if (snr >= 5) morphologyFlags.push("moderate S/N transit");
    else morphologyFlags.push("low S/N fit");
  }

  if (!archivalPhase.length) {
    morphologyFlags.push("no archival overlay");
  }

  if (maxMoonDepth > 1) {
    morphologyFlags.push(`moon signal ${Math.round(maxMoonDepth)} ppm`);
  }

  if (maxSpotBoost > 1) {
    morphologyFlags.push(`spot crossing boost ${Math.round(maxSpotBoost)} ppm`);
  }

  return {
    residualRmsPpm,
    ootRmsPpm,
    snr,
    phaseShift: params.phaseShift,
    modelDepthPpm,
    maxPlanetDepthPpm: maxPlanetDepth,
    maxMoonDepthPpm: maxMoonDepth,
    maxSpotBoostPpm: maxSpotBoost,
    morphologyFlags
  };
}

function isObsolete(revision) {
  return revision < newestRequestedRevision;
}

function yieldToEventLoop() {
  return new Promise(resolve => {
    setTimeout(resolve, 0);
  });
}

function interpolate(xArray, yArray, x) {
  if (!xArray.length || x < xArray[0] || x > xArray[xArray.length - 1]) {
    return NaN;
  }

  let lo = 0;
  let hi = xArray.length - 1;

  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;

    if (xArray[mid] <= x) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const x0 = xArray[lo];
  const x1 = xArray[hi];
  const y0 = yArray[lo];
  const y1 = yArray[hi];
  const t = (x - x0) / Math.max(1e-12, x1 - x0);

  return y0 + t * (y1 - y0);
}

function rms(values) {
  const clean = values.filter(Number.isFinite);

  if (!clean.length) return NaN;

  let sum = 0;

  for (const value of clean) {
    sum += value * value;
  }

  return Math.sqrt(sum / clean.length);
}

function robustRmsAroundMedian(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);

  if (!clean.length) return NaN;

  const med = median(clean);
  const residuals = clean.map(value => value - med);

  return rms(residuals);
}

function median(sortedValues) {
  if (!sortedValues.length) return NaN;

  const mid = Math.floor(sortedValues.length / 2);

  if (sortedValues.length % 2) {
    return sortedValues[mid];
  }

  return 0.5 * (sortedValues[mid - 1] + sortedValues[mid]);
}

function sumArray(array) {
  let sum = 0;

  for (let i = 0; i < array.length; i++) {
    sum += array[i];
  }

  return sum;
}

function deterministicNoise(x, y) {
  return fract(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453123);
}

function fract(value) {
  return value - Math.floor(value);
}

function normaliseParams(params) {
  return {
    rpRs: clamp(numberValue(params.rpRs, 0.1), 0.001, 0.5),
    aRs: clamp(numberValue(params.aRs, 12), 1.1, 200),
    inclinationDeg: clamp(numberValue(params.inclinationDeg, 88.5), 0, 90),
    eccentricity: clamp(numberValue(params.eccentricity, 0), 0, 0.95),
    u1: clamp(numberValue(params.u1, 0.32), 0, 1.5),
    u2: clamp(numberValue(params.u2, 0.28), -0.5, 1.5),

    spotEnabled: Boolean(params.spotEnabled),
    spotX: clamp(numberValue(params.spotX, 0.2), -1, 1),
    spotY: clamp(numberValue(params.spotY, 0.1), -1, 1),
    spotRadius: clamp(numberValue(params.spotRadius, 0.12), 0.001, 0.6),
    spotContrast: clamp(numberValue(params.spotContrast, 0.55), 0, 1),

    moonEnabled: Boolean(params.moonEnabled),
    moonRadius: clamp(numberValue(params.moonRadius, 0.025), 0.0001, 0.2),
    moonDistance: clamp(numberValue(params.moonDistance, 0.55), 0.01, 5),
    moonPhaseDeg: clamp(numberValue(params.moonPhaseDeg, 45), 0, 360),

    phaseShift: clamp(numberValue(params.phaseShift, 0), -0.5, 0.5),
    modelResolution: clampInt(params.modelResolution || 720, 160, 2400),
    fidelity: params.fidelity === "full" ? "full" : "preview"
  };
}

function postWarning(message) {
  self.postMessage({
    type: "warning",
    message
  });
}

function numberValue(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function clampInt(value, min, max) {
  return Math.trunc(clamp(Number(value), min, max));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / Math.max(1e-12, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
