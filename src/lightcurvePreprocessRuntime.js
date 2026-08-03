/* ============================================================================
   ExoIntel-Prime — Browser light-curve normalisation
   Author: Biswajit Jana

   Intercepts local light-curve JSON responses before the main app reads them.
   A low-order baseline is applied only when the out-of-transit samples show a
   material slope/curvature or baseline offset. Original repository files are
   never modified.
   ============================================================================ */

const nativeFetch = window.fetch.bind(window);
const LIGHTCURVE_PATTERN = /\/data\/lightcurves\/.+\.json(?:[?#].*)?$/i;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function centredPhase(value) {
  const phase = finite(value);
  if (phase === null) return null;
  if (phase >= 0 && phase <= 1) return ((phase + 0.5) % 1) - 0.5;
  return phase;
}

function solve3(matrix, vector) {
  const augmented = matrix.map((row, index) => [...row, vector[index]]);

  for (let column = 0; column < 3; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 3; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];

    const divisor = augmented[column][column];
    if (!Number.isFinite(divisor) || Math.abs(divisor) < 1e-12) return null;
    for (let item = column; item < 4; item += 1) augmented[column][item] /= divisor;

    for (let row = 0; row < 3; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let item = column; item < 4; item += 1) augmented[row][item] -= factor * augmented[column][item];
    }
  }

  return [augmented[0][3], augmented[1][3], augmented[2][3]];
}

function fitQuadratic(samples) {
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  let s4 = 0;
  let y0 = 0;
  let y1 = 0;
  let y2 = 0;

  for (const sample of samples) {
    const x = sample.phase;
    const y = sample.flux;
    const x2 = x * x;
    s0 += 1;
    s1 += x;
    s2 += x2;
    s3 += x2 * x;
    s4 += x2 * x2;
    y0 += y;
    y1 += y * x;
    y2 += y * x2;
  }

  return solve3(
    [[s0, s1, s2], [s1, s2, s3], [s2, s3, s4]],
    [y0, y1, y2]
  );
}

function evaluate(coefficients, phase) {
  return coefficients[0] + coefficients[1] * phase + coefficients[2] * phase * phase;
}

function extractSeries(payload) {
  if (Array.isArray(payload?.phase) && Array.isArray(payload?.flux)) {
    return {
      format: "arrays",
      phase: payload.phase.map(finite),
      flux: payload.flux.map(finite),
      error: Array.isArray(payload.error) ? payload.error.map(finite) : null
    };
  }

  if (Array.isArray(payload?.points)) {
    return {
      format: "points",
      phase: payload.points.map(point => finite(point?.phase ?? point?.time)),
      flux: payload.points.map(point => finite(point?.flux)),
      error: payload.points.map(point => finite(point?.error ?? point?.flux_err))
    };
  }

  return null;
}

function shouldApply(coefficients, phases) {
  const baselines = phases.map(phase => evaluate(coefficients, phase)).filter(Number.isFinite);
  if (!baselines.length) return false;
  const min = Math.min(...baselines);
  const max = Math.max(...baselines);
  const centre = median(baselines) ?? 1;
  const variation = max - min;
  const offset = Math.abs(centre - 1);
  return variation > 0.0006 || offset > 0.0008;
}

function preprocess(payload) {
  const series = extractSeries(payload);
  if (!series || series.phase.length < 40 || series.phase.length !== series.flux.length) return payload;

  const samples = [];
  for (let index = 0; index < series.phase.length; index += 1) {
    const phase = centredPhase(series.phase[index]);
    const flux = series.flux[index];
    if (phase === null || flux === null || flux <= 0) continue;
    samples.push({ index, phase, flux });
  }
  if (samples.length < 40) return payload;

  const maxAbs = Math.max(...samples.map(sample => Math.abs(sample.phase)));
  if (!Number.isFinite(maxAbs) || maxAbs <= 0) return payload;

  const outerThreshold = maxAbs * 0.62;
  let outer = samples.filter(sample => Math.abs(sample.phase) >= outerThreshold);
  if (outer.length < Math.max(20, samples.length * 0.16)) {
    const ordered = [...samples].sort((a, b) => Math.abs(b.phase) - Math.abs(a.phase));
    outer = ordered.slice(0, Math.max(20, Math.floor(samples.length * 0.22)));
  }

  const coefficients = fitQuadratic(outer);
  if (!coefficients || !shouldApply(coefficients, samples.map(sample => sample.phase))) return payload;

  const correctedFlux = [...series.flux];
  const correctedError = series.error ? [...series.error] : null;

  for (const sample of samples) {
    const baseline = evaluate(coefficients, sample.phase);
    if (!Number.isFinite(baseline) || baseline <= 0.2) continue;
    correctedFlux[sample.index] = sample.flux / baseline;
    if (correctedError && Number.isFinite(correctedError[sample.index])) {
      correctedError[sample.index] = correctedError[sample.index] / baseline;
    }
  }

  const metadata = {
    applied: true,
    method: "quadratic out-of-transit baseline",
    coefficients,
    outer_samples: outer.length,
    note: "Quick-look browser normalisation; repository source data remain unchanged."
  };

  if (series.format === "arrays") {
    return {
      ...payload,
      flux: correctedFlux,
      ...(correctedError ? { error: correctedError } : {}),
      browser_preprocessing: metadata
    };
  }

  return {
    ...payload,
    points: payload.points.map((point, index) => ({
      ...point,
      flux: correctedFlux[index],
      ...(correctedError && Number.isFinite(correctedError[index]) ? { error: correctedError[index] } : {})
    })),
    browser_preprocessing: metadata
  };
}

window.fetch = async function exolightFetch(input, init) {
  const response = await nativeFetch(input, init);
  const url = typeof input === "string" ? input : input?.url || "";
  const absolute = new URL(url, window.location.href).href;

  if (!response.ok || !LIGHTCURVE_PATTERN.test(absolute)) return response;

  try {
    const payload = await response.clone().json();
    const processed = preprocess(payload);
    if (processed === payload) return response;

    const headers = new Headers(response.headers);
    headers.set("content-type", "application/json; charset=utf-8");
    headers.set("x-exolight-preprocessed", "quadratic-oot");
    return new Response(JSON.stringify(processed), {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  } catch (error) {
    console.warn("ExoIntel-Prime quick-look normalisation skipped:", error);
    return response;
  }
};
