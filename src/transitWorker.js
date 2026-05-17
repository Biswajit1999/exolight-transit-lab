/* ============================================================================
   ExoIntel-Prime
   Transit Worker Lifecycle + Latest-State Mailbox Framework
   ---------------------------------------------------------------------------
   Responsibilities:
   - Keep heavy theoretical transit modelling off the main thread.
   - Maintain one active solve and one pending latest snapshot.
   - Cooperatively yield during long calculations.
   - Abort stale work when newer revisions arrive.
   - Return model arrays through transferable ArrayBuffers.

   This file currently contains a mock scientific solver with physically shaped
   transit curves, starspot perturbation, moon perturbation, and diagnostics.
   The real Mandel & Agol / polar quadrature kernel can be injected inside
   solveTransitArchitecture() without changing the mailbox protocol.
   ============================================================================ */

const WORKER_PROTOCOL = "latest-state-mailbox-v1";

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
      newestRequestedRevision
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
  const n = clampInt(params.modelResolution || (full ? 1440 : 720), 120, full ? 3000 : 1200);

  const phase = new Float32Array(n);
  const flux = new Float32Array(n);

  const periodDays = numberValue(target.pl_orbper, 3);
  const durationHours = numberValue(target.pl_trandur, 2.5);
  const durationPhase = clamp(durationHours / 24 / Math.max(0.1, periodDays), 0.006, 0.12);

  const phaseMin = -Math.max(0.12, durationPhase * 4.2);
  const phaseMax = Math.max(0.12, durationPhase * 4.2);

  const depthBase = clamp(params.rpRs * params.rpRs, 0.000001, 0.09);
  const impact = Math.abs(params.aRs * Math.cos(params.inclinationDeg * Math.PI / 180));
  const grazingFactor = clamp(1.0 - Math.max(0, impact - 0.75) * 0.75, 0.15, 1.0);
  const limbFactor = clamp(1.0 - 0.20 * params.u1 - 0.10 * params.u2, 0.55, 1.15);
  const modelDepth = depthBase * grazingFactor * limbFactor;

  const chunkSize = full ? 80 : 120;
  const totalChunks = Math.ceil(n / chunkSize);

  for (let start = 0, chunk = 0; start < n; start += chunkSize, chunk++) {
    if (isObsolete(revision)) {
      return null;
    }

    const end = Math.min(n, start + chunkSize);

    for (let i = start; i < end; i++) {
      const x = phaseMin + (phaseMax - phaseMin) * i / Math.max(1, n - 1);
      phase[i] = x;

      const shifted = x - params.phaseShift;
      const transitShape = smoothTransitProfile(shifted, durationPhase, params);
      let theoreticalFlux = 1 - modelDepth * transitShape;

      if (params.spotEnabled) {
        theoreticalFlux += starspotAnomaly(shifted, params, durationPhase, modelDepth);
      }

      if (params.moonEnabled) {
        theoreticalFlux -= moonTransitContribution(shifted, params, durationPhase);
      }

      flux[i] = theoreticalFlux;
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
    modelDepth
  });

  const t1 = performance.now();

  return {
    phase,
    flux,
    mode: full ? "full-fidelity" : "preview",
    metrics,
    timings: {
      startedAt: t0,
      finishedAt: t1,
      elapsedMs: t1 - t0,
      samples: n
    }
  };
}

function smoothTransitProfile(phase, durationPhase, params) {
  const half = Math.max(0.002, durationPhase * 0.5);
  const ingress = Math.max(0.0015, durationPhase * 0.14);
  const x = Math.abs(phase);

  if (x > half + ingress) {
    return 0;
  }

  if (x < half - ingress) {
    const centre = 1 - 0.08 * Math.pow(x / Math.max(1e-6, half), 2);
    return clamp(centre, 0, 1);
  }

  const edgeDistance = (x - (half - ingress)) / Math.max(1e-6, ingress * 2);
  const softened = 1 - smootherstep(clamp(edgeDistance, 0, 1));

  return clamp(softened, 0, 1);
}

function starspotAnomaly(phase, params, durationPhase, modelDepth) {
  const spotPhase = clamp(params.spotX * durationPhase * 1.5, -0.08, 0.08);
  const width = clamp(params.spotRadius * durationPhase * 2.8, 0.002, 0.035);
  const amplitude = modelDepth * clamp(params.spotContrast, 0.05, 0.95) * clamp(params.spotRadius * 2.2, 0.02, 0.45);
  const profile = Math.exp(-0.5 * ((phase - spotPhase) / Math.max(0.001, width)) ** 2);

  return amplitude * profile;
}

function moonTransitContribution(phase, params, durationPhase) {
  const moonOffset = (params.moonPhaseDeg / 360 - 0.5) * durationPhase * 5.0;
  const moonWidth = clamp(durationPhase * 0.22, 0.002, 0.018);
  const depth = clamp(params.moonRadius * params.moonRadius, 0.0000001, 0.006);
  const distanceAttenuation = clamp(1.25 - params.moonDistance * 0.22, 0.25, 1.0);
  const profile = Math.exp(-0.5 * ((phase - moonOffset) / moonWidth) ** 2);

  return depth * distanceAttenuation * profile;
}

function computeScientificMetrics({
  modelPhase,
  modelFlux,
  archivalPhase,
  archivalFlux,
  params,
  target,
  modelDepth
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
  const modelDepthPpm = modelDepth * 1e6;
  const ootRmsPpm = Number.isFinite(ootRms) ? ootRms * 1e6 : null;
  const residualRmsPpm = Number.isFinite(residualRms) ? residualRms * 1e6 : null;
  const snr = Number.isFinite(ootRmsPpm) && ootRmsPpm > 0 ? modelDepthPpm / ootRmsPpm : null;

  const morphologyFlags = [];

  if (params.spotEnabled) {
    morphologyFlags.push("spot hypothesis active");
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

  if (!morphologyFlags.length) {
    morphologyFlags.push("baseline transit model");
  }

  return {
    residualRmsPpm,
    ootRmsPpm,
    snr,
    phaseShift: params.phaseShift,
    modelDepthPpm,
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
    modelResolution: clampInt(params.modelResolution || 720, 120, 3000),
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

function smootherstep(x) {
  const t = clamp(x, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}
