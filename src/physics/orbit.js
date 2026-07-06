import { AU, DAY_SECONDS, G, HOUR_SECONDS, M_SUN, R_SUN } from "./constants.js";

function requirePositiveFinite(value, label) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new RangeError(`${label} must be a positive finite number.`);
  }
  return numeric;
}

export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function solveKepler(M, e) {
  let E = M;
  for (let i = 0; i < 12; i++) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    E -= f / Math.max(fp, 1e-9);
  }
  return E;
}

export function projectedOrbit({ phase, aRs, incDeg, ecc, omegaDeg }) {
  const M = ((2 * Math.PI * (phase - 0.5)) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  const E = solveKepler(M, ecc);
  const cosf = (Math.cos(E) - ecc) / (1 - ecc * Math.cos(E));
  const sinf = (Math.sqrt(Math.max(0, 1 - ecc * ecc)) * Math.sin(E)) / (1 - ecc * Math.cos(E));
  const f = Math.atan2(sinf, cosf);
  const r = aRs * (1 - ecc * Math.cos(E));
  const arg = f + omegaDeg * Math.PI / 180;
  const inc = incDeg * Math.PI / 180;
  return {
    x: -r * Math.cos(arg),
    y: -r * Math.sin(arg) * Math.cos(inc),
    z: r * Math.sin(arg) * Math.sin(inc),
    r,
    trueAnomaly: f
  };
}

export function semiMajorAxisFromPeriod(periodDays, stellarMassSolar = 1) {
  const periodSeconds = requirePositiveFinite(periodDays, "periodDays") * DAY_SECONDS;
  const stellarMassKg = requirePositiveFinite(stellarMassSolar, "stellarMassSolar") * M_SUN;
  const aMetres = Math.cbrt((G * stellarMassKg * periodSeconds ** 2) / (4 * Math.PI ** 2));
  return aMetres / AU;
}

export function scaledSemiMajorAxis(semiMajorAxisAU, stellarRadiusSolar = 1) {
  const aMetres = requirePositiveFinite(semiMajorAxisAU, "semiMajorAxisAU") * AU;
  const rStarMetres = requirePositiveFinite(stellarRadiusSolar, "stellarRadiusSolar") * R_SUN;
  return aMetres / rStarMetres;
}

export function orbitalVelocityKmPerSecond(periodDays, semiMajorAxisAU) {
  const periodSeconds = requirePositiveFinite(periodDays, "periodDays") * DAY_SECONDS;
  const circumferenceKm = 2 * Math.PI * requirePositiveFinite(semiMajorAxisAU, "semiMajorAxisAU") * AU / 1000;
  return circumferenceKm / periodSeconds;
}

export function periodHours(periodDays) {
  return requirePositiveFinite(periodDays, "periodDays") * DAY_SECONDS / HOUR_SECONDS;
}
