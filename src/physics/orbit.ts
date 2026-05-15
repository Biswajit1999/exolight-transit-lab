export interface OrbitState {
  xRs: number;
  yRs: number;
  zRs: number;
  trueAnomalyRad: number;
  separationRs: number;
}

export function solveKepler(meanAnomaly: number, eccentricity: number): number {
  let E = meanAnomaly;
  for (let i = 0; i < 12; i++) {
    const f = E - eccentricity * Math.sin(E) - meanAnomaly;
    const fp = 1 - eccentricity * Math.cos(E);
    E -= f / Math.max(fp, 1e-9);
  }
  return E;
}

export function projectedOrbitRs(params: {
  timeDays: number;
  t0Days: number;
  periodDays: number;
  aRs: number;
  inclinationRad: number;
  eccentricity: number;
  omegaRad: number;
}): OrbitState {
  const M = 2 * Math.PI * ((params.timeDays - params.t0Days) / params.periodDays);
  const wrappedM = ((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const E = solveKepler(wrappedM, params.eccentricity);
  const denom = 1 - params.eccentricity * Math.cos(E);
  const cosf = (Math.cos(E) - params.eccentricity) / denom;
  const sinf = (Math.sqrt(Math.max(0, 1 - params.eccentricity ** 2)) * Math.sin(E)) / denom;
  const f = Math.atan2(sinf, cosf);
  const r = params.aRs * (1 - params.eccentricity * Math.cos(E));
  const arg = f + params.omegaRad;
  const xRs = -r * Math.cos(arg);
  const yRs = -r * Math.sin(arg) * Math.cos(params.inclinationRad);
  const zRs = r * Math.sin(arg) * Math.sin(params.inclinationRad);
  return { xRs, yRs, zRs, trueAnomalyRad: f, separationRs: Math.hypot(xRs, yRs) };
}
