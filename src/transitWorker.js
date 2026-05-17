/* ============================================================================
   ExoIntel-Prime Recovery Transit Physics Worker
   - Latest-state mailbox
   - Quadratic limb-darkened numerical transit model
   - Finite exposure integration
   - Approximate eccentric geometry
   - Starspot and exomoon hypothesis terms
   ============================================================================ */

const WORKER_VERSION = "20260517-recovery-03";
const TWO_PI = Math.PI * 2;

const DEFAULT_PARAMS = Object.freeze({
  rpRs: 0.1, aRs: 12, inclinationDeg: 88.5, eccentricity: 0, omegaDeg: 90,
  u1: 0.32, u2: 0.28,
  spotEnabled: false, spotX: 0.2, spotY: 0.1, spotRadius: 0.12, spotContrast: 0.55,
  moonEnabled: false, moonRadius: 0.025, moonDistance: 0.55, moonPhaseDeg: 45,
  phaseShift: 0, exposureIntegration: true, exposureSamples: 5, exposurePhaseWidth: 0,
  modelResolution: 720, fidelity: "preview", visualQuality: "balanced"
});

const DEFAULT_TARGET = Object.freeze({
  pl_name: "Synthetic Hot Jupiter", hostname: "Demonstration Host", pl_orbper: 3,
  pl_trandur: 2.4, pl_trandep: 10000, pl_orbeccen: 0, pl_orblper: 90,
  st_teff: 5772, st_rad: 1, st_mass: 1
});

const state = {
  workerActive: false,
  pendingJob: null,
  latestRevisionSeen: 0,
  target: { ...DEFAULT_TARGET },
  archive: { phase: new Float32Array(0), flux: new Float32Array(0), error: new Float32Array(0), points: 0, source: "none" }
};

self.addEventListener("message", event => {
  const msg = event.data;
  if (!msg || typeof msg !== "object") return;
  try {
    if (msg.type === "configure") {
      postMessage({ type: "ready", version: WORKER_VERSION, protocol: msg.protocol || "latest-state-mailbox" });
      return;
    }
    if (msg.type === "data") {
      handleData(msg);
      return;
    }
    if (msg.type === "solve") {
      handleSolve(msg);
      return;
    }
    postMessage({ type: "warning", message: `Unknown worker message type: ${String(msg.type)}` });
  } catch (error) {
    postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
});

function handleData(message) {
  const archival = message.archival || {};
  state.target = normaliseTarget(message.target || state.target);
  state.archive = {
    phase: archival.phaseBuffer instanceof ArrayBuffer ? new Float32Array(archival.phaseBuffer) : new Float32Array(0),
    flux: archival.fluxBuffer instanceof ArrayBuffer ? new Float32Array(archival.fluxBuffer) : new Float32Array(0),
    error: archival.errorBuffer instanceof ArrayBuffer ? new Float32Array(archival.errorBuffer) : new Float32Array(0),
    points: Number.isFinite(Number(archival.points)) ? Number(archival.points) : 0,
    source: String(archival.source || "local archive")
  };
  state.archive.points = Math.min(state.archive.points, state.archive.phase.length, state.archive.flux.length);
  postMessage({ type: "data-ready", points: state.archive.points, source: state.archive.source });
}

function handleSolve(message) {
  const revision = Number(message.revision);
  if (!Number.isFinite(revision)) {
    postMessage({ type: "error", message: "Solve request missing finite revision number." });
    return;
  }
  state.latestRevisionSeen = Math.max(state.latestRevisionSeen, revision);
  state.pendingJob = { revision, target: normaliseTarget(message.target || state.target), params: normaliseParams(message.params || {}) };
  postMessage({ type: "accepted", revision });
  drainMailbox();
}

async function drainMailbox() {
  if (state.workerActive) return;
  while (state.pendingJob) {
    const job = state.pendingJob;
    state.pendingJob = null;
    state.workerActive = true;
    try {
      const result = await solveTransit(job);
      if (result?.obsolete) {
        postMessage({ type: "obsolete", revision: job.revision });
      } else if (result) {
        postMessage({ type: "result", revision: job.revision, mode: result.mode, phaseBuffer: result.phase.buffer, fluxBuffer: result.flux.buffer, metrics: result.metrics, timings: result.timings }, [result.phase.buffer, result.flux.buffer]);
      }
    } catch (error) {
      postMessage({ type: "error", revision: job.revision, message: error instanceof Error ? error.message : String(error) });
    } finally {
      state.workerActive = false;
    }
  }
}

function shouldAbort(revision) { return Boolean(state.pendingJob && Number.isFinite(state.pendingJob.revision) && state.pendingJob.revision > revision); }
function yieldToEventLoop() { return new Promise(resolve => setTimeout(resolve, 0)); }

async function solveTransit(job) {
  const started = performance.now();
  const params = normaliseParams(job.params);
  const target = normaliseTarget(job.target);
  const quality = solverQuality(params);
  const range = determinePhaseRange(state.archive, target, params);
  const phase = createPhaseGrid(range.min, range.max, quality.phaseSamples);
  const surface = buildSurface(params, quality);
  const exposure = determineExposure(state.archive, target, params, quality);
  const flux = new Float32Array(phase.length);
  const noSpotFlux = new Float32Array(phase.length);
  const planetDepth = new Float32Array(phase.length);
  const moonDepth = new Float32Array(phase.length);

  for (let i = 0; i < phase.length; i++) {
    if (i > 0 && i % quality.chunkSize === 0) {
      postMessage({ type: "progress", revision: job.revision, progress: i / phase.length });
      await yieldToEventLoop();
      if (shouldAbort(job.revision)) return { obsolete: true };
    }
    const s = evaluateExposure(phase[i], params, surface, exposure);
    flux[i] = s.flux;
    noSpotFlux[i] = s.noSpotFlux;
    planetDepth[i] = s.planetDepth;
    moonDepth[i] = s.moonDepth;
  }
  if (shouldAbort(job.revision)) return { obsolete: true };

  const timings = { elapsedMs: performance.now() - started, samples: phase.length, rings: quality.rings, azimuth: quality.azimuth, surfaceSamples: surface.count, exposureSamples: exposure.samples, exposurePhaseWidth: exposure.phaseWidth, geometryMode: params.eccentricity > 1e-5 ? "eccentric" : "circular" };
  const metrics = diagnostics({ phase, flux, noSpotFlux, planetDepth, moonDepth, archive: state.archive, target, params, timings, mode: quality.mode });
  return { phase, flux, metrics, timings, mode: quality.mode };
}

function solverQuality(params) {
  if (params.fidelity === "full") return { mode: "high-accuracy numerical quadrature", phaseSamples: clampInteger(params.modelResolution, 900, 2600, 1440), rings: 88, azimuth: 164, chunkSize: 16 };
  return { mode: "preview numerical quadrature", phaseSamples: clampInteger(params.modelResolution, 360, 1200, 720), rings: 52, azimuth: 108, chunkSize: 24 };
}

function determineExposure(archive, target, params, quality) {
  if (!params.exposureIntegration) return { enabled: false, samples: 1, phaseWidth: 0 };
  let phaseWidth = params.exposurePhaseWidth > 0 ? params.exposurePhaseWidth : inferExposureWidth(archive, target);
  phaseWidth = clamp(phaseWidth, 0, 0.04);
  const maxSamples = quality.mode.includes("high-accuracy") ? 15 : 9;
  const fallback = quality.mode.includes("high-accuracy") ? 9 : 5;
  const samples = phaseWidth > 0 ? clampInteger(params.exposureSamples, 1, maxSamples, fallback) : 1;
  return { enabled: samples > 1 && phaseWidth > 0, samples, phaseWidth };
}
function inferExposureWidth(archive, target) { const med = medianPositivePhaseSpacing(archive); if (Number.isFinite(med) && med > 0) return clamp(med, 0.00005, 0.02); const period = Number(target.pl_orbper); if (Number.isFinite(period) && period > 0) return clamp(2 / (1440 * period), 0.00002, 0.006); return 0; }
function medianPositivePhaseSpacing(archive) { if (!archive || archive.points < 4) return NaN; const v = []; for (let i = 1; i < archive.points; i++) { const d = Math.abs(archive.phase[i] - archive.phase[i-1]); if (Number.isFinite(d) && d > 0 && d < 0.1) v.push(d); } return v.length < 3 ? NaN : median(v); }

function evaluateExposure(centralPhase, params, surface, exposure) {
  if (!exposure.enabled || exposure.samples <= 1 || exposure.phaseWidth <= 0) return evaluateFluxAtPhase(centralPhase, params, surface);
  let flux = 0, noSpotFlux = 0, planetDepth = 0, moonDepth = 0;
  for (let i = 0; i < exposure.samples; i++) {
    const f = exposure.samples === 1 ? 0 : (i / (exposure.samples - 1)) - 0.5;
    const s = evaluateFluxAtPhase(centralPhase + f * exposure.phaseWidth, params, surface);
    flux += s.flux; noSpotFlux += s.noSpotFlux; planetDepth += s.planetDepth; moonDepth += s.moonDepth;
  }
  const inv = 1 / exposure.samples;
  return { flux: flux * inv, noSpotFlux: noSpotFlux * inv, planetDepth: planetDepth * inv, moonDepth: moonDepth * inv };
}

function buildSurface(params, quality) {
  const xs = [], ys = [], baseIntensity = [], spottedIntensity = [];
  let totalBase = 0, totalSpotted = 0;
  const u1 = clamp(params.u1, 0, 1), u2 = clamp(params.u2, 0, 1);
  for (let rIndex = 0; rIndex < quality.rings; rIndex++) {
    const r = (rIndex + 0.5) / quality.rings;
    for (let aIndex = 0; aIndex < quality.azimuth; aIndex++) {
      const theta = TWO_PI * (aIndex + 0.5) / quality.azimuth;
      const x = r * Math.cos(theta), y = r * Math.sin(theta);
      const mu = Math.sqrt(Math.max(0, 1 - r * r));
      const q = 1 - mu;
      const limb = Math.max(0, 1 - u1 * q - u2 * q * q);
      const base = limb * r;
      const spotted = base * calculateSpotFactor(x, y, params);
      xs.push(x); ys.push(y); baseIntensity.push(base); spottedIntensity.push(spotted); totalBase += base; totalSpotted += spotted;
    }
  }
  return { x: new Float32Array(xs), y: new Float32Array(ys), baseIntensity: new Float32Array(baseIntensity), spottedIntensity: new Float32Array(spottedIntensity), totalBase, totalSpotted, count: xs.length };
}
function calculateSpotFactor(x, y, params) {
  if (!params.spotEnabled) return 1;
  const sx = clamp(params.spotX, -0.95, 0.95), sy = clamp(params.spotY, -0.95, 0.95), radius = clamp(params.spotRadius, 0.01, 0.5), contrast = clamp(params.spotContrast, 0, 0.98);
  const dx = x - sx, dy = y - sy, d = Math.hypot(dx, dy), angle = Math.atan2(dy, dx);
  const irregularRadius = radius * (1 + 0.17 * Math.sin(5 * angle + 0.8) + 0.09 * Math.sin(9 * angle - 1.7) + 0.06 * Math.sin(13 * angle + 2.3));
  const penumbra = 1 - smoothstep(irregularRadius, irregularRadius + radius * 0.36, d);
  const umbra = 1 - smoothstep(irregularRadius * 0.38, irregularRadius * 0.38 + radius * 0.13, d);
  return 1 - clamp(penumbra * 0.5 + umbra * 0.5, 0, 1) * contrast;
}

function evaluateFluxAtPhase(observedPhase, params, surface) {
  const g = projectedGeometry(observedPhase, params);
  let blockedSpotted = 0, blockedBase = 0, blockedPlanetBase = 0, blockedMoonBase = 0;
  const rp2 = g.planet.radius * g.planet.radius, rm2 = g.moon.radius * g.moon.radius;
  const planetCanBlock = g.planet.front && circleMayOverlapStar(g.planet.x, g.planet.y, g.planet.radius);
  const moonCanBlock = g.moon.enabled && g.moon.front && circleMayOverlapStar(g.moon.x, g.moon.y, g.moon.radius);
  for (let i = 0; i < surface.count; i++) {
    const x = surface.x[i], y = surface.y[i];
    let coveredByPlanet = false, coveredByMoon = false;
    if (planetCanBlock) { const dx = x - g.planet.x, dy = y - g.planet.y; coveredByPlanet = dx * dx + dy * dy <= rp2; }
    if (!coveredByPlanet && moonCanBlock) { const dx = x - g.moon.x, dy = y - g.moon.y; coveredByMoon = dx * dx + dy * dy <= rm2; }
    if (coveredByPlanet || coveredByMoon) { blockedSpotted += surface.spottedIntensity[i]; blockedBase += surface.baseIntensity[i]; if (coveredByPlanet) blockedPlanetBase += surface.baseIntensity[i]; else blockedMoonBase += surface.baseIntensity[i]; }
  }
  const totalSpotted = Math.max(surface.totalSpotted, 1e-12), totalBase = Math.max(surface.totalBase, 1e-12);
  return { flux: 1 - blockedSpotted / totalSpotted, noSpotFlux: 1 - blockedBase / totalBase, planetDepth: blockedPlanetBase / totalBase, moonDepth: blockedMoonBase / totalBase };
}
function projectedGeometry(observedPhase, params) {
  const shiftedPhase = observedPhase - params.phaseShift;
  const e = clamp(params.eccentricity, 0, 0.95), omega = degToRad(params.omegaDeg), inc = degToRad(clamp(params.inclinationDeg, 0, 90)), aRs = clamp(params.aRs, 2, 100);
  let x, y, z, r;
  if (e > 1e-5) {
    const f0 = wrapRadians(Math.PI / 2 - omega);
    const e0 = trueAnomalyToEccentricAnomaly(f0, e);
    const m0 = eccentricAnomalyToMeanAnomaly(e0, e);
    const E = solveKepler(m0 + TWO_PI * shiftedPhase, e);
    const f = eccentricAnomalyToTrueAnomaly(E, e);
    r = aRs * (1 - e * e) / Math.max(1e-8, 1 + e * Math.cos(f));
    const u = omega + f;
    x = -r * Math.cos(u); y = r * Math.sin(u) * Math.cos(inc); z = r * Math.sin(u) * Math.sin(inc);
  } else {
    const theta = TWO_PI * shiftedPhase; r = aRs; x = -aRs * Math.sin(theta); y = aRs * Math.cos(inc) * Math.cos(theta); z = aRs * Math.sin(inc) * Math.cos(theta);
  }
  const moonPhase = degToRad(params.moonPhaseDeg) + shiftedPhase * TWO_PI * 5;
  const md = clamp(params.moonDistance, 0.02, 3.0);
  return { planet: { x, y, z, radius: clamp(params.rpRs, 0.001, 0.35), front: z > 0, orbitalRadiusRs: r }, moon: { enabled: Boolean(params.moonEnabled), x: x + md * Math.cos(moonPhase), y: y + md * 0.58 * Math.sin(moonPhase), z: z + md * 0.40 * Math.sin(moonPhase), radius: clamp(params.moonRadius, 0.001, 0.12), front: z + md * 0.40 * Math.sin(moonPhase) > 0 } };
}
function circleMayOverlapStar(x, y, radius) { return Math.hypot(x, y) <= 1 + radius; }

function diagnostics({ phase, flux, noSpotFlux, planetDepth, moonDepth, archive, target, params, timings, mode }) {
  const minFlux = minFinite(flux, 1);
  const modelDepthPpm = Math.max(0, (1 - minFlux) * 1e6);
  const maxPlanetDepthPpm = Math.max(0, maxFinite(planetDepth, 0) * 1e6);
  const maxMoonDepthPpm = params.moonEnabled ? Math.max(0, maxFinite(moonDepth, 0) * 1e6) : 0;
  let maxSpotBoostPpm = 0;
  if (params.spotEnabled) for (let i = 0; i < flux.length; i++) { const boost = (flux[i] - noSpotFlux[i]) * 1e6; if (Number.isFinite(boost)) maxSpotBoostPpm = Math.max(maxSpotBoostPpm, boost); }
  const residualRmsPpm = residualRms(archive, phase, flux);
  const ootRmsPpm = ootRms(archive, target, params);
  const snr = Number.isFinite(ootRmsPpm) && ootRmsPpm > 0 ? modelDepthPpm / ootRmsPpm : null;
  const morphologyFlags = buildFlags({ params, archive, mode, timings, modelDepthPpm, maxMoonDepthPpm, maxSpotBoostPpm, residualRmsPpm, ootRmsPpm, snr });
  return { residualRmsPpm, ootRmsPpm, snr, phaseShift: params.phaseShift, modelDepthPpm, maxPlanetDepthPpm, maxMoonDepthPpm, maxSpotBoostPpm, geometryMode: timings.geometryMode, exposurePhaseWidth: timings.exposurePhaseWidth, exposureSamples: timings.exposureSamples, morphologyFlags };
}
function residualRms(archive, modelPhase, modelFlux) { if (!archive || archive.points < 3) return null; let sumSq=0,count=0; for(let i=0;i<archive.points;i++){const ph=archive.phase[i],fl=archive.flux[i]; if(!Number.isFinite(ph)||!Number.isFinite(fl))continue; const m=interpolateLinear(modelPhase,modelFlux,ph); if(!Number.isFinite(m))continue; const r=fl-m; sumSq+=r*r; count++;} return count < 3 ? null : Math.sqrt(sumSq/count)*1e6; }
function ootRms(archive, target, params) { if (!archive || archive.points < 5) return null; const half = estimateTransitHalfDurationPhase(target, params); const threshold = Math.max(0.018, half * 1.35); const values=[]; for(let i=0;i<archive.points;i++){const ph=archive.phase[i], fl=archive.flux[i]; if(Number.isFinite(ph)&&Number.isFinite(fl)&&Math.abs(ph-params.phaseShift)>threshold) values.push(fl);} if(values.length<5) for(let i=0;i<archive.points;i++) if(Number.isFinite(archive.flux[i])) values.push(archive.flux[i]); if(values.length<5) return null; const med=median(values); let ss=0; for(const v of values) ss+=(v-med)**2; return Math.sqrt(ss/values.length)*1e6; }
function estimateTransitHalfDurationPhase(target, params) { const dur=Number(target.pl_trandur), per=Number(target.pl_orbper); if(Number.isFinite(dur)&&Number.isFinite(per)&&dur>0&&per>0) return clamp((dur/24)/per/2, .005, .15); const a=Math.max(2,params.aRs), rp=Math.max(.001,params.rpRs), inc=degToRad(params.inclinationDeg), b=Math.abs(a*Math.cos(inc)); if(b>=1+rp) return .018; return clamp(Math.sqrt(Math.max(0,(1+rp)**2-b*b))/(TWO_PI*a),.005,.15); }
function buildFlags({ params, archive, mode, timings, modelDepthPpm, maxMoonDepthPpm, maxSpotBoostPpm, residualRmsPpm, ootRmsPpm, snr }) { const flags=[]; flags.push(mode.includes("high-accuracy") ? "high-accuracy quadrature" : "preview quadrature"); flags.push(`${timings.rings}x${timings.azimuth} disk quadrature`); flags.push("quadratic limb darkening"); flags.push(timings.geometryMode === "eccentric" ? `eccentric geometry e=${params.eccentricity.toFixed(3)}` : "circular geometry"); if(timings.exposureSamples>1 && timings.exposurePhaseWidth>0) flags.push(`${timings.exposureSamples}-sample exposure integration`); else flags.push("instantaneous exposure model"); flags.push(archive?.points>0 ? "archival photometry loaded" : "synthetic fallback data"); if(params.moonEnabled){flags.push("moon hypothesis active"); if(maxMoonDepthPpm>0) flags.push(`moon signal ${Math.round(maxMoonDepthPpm)} ppm`);} if(params.spotEnabled){flags.push("starspot morphology active"); if(maxSpotBoostPpm>0) flags.push(`spot anomaly ${Math.round(maxSpotBoostPpm)} ppm`);} if(Number.isFinite(snr)) flags.push(snr>=10?"high depth contrast":snr>=4?"moderate depth contrast":"low depth contrast"); if(Number.isFinite(residualRmsPpm)&&Number.isFinite(ootRmsPpm)&&ootRmsPpm>0){const ratio=residualRmsPpm/ootRmsPpm; flags.push(ratio<1.25?"residuals near noise floor":ratio<2.5?"moderate residual structure":"visible model mismatch");} if(modelDepthPpm>50000) flags.push("deep transit geometry"); return flags; }
function determinePhaseRange(archive, target, params) { let min=Infinity,max=-Infinity; if(archive&&archive.points>2) for(let i=0;i<archive.points;i++){const p=archive.phase[i]; if(Number.isFinite(p)){min=Math.min(min,p); max=Math.max(max,p);}} if(!Number.isFinite(min)||!Number.isFinite(max)||min===max){const half=estimateTransitHalfDurationPhase(target,params); const span=clamp(half*4.5,.09,.22); min=-span; max=span;} const centre=.5*(min+max), half=Math.max(.045,.5*(max-min)); return {min:centre-half,max:centre+half}; }
function createPhaseGrid(min,max,count){const n=Math.max(8,count); const arr=new Float32Array(n); for(let i=0;i<n;i++) arr[i]=min+(max-min)*i/(n-1); return arr;}
function normaliseParams(input){const p={...DEFAULT_PARAMS,...input};return{rpRs:clamp(numberValue(p.rpRs,DEFAULT_PARAMS.rpRs),.001,.35),aRs:clamp(numberValue(p.aRs,DEFAULT_PARAMS.aRs),2,100),inclinationDeg:clamp(numberValue(p.inclinationDeg,DEFAULT_PARAMS.inclinationDeg),0,90),eccentricity:clamp(numberValue(p.eccentricity,DEFAULT_PARAMS.eccentricity),0,.95),omegaDeg:normaliseDegrees(numberValue(p.omegaDeg,DEFAULT_PARAMS.omegaDeg)),u1:clamp(numberValue(p.u1,DEFAULT_PARAMS.u1),0,1),u2:clamp(numberValue(p.u2,DEFAULT_PARAMS.u2),0,1),spotEnabled:Boolean(p.spotEnabled),spotX:clamp(numberValue(p.spotX,DEFAULT_PARAMS.spotX),-.95,.95),spotY:clamp(numberValue(p.spotY,DEFAULT_PARAMS.spotY),-.95,.95),spotRadius:clamp(numberValue(p.spotRadius,DEFAULT_PARAMS.spotRadius),.005,.6),spotContrast:clamp(numberValue(p.spotContrast,DEFAULT_PARAMS.spotContrast),0,.98),moonEnabled:Boolean(p.moonEnabled),moonRadius:clamp(numberValue(p.moonRadius,DEFAULT_PARAMS.moonRadius),.001,.12),moonDistance:clamp(numberValue(p.moonDistance,DEFAULT_PARAMS.moonDistance),.02,3),moonPhaseDeg:normaliseDegrees(numberValue(p.moonPhaseDeg,DEFAULT_PARAMS.moonPhaseDeg)),phaseShift:clamp(numberValue(p.phaseShift,DEFAULT_PARAMS.phaseShift),-.2,.2),exposureIntegration:Boolean(p.exposureIntegration),exposureSamples:clampInteger(p.exposureSamples,1,21,DEFAULT_PARAMS.exposureSamples),exposurePhaseWidth:clamp(numberValue(p.exposurePhaseWidth,DEFAULT_PARAMS.exposurePhaseWidth),0,.05),modelResolution:clampInteger(p.modelResolution,200,3000,DEFAULT_PARAMS.modelResolution),fidelity:p.fidelity==="full"?"full":"preview",visualQuality:typeof p.visualQuality==="string"?p.visualQuality:"balanced"};}
function normaliseTarget(input){const t={...DEFAULT_TARGET,...(input||{})};return{pl_name:stringValue(t.pl_name,DEFAULT_TARGET.pl_name),hostname:stringValue(t.hostname,DEFAULT_TARGET.hostname),pl_orbper:numberValue(t.pl_orbper,DEFAULT_TARGET.pl_orbper),pl_trandur:numberValue(t.pl_trandur,DEFAULT_TARGET.pl_trandur),pl_trandep:numberValue(t.pl_trandep,DEFAULT_TARGET.pl_trandep),pl_orbeccen:numberValue(t.pl_orbeccen,DEFAULT_TARGET.pl_orbeccen),pl_orblper:numberValue(t.pl_orblper,DEFAULT_TARGET.pl_orblper),st_teff:numberValue(t.st_teff,DEFAULT_TARGET.st_teff),st_rad:numberValue(t.st_rad,DEFAULT_TARGET.st_rad),st_mass:numberValue(t.st_mass,DEFAULT_TARGET.st_mass)};}
function solveKepler(M,e){e=clamp(e,0,.95); const m=wrapRadians(M); if(e<1e-8)return m; let E=e<.8?m:Math.PI; for(let i=0;i<30;i++){const f=E-e*Math.sin(E)-m, fp=1-e*Math.cos(E), dE=-f/Math.max(fp,1e-12); E+=dE; if(Math.abs(dE)<1e-12)break;} return E;}
function trueAnomalyToEccentricAnomaly(f,e){if(e<1e-8)return wrapRadians(f);const factor=Math.sqrt((1-e)/(1+e));return wrapRadians(2*Math.atan2(factor*Math.sin(f/2),Math.cos(f/2)));}
function eccentricAnomalyToTrueAnomaly(E,e){if(e<1e-8)return wrapRadians(E);const factor=Math.sqrt((1+e)/(1-e));return wrapRadians(2*Math.atan2(factor*Math.sin(E/2),Math.cos(E/2)));}
function eccentricAnomalyToMeanAnomaly(E,e){return wrapRadians(E-e*Math.sin(E));}
function interpolateLinear(xArray,yArray,x){const n=xArray.length;if(n<2||x<xArray[0]||x>xArray[n-1])return NaN;let lo=0,hi=n-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(xArray[mid]<=x)lo=mid;else hi=mid;}const x0=xArray[lo],x1=xArray[hi],y0=yArray[lo],y1=yArray[hi];if(x1===x0)return y0;const t=(x-x0)/(x1-x0);return y0+t*(y1-y0);}
function median(values){const clean=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!clean.length)return NaN;const mid=Math.floor(clean.length/2);return clean.length%2?clean[mid]:.5*(clean[mid-1]+clean[mid]);}
function minFinite(array,fallback){let v=Infinity;for(const x of array)if(Number.isFinite(x))v=Math.min(v,x);return Number.isFinite(v)?v:fallback;}
function maxFinite(array,fallback){let v=-Infinity;for(const x of array)if(Number.isFinite(x))v=Math.max(v,x);return Number.isFinite(v)?v:fallback;}
function numberValue(v,f){const n=Number(v);return Number.isFinite(n)?n:f;}
function stringValue(v,f=""){if(v===null||v===undefined)return f;const s=String(v).trim();return s||f;}
function clamp(v,min,max){const n=Number(v);if(!Number.isFinite(n))return min;return Math.min(max,Math.max(min,n));}
function clampInteger(v,min,max,fallback){const n=Math.round(Number(v));if(!Number.isFinite(n))return fallback;return Math.min(max,Math.max(min,n));}
function smoothstep(edge0,edge1,x){if(edge0===edge1)return x<edge0?0:1;const t=clamp((x-edge0)/(edge1-edge0),0,1);return t*t*(3-2*t);}
function degToRad(d){return d*Math.PI/180;}
function normaliseDegrees(deg){let v=Number(deg);if(!Number.isFinite(v))return 0;v%=360;if(v<0)v+=360;return v;}
function wrapRadians(angle){let v=Number(angle);if(!Number.isFinite(v))return 0;v%=TWO_PI;if(v<0)v+=TWO_PI;return v;}
