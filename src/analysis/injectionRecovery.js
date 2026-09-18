function requirePositive(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new RangeError(`${label} must be positive.`);
  return number;
}

export function seededRandom(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function normalSample(random) {
  const u1 = Math.max(random(), Number.EPSILON);
  const u2 = random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleVariance(values) {
  if (values.length < 2) return NaN;
  const centre = mean(values);
  return values.reduce((sum, value) => sum + (value - centre) ** 2, 0) / (values.length - 1);
}

export function simulateTransitEvents(options, random) {
  const events = Math.trunc(requirePositive(options.events, "events"));
  const pointsPerEvent = Math.trunc(requirePositive(options.pointsPerEvent, "pointsPerEvent"));
  const depth = requirePositive(options.depthPpm, "depthPpm") / 1e6;
  const noiseSigma = requirePositive(options.noisePpm, "noisePpm") / 1e6;
  const duration = requirePositive(options.durationPhase, "durationPhase");
  const rho = Number(options.rho);
  if (!Number.isFinite(rho) || Math.abs(rho) >= 1) throw new RangeError("rho must be in (-1, 1).");
  if (events < 3 || pointsPerEvent < 20) throw new RangeError("study requires >=3 events and >=20 points per event.");

  const series = [];
  for (let event = 0; event < events; event += 1) {
    let noise = normalSample(random) * noiseSigma;
    for (let index = 0; index < pointsPerEvent; index += 1) {
      const phase = -0.08 + 0.16 * index / (pointsPerEvent - 1);
      if (index > 0) {
        noise = rho * noise + Math.sqrt(1 - rho ** 2) * normalSample(random) * noiseSigma;
      }
      const inTransit = Math.abs(phase) <= duration / 2;
      series.push({ event, phase, inTransit, flux: 1 - (inTransit ? depth : 0) + noise });
    }
  }
  return series;
}

export function estimateBoxDepth(series) {
  const inside = series.filter((point) => point.inTransit).map((point) => point.flux);
  const outside = series.filter((point) => !point.inTransit).map((point) => point.flux);
  if (inside.length < 2 || outside.length < 2) throw new RangeError("both transit regions require samples.");
  const depth = mean(outside) - mean(inside);
  const iidSe = Math.sqrt(sampleVariance(inside) / inside.length + sampleVariance(outside) / outside.length);
  const eventIds = [...new Set(series.map((point) => point.event))];
  const eventDepths = eventIds.map((event) => {
    const eventSeries = series.filter((point) => point.event === event);
    const eventInside = eventSeries.filter((point) => point.inTransit).map((point) => point.flux);
    const eventOutside = eventSeries.filter((point) => !point.inTransit).map((point) => point.flux);
    return mean(eventOutside) - mean(eventInside);
  });
  const clusterSe = Math.sqrt(sampleVariance(eventDepths) / eventDepths.length);
  return { depthPpm: depth * 1e6, iidSePpm: iidSe * 1e6, clusterSePpm: clusterSe * 1e6 };
}

export function runInjectionScenario(options) {
  const trials = Math.trunc(requirePositive(options.trials, "trials"));
  const random = seededRandom(options.seed);
  const truth = Number(options.depthPpm);
  const estimates = [];
  let iidCovered = 0;
  let clusterCovered = 0;
  let iidDetected = 0;
  let clusterDetected = 0;
  for (let trial = 0; trial < trials; trial += 1) {
    const estimate = estimateBoxDepth(simulateTransitEvents(options, random));
    estimates.push(estimate.depthPpm);
    if (Math.abs(estimate.depthPpm - truth) <= 1.96 * estimate.iidSePpm) iidCovered += 1;
    if (Math.abs(estimate.depthPpm - truth) <= 1.96 * estimate.clusterSePpm) clusterCovered += 1;
    if (estimate.depthPpm > 3 * estimate.iidSePpm) iidDetected += 1;
    if (estimate.depthPpm > 3 * estimate.clusterSePpm) clusterDetected += 1;
  }
  const bias = mean(estimates) - truth;
  const rmse = Math.sqrt(mean(estimates.map((value) => (value - truth) ** 2)));
  return {
    scenarioId: options.scenarioId,
    depthPpm: truth,
    noisePpm: Number(options.noisePpm),
    rho: Number(options.rho),
    events: Number(options.events),
    pointsPerEvent: Number(options.pointsPerEvent),
    trials,
    biasPpm: bias,
    rmsePpm: rmse,
    iidCoverage95: iidCovered / trials,
    clusterCoverage95: clusterCovered / trials,
    iidDetectionRate3Sigma: iidDetected / trials,
    clusterDetectionRate3Sigma: clusterDetected / trials
  };
}
