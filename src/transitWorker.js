/* ============================================================================
   ExoIntel-Prime
   Transit Physics Worker
   ---------------------------------------------------------------------------
   Purpose:
   - Keep all expensive transit-model calculations away from the main UI thread.
   - Use a latest-state mailbox so slider interaction does not create a long
     FIFO backlog.
   - Compute a deterministic numerical transit model with:
       * quadratic limb darkening
       * projected orbital geometry
       * optional irregular starspot map
       * optional exomoon hypothesis
       * residual and noise diagnostics against archival photometry

   Important:
   This worker is the scientific calculation layer. The WebGL scene is only the
   visual representation. The plotted theoretical model comes from this file.
   ============================================================================ */

const WORKER_VERSION = "20260517-worker-diagnostics-03";
const TWO_PI = Math.PI * 2;

const DEFAULT_PARAMS = Object.freeze({
  rpRs: 0.1,
  aRs: 12.0,
  inclinationDeg: 88.5,
  eccentricity: 0.0,

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
  modelResolution: 720,
  fidelity: "preview"
});

const DEFAULT_TARGET = Object.freeze({
  pl_name: "Synthetic Hot Jupiter",
  hostname: "Demonstration Host",
  pl_orbper: 3.0,
  pl_trandur: 2.4,
  pl_trandep: 10000,
  st_teff: 5772,
  st_rad: 1.0,
  st_mass: 1.0
});

const state = {
  configured: false,
  appName: "ExoIntel-Prime",

  workerActive: false,
  pendingJob: null,
  latestRevisionSeen: 0,

  archive: {
    phase: new Float32Array(0),
    flux: new Float32Array(0),
    error: new Float32Array(0),
    points: 0,
    source: "none"
  },

  target: { ...DEFAULT_TARGET }
};

/* ============================================================================
   MESSAGE HANDLING
   ============================================================================ */

self.addEventListener("message", event => {
  const message = event.data;

  if (!message || typeof message !== "object") {
    return;
  }

  try {
    if (message.type === "configure") {
      handleConfigure(message);
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

    postMessage({
      type: "warning",
      message: `Unknown worker message type: ${String(message.type)}`
    });
  } catch (error) {
    postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

function handleConfigure(message) {
  state.configured = true;
  state.appName = String(message.appName || "ExoIntel-Prime");

  postMessage({
    type: "ready",
    version: WORKER_VERSION,
    protocol: message.protocol || "latest-state-mailbox"
  });
}

function handleDataMessage(message) {
  const archival = message.archival || {};

  state.target = normaliseTarget(message.target);

  state.archive = {
    phase: archival.phaseBuffer instanceof ArrayBuffer
      ? new Float32Array(archival.phaseBuffer)
      : new Float32Array(0),

    flux: archival.fluxBuffer instanceof ArrayBuffer
      ? new Float32Array(archival.fluxBuffer)
      : new Float32Array(0),

    error: archival.errorBuffer instanceof ArrayBuffer
      ? new Float32Array(archival.errorBuffer)
      : new Float32Array(0),

    points: Number.isFinite(Number(archival.points))
      ? Number(archival.points)
      : 0,

    source: String(archival.source || "local archive")
  };

  state.archive.points = Math.min(
    state.archive.phase.length,
    state.archive.flux.length
  );

  postMessage({
    type: "data-ready",
    points: state.archive.points,
    source: state.archive.source
  });
}

function handleSolveMessage(message) {
  const revision = Number(message.revision);

  if (!Number.isFinite(revision)) {
    postMessage({
      type: "error",
      message: "Solve request missing finite revision number."
    });
    return;
  }

  state.latestRevisionSeen = Math.max(state.latestRevisionSeen, revision);

  state.pendingJob = {
    revision,
    target: normaliseTarget(message.target || state.target),
    params: normaliseParams(message.params || {})
  };

  postMessage({
    type: "accepted",
    revision
  });

  drainMailbox();
}

/* ============================================================================
   LATEST-STATE MAILBOX
   ============================================================================ */

async function drainMailbox() {
  if (state.workerActive) {
    return;
  }

  while (state.pendingJob) {
    const job = state.pendingJob;
    state.pendingJob = null;

    state.workerActive = true;

    try {
      const result = await solveTransitArchitecture(job);

      if (result?.obsolete) {
        postMessage({
          type: "obsolete",
          revision: job.revision
        });
      } else if (result) {
        postMessage(
          {
            type: "result",
            revision: job.revision,
            mode: result.mode,
            phaseBuffer: result.phase.buffer,
            fluxBuffer: result.flux.buffer,
            metrics: result.metrics,
            timings: result.timings
          },
          [
            result.phase.buffer,
            result.flux.buffer
          ]
        );
      }
    } catch (error) {
      postMessage({
        type: "error",
        revision: job.revision,
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      state.workerActive = false;
    }
  }
}

function shouldAbort(revision) {
  return Boolean(
    state.pendingJob &&
    Number.isFinite(state.pendingJob.revision) &&
    state.pendingJob.revision > revision
  );
}

function yieldToEventLoop() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/* ============================================================================
   CORE SOLVER
   ============================================================================ */

async function solveTransitArchitecture(job) {
  const started = performance.now();

  const params = normaliseParams(job.params);
  const target = normaliseTarget(job.target);

  const quality = solverQuality(params);
  const phaseRange = determinePhaseRange(state.archive, target, params);
  const phase = createPhaseGrid(
    phaseRange.min,
    phaseRange.max,
    quality.phaseSamples
  );

  const surface = buildStellarSurfaceGrid(params, quality);

  const flux = new Float32Array(phase.length);
  const noSpotFlux = new Float32Array(phase.length);
  const planetDepth = new Float32Array(phase.length);
  const moonDepth = new Float32Array(phase.length);

  const chunkSize = quality.chunkSize;

  for (let i = 0; i < phase.length; i++) {
    if (i > 0 && i % chunkSize === 0) {
      postMessage({
        type: "progress",
        revision: job.revision,
        progress: i / phase.length
      });

      await yieldToEventLoop();

      if (shouldAbort(job.revision)) {
        return { obsolete: true };
      }
    }

    const sample = evaluateFluxAtPhase(
      phase[i],
      params,
      surface
    );

    flux[i] = sample.flux;
    noSpotFlux[i] = sample.noSpotFlux;
    planetDepth[i] = sample.planetDepth;
    moonDepth[i] = sample.moonDepth;
  }

  if (shouldAbort(job.revision)) {
    return { obsolete: true };
  }

  const elapsedMs = performance.now() - started;

  const timings = {
    elapsedMs,
    samples: phase.length,
    rings: quality.rings,
    azimuth: quality.azimuth,
    surfaceSamples: surface.count
  };

  const metrics = calculateDiagnostics({
    phase,
    flux,
    noSpotFlux,
    planetDepth,
    moonDepth,
    archive: state.archive,
    target,
    params,
    timings,
    mode: quality.mode
  });

  return {
    phase,
    flux,
    metrics,
    timings,
    mode: quality.mode
  };
}

/* ============================================================================
   SOLVER QUALITY
   ============================================================================ */

function solverQuality(params) {
  const full = params.fidelity === "full";

  if (full) {
    return {
      mode: "high-accuracy numerical quadrature",
      phaseSamples: clampInteger(params.modelResolution, 900, 2200, 1440),
      rings: 82,
      azimuth: 150,
      chunkSize: 18
    };
  }

  return {
    mode: "preview numerical quadrature",
    phaseSamples: clampInteger(params.modelResolution, 360, 1100, 720),
    rings: 46,
    azimuth: 96,
    chunkSize: 28
  };
}

/* ============================================================================
   STELLAR SURFACE GRID
   ============================================================================ */

function buildStellarSurfaceGrid(params, quality) {
  const xs = [];
  const ys = [];
  const baseIntensity = [];
  const spottedIntensity = [];

  const u1 = clamp(params.u1, 0, 1);
  const u2 = clamp(params.u2, 0, 1);

  let totalBase = 0;
  let totalSpotted = 0;

  for (let rIndex = 0; rIndex < quality.rings; rIndex++) {
    const r = (rIndex + 0.5) / quality.rings;

    for (let aIndex = 0; aIndex < quality.azimuth; aIndex++) {
      const theta = TWO_PI * (aIndex + 0.5) / quality.azimuth;

      const x = r * Math.cos(theta);
      const y = r * Math.sin(theta);

      const mu = Math.sqrt(Math.max(0, 1 - r * r));
      const q = 1 - mu;

      const limb =
        Math.max(0, 1 - u1 * q - u2 * q * q);

      /*
        Polar area element is proportional to r dr dtheta.
        The constant dr dtheta cancels out in normalised flux, so r is enough.
      */
      const areaWeight = r;
      const base = limb * areaWeight;

      const spotFactor = calculateSpotFactor(x, y, params);
      const spotted = base * spotFactor;

      xs.push(x);
      ys.push(y);
      baseIntensity.push(base);
      spottedIntensity.push(spotted);

      totalBase += base;
      totalSpotted += spotted;
    }
  }

  return {
    x: new Float32Array(xs),
    y: new Float32Array(ys),
    baseIntensity: new Float32Array(baseIntensity),
    spottedIntensity: new Float32Array(spottedIntensity),
    totalBase,
    totalSpotted,
    count: xs.length
  };
}

function calculateSpotFactor(x, y, params) {
  if (!params.spotEnabled) {
    return 1;
  }

  const sx = clamp(params.spotX, -0.95, 0.95);
  const sy = clamp(params.spotY, -0.95, 0.95);
  const radius = clamp(params.spotRadius, 0.01, 0.5);
  const contrast = clamp(params.spotContrast, 0, 0.98);

  const dx = x - sx;
  const dy = y - sy;
  const d = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);

  /*
    Irregular multi-component spot morphology:
    - not a perfect circular blob
    - combines penumbra and umbra
    - still deterministic and cheap for browser physics
  */
  const irregularRadius =
    radius *
    (
      1 +
      0.17 * Math.sin(5 * angle + 0.8) +
      0.09 * Math.sin(9 * angle - 1.7) +
      0.06 * Math.sin(13 * angle + 2.3)
    );

  const penumbra =
    1 - smoothstep(
      irregularRadius,
      irregularRadius + radius * 0.36,
      d
    );

  const umbra =
    1 - smoothstep(
      irregularRadius * 0.38,
      irregularRadius * 0.38 + radius * 0.13,
      d
    );

  const darkening = clamp(
    penumbra * 0.50 + umbra * 0.50,
    0,
    1
  );

  return 1 - darkening * contrast;
}

/* ============================================================================
   PROJECTED GEOMETRY + FLUX
   ============================================================================ */

function evaluateFluxAtPhase(observedPhase, params, surface) {
  const geometry = projectedGeometry(observedPhase, params);

  let blockedSpotted = 0;
  let blockedBase = 0;
  let blockedPlanetBase = 0;
  let blockedMoonBase = 0;

  const rp = geometry.planet.radius;
  const rp2 = rp * rp;

  const rm = geometry.moon.radius;
  const rm2 = rm * rm;

  const planetCanBlock =
    geometry.planet.front &&
    circleMayOverlapStar(
      geometry.planet.x,
      geometry.planet.y,
      rp
    );

  const moonCanBlock =
    geometry.moon.enabled &&
    geometry.moon.front &&
    circleMayOverlapStar(
      geometry.moon.x,
      geometry.moon.y,
      rm
    );

  for (let i = 0; i < surface.count; i++) {
    const x = surface.x[i];
    const y = surface.y[i];

    let coveredByPlanet = false;
    let coveredByMoon = false;

    if (planetCanBlock) {
      const dxp = x - geometry.planet.x;
      const dyp = y - geometry.planet.y;
      coveredByPlanet = dxp * dxp + dyp * dyp <= rp2;
    }

    if (!coveredByPlanet && moonCanBlock) {
      const dxm = x - geometry.moon.x;
      const dym = y - geometry.moon.y;
      coveredByMoon = dxm * dxm + dym * dym <= rm2;
    }

    if (coveredByPlanet || coveredByMoon) {
      blockedSpotted += surface.spottedIntensity[i];
      blockedBase += surface.baseIntensity[i];

      if (coveredByPlanet) {
        blockedPlanetBase += surface.baseIntensity[i];
      } else if (coveredByMoon) {
        blockedMoonBase += surface.baseIntensity[i];
      }
    }
  }

  const totalSpotted = Math.max(surface.totalSpotted, 1e-12);
  const totalBase = Math.max(surface.totalBase, 1e-12);

  return {
    flux: 1 - blockedSpotted / totalSpotted,
    noSpotFlux: 1 - blockedBase / totalBase,
    planetDepth: blockedPlanetBase / totalBase,
    moonDepth: blockedMoonBase / totalBase
  };
}

function projectedGeometry(observedPhase, params) {
  const shiftedPhase = observedPhase - params.phaseShift;

  const theta = TWO_PI * shiftedPhase;

  const aRs = clamp(params.aRs, 2, 80);
  const inclination = clamp(params.inclinationDeg, 0, 90) * Math.PI / 180;

  /*
    Circular projected orbit in stellar-radius units.
    At phase = 0:
      x ≈ 0
      y ≈ impact parameter
      z > 0, so the planet is in front of the star.
  */
  const xPlanet = -aRs * Math.sin(theta);
  const yPlanet = aRs * Math.cos(inclination) * Math.cos(theta);
  const zPlanet = aRs * Math.sin(inclination) * Math.cos(theta);

  const moonPhase =
    params.moonPhaseDeg * Math.PI / 180 +
    shiftedPhase * TWO_PI * 5;

  const moonDistance = clamp(params.moonDistance, 0.02, 3.0);
  const moonX = xPlanet + moonDistance * Math.cos(moonPhase);
  const moonY = yPlanet + moonDistance * 0.58 * Math.sin(moonPhase);
  const moonZ = zPlanet + moonDistance * 0.40 * Math.sin(moonPhase);

  return {
    planet: {
      x: xPlanet,
      y: yPlanet,
      z: zPlanet,
      radius: clamp(params.rpRs, 0.001, 0.35),
      front: zPlanet > 0
    },

    moon: {
      enabled: Boolean(params.moonEnabled),
      x: moonX,
      y: moonY,
      z: moonZ,
      radius: clamp(params.moonRadius, 0.001, 0.12),
      front: moonZ > 0
    }
  };
}

function circleMayOverlapStar(x, y, radius) {
  return Math.hypot(x, y) <= 1 + radius;
}

/* ============================================================================
   DIAGNOSTICS
   ============================================================================ */

function calculateDiagnostics({
  phase,
  flux,
  noSpotFlux,
  planetDepth,
  moonDepth,
  archive,
  target,
  params,
  timings,
  mode
}) {
  const minFlux = minFinite(flux, 1);
  const modelDepthPpm = Math.max(0, (1 - minFlux) * 1e6);

  const maxPlanetDepthPpm =
    Math.max(0, maxFinite(planetDepth, 0) * 1e6);

  const maxMoonDepthPpm =
    params.moonEnabled
      ? Math.max(0, maxFinite(moonDepth, 0) * 1e6)
      : 0;

  let maxSpotBoostPpm = 0;

  if (params.spotEnabled) {
    for (let i = 0; i < flux.length; i++) {
      const boost = (flux[i] - noSpotFlux[i]) * 1e6;
      if (Number.isFinite(boost)) {
        maxSpotBoostPpm = Math.max(maxSpotBoostPpm, boost);
      }
    }
  }

  const residualRmsPpm = calculateResidualRmsPpm(
    archive,
    phase,
    flux
  );

  const ootRmsPpm = calculateOotRmsPpm(
    archive,
    target,
    params
  );

  const snr =
    Number.isFinite(ootRmsPpm) && ootRmsPpm > 0
      ? modelDepthPpm / ootRmsPpm
      : null;

  const morphologyFlags = buildMorphologyFlags({
    params,
    target,
    archive,
    mode,
    timings,
    modelDepthPpm,
    maxMoonDepthPpm,
    maxSpotBoostPpm,
    residualRmsPpm,
    ootRmsPpm,
    snr
  });

  return {
    residualRmsPpm,
    ootRmsPpm,
    snr,
    phaseShift: params.phaseShift,
    modelDepthPpm,
    maxPlanetDepthPpm,
    maxMoonDepthPpm,
    maxSpotBoostPpm,
    morphologyFlags
  };
}

function calculateResidualRmsPpm(archive, modelPhase, modelFlux) {
  if (!archive || archive.points < 3) {
    return null;
  }

  let sumSq = 0;
  let count = 0;

  for (let i = 0; i < archive.points; i++) {
    const phase = archive.phase[i];
    const flux = archive.flux[i];

    if (!Number.isFinite(phase) || !Number.isFinite(flux)) {
      continue;
    }

    const model = interpolateLinear(modelPhase, modelFlux, phase);

    if (!Number.isFinite(model)) {
      continue;
    }

    const residual = flux - model;
    sumSq += residual * residual;
    count += 1;
  }

  if (count < 3) {
    return null;
  }

  return Math.sqrt(sumSq / count) * 1e6;
}

function calculateOotRmsPpm(archive, target, params) {
  if (!archive || archive.points < 5) {
    return null;
  }

  const halfDuration = estimateTransitHalfDurationPhase(target, params);
  const threshold = Math.max(0.018, halfDuration * 1.35);

  const values = [];

  for (let i = 0; i < archive.points; i++) {
    const phase = archive.phase[i];
    const flux = archive.flux[i];

    if (!Number.isFinite(phase) || !Number.isFinite(flux)) {
      continue;
    }

    if (Math.abs(phase - params.phaseShift) > threshold) {
      values.push(flux);
    }
  }

  if (values.length < 5) {
    for (let i = 0; i < archive.points; i++) {
      const flux = archive.flux[i];

      if (Number.isFinite(flux)) {
        values.push(flux);
      }
    }
  }

  if (values.length < 5) {
    return null;
  }

  const med = median(values);

  let sumSq = 0;
  let count = 0;

  for (const value of values) {
    const diff = value - med;
    sumSq += diff * diff;
    count += 1;
  }

  return Math.sqrt(sumSq / Math.max(1, count)) * 1e6;
}

function estimateTransitHalfDurationPhase(target, params) {
  const durationHours = Number(target.pl_trandur);
  const periodDays = Number(target.pl_orbper);

  if (
    Number.isFinite(durationHours) &&
    Number.isFinite(periodDays) &&
    durationHours > 0 &&
    periodDays > 0
  ) {
    return clamp(
      (durationHours / 24) / periodDays / 2,
      0.005,
      0.15
    );
  }

  const a = Math.max(2, params.aRs);
  const rp = Math.max(0.001, params.rpRs);
  const inc = params.inclinationDeg * Math.PI / 180;
  const b = Math.abs(a * Math.cos(inc));

  if (b >= 1 + rp) {
    return 0.018;
  }

  const chord = Math.sqrt(Math.max(0, (1 + rp) ** 2 - b * b));
  return clamp(chord / (TWO_PI * a), 0.005, 0.15);
}

function buildMorphologyFlags({
  params,
  archive,
  mode,
  timings,
  modelDepthPpm,
  maxMoonDepthPpm,
  maxSpotBoostPpm,
  residualRmsPpm,
  ootRmsPpm,
  snr
}) {
  const flags = [];

  if (mode.includes("high-accuracy")) {
    flags.push("high-accuracy quadrature");
  } else {
    flags.push("preview quadrature");
  }

  flags.push(`${timings.rings}x${timings.azimuth} disk quadrature`);
  flags.push("quadratic limb darkening");

  if (archive?.points > 0) {
    flags.push("archival photometry loaded");
  } else {
    flags.push("synthetic fallback data");
  }

  if (params.moonEnabled) {
    flags.push("moon hypothesis active");

    if (maxMoonDepthPpm > 0) {
      flags.push(`moon signal ${Math.round(maxMoonDepthPpm)} ppm`);
    }
  }

  if (params.spotEnabled) {
    flags.push("starspot morphology active");

    if (maxSpotBoostPpm > 0) {
      flags.push(`spot anomaly ${Math.round(maxSpotBoostPpm)} ppm`);
    }
  }

  if (Number.isFinite(snr)) {
    if (snr >= 10) {
      flags.push("high S/N transit");
    } else if (snr >= 4) {
      flags.push("moderate S/N transit");
    } else {
      flags.push("low S/N fit");
    }
  }

  if (
    Number.isFinite(residualRmsPpm) &&
    Number.isFinite(ootRmsPpm) &&
    ootRmsPpm > 0
  ) {
    const ratio = residualRmsPpm / ootRmsPpm;

    if (ratio < 1.25) {
      flags.push("residuals near noise floor");
    } else if (ratio < 2.5) {
      flags.push("moderate residual structure");
    } else {
      flags.push("visible model mismatch");
    }
  }

  if (modelDepthPpm > 50000) {
    flags.push("deep transit geometry");
  }

  return flags;
}

/* ============================================================================
   PHASE GRID
   ============================================================================ */

function determinePhaseRange(archive, target, params) {
  let min = Infinity;
  let max = -Infinity;

  if (archive && archive.points > 2) {
    for (let i = 0; i < archive.points; i++) {
      const phase = archive.phase[i];

      if (Number.isFinite(phase)) {
        min = Math.min(min, phase);
        max = Math.max(max, phase);
      }
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    const halfDuration = estimateTransitHalfDurationPhase(target, params);
    const span = clamp(halfDuration * 4.5, 0.09, 0.22);

    min = -span;
    max = span;
  }

  const centre = 0.5 * (min + max);
  const half = Math.max(0.045, 0.5 * (max - min));

  return {
    min: centre - half,
    max: centre + half
  };
}

function createPhaseGrid(min, max, count) {
  const n = Math.max(8, count);
  const phase = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    phase[i] = min + (max - min) * i / (n - 1);
  }

  return phase;
}

/* ============================================================================
   DATA NORMALISATION
   ============================================================================ */

function normaliseParams(input) {
  const p = {
    ...DEFAULT_PARAMS,
    ...input
  };

  return {
    rpRs: clamp(numberValue(p.rpRs, DEFAULT_PARAMS.rpRs), 0.001, 0.35),
    aRs: clamp(numberValue(p.aRs, DEFAULT_PARAMS.aRs), 2, 80),
    inclinationDeg: clamp(numberValue(p.inclinationDeg, DEFAULT_PARAMS.inclinationDeg), 0, 90),
    eccentricity: clamp(numberValue(p.eccentricity, DEFAULT_PARAMS.eccentricity), 0, 0.95),

    u1: clamp(numberValue(p.u1, DEFAULT_PARAMS.u1), 0, 1),
    u2: clamp(numberValue(p.u2, DEFAULT_PARAMS.u2), 0, 1),

    spotEnabled: Boolean(p.spotEnabled),
    spotX: clamp(numberValue(p.spotX, DEFAULT_PARAMS.spotX), -0.95, 0.95),
    spotY: clamp(numberValue(p.spotY, DEFAULT_PARAMS.spotY), -0.95, 0.95),
    spotRadius: clamp(numberValue(p.spotRadius, DEFAULT_PARAMS.spotRadius), 0.005, 0.6),
    spotContrast: clamp(numberValue(p.spotContrast, DEFAULT_PARAMS.spotContrast), 0, 0.98),

    moonEnabled: Boolean(p.moonEnabled),
    moonRadius: clamp(numberValue(p.moonRadius, DEFAULT_PARAMS.moonRadius), 0.001, 0.12),
    moonDistance: clamp(numberValue(p.moonDistance, DEFAULT_PARAMS.moonDistance), 0.02, 3.0),
    moonPhaseDeg: numberValue(p.moonPhaseDeg, DEFAULT_PARAMS.moonPhaseDeg),

    phaseShift: clamp(numberValue(p.phaseShift, DEFAULT_PARAMS.phaseShift), -0.2, 0.2),
    modelResolution: clampInteger(p.modelResolution, 200, 2500, DEFAULT_PARAMS.modelResolution),
    fidelity: p.fidelity === "full" ? "full" : "preview",
    visualQuality: typeof p.visualQuality === "string" ? p.visualQuality : "balanced"
  };
}

function normaliseTarget(input) {
  const t = {
    ...DEFAULT_TARGET,
    ...(input || {})
  };

  return {
    pl_name: stringValue(t.pl_name, DEFAULT_TARGET.pl_name),
    hostname: stringValue(t.hostname, DEFAULT_TARGET.hostname),
    pl_orbper: numberValue(t.pl_orbper, DEFAULT_TARGET.pl_orbper),
    pl_trandur: numberValue(t.pl_trandur, DEFAULT_TARGET.pl_trandur),
    pl_trandep: numberValue(t.pl_trandep, DEFAULT_TARGET.pl_trandep),
    st_teff: numberValue(t.st_teff, DEFAULT_TARGET.st_teff),
    st_rad: numberValue(t.st_rad, DEFAULT_TARGET.st_rad),
    st_mass: numberValue(t.st_mass, DEFAULT_TARGET.st_mass)
  };
}

/* ============================================================================
   MATH HELPERS
   ============================================================================ */

function interpolateLinear(xArray, yArray, x) {
  const n = xArray.length;

  if (n < 2) {
    return NaN;
  }

  if (x < xArray[0] || x > xArray[n - 1]) {
    return NaN;
  }

  let lo = 0;
  let hi = n - 1;

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

  if (x1 === x0) {
    return y0;
  }

  const t = (x - x0) / (x1 - x0);

  return y0 + t * (y1 - y0);
}

function median(values) {
  const clean = values
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!clean.length) {
    return NaN;
  }

  const mid = Math.floor(clean.length / 2);

  if (clean.length % 2) {
    return clean[mid];
  }

  return 0.5 * (clean[mid - 1] + clean[mid]);
}

function minFinite(array, fallback) {
  let value = Infinity;

  for (const x of array) {
    if (Number.isFinite(x)) {
      value = Math.min(value, x);
    }
  }

  return Number.isFinite(value) ? value : fallback;
}

function maxFinite(array, fallback) {
  let value = -Infinity;

  for (const x of array) {
    if (Number.isFinite(x)) {
      value = Math.max(value, x);
    }
  }

  return Number.isFinite(value) ? value : fallback;
}

function numberValue(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function stringValue(value, fallback = "") {
  if (value === null || value === undefined) {
    return fallback;
  }

  const text = String(value).trim();
  return text || fallback;
}

function clamp(value, min, max) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return min;
  }

  return Math.min(max, Math.max(min, n));
}

function clampInteger(value, min, max, fallback) {
  const n = Math.round(Number(value));

  if (!Number.isFinite(n)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, n));
}

function smoothstep(edge0, edge1, x) {
  if (edge0 === edge1) {
    return x < edge0 ? 0 : 1;
  }

  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
