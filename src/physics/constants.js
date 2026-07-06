/* ============================================================================
   ExoLight Transit Lab Phase III - Physical constants
   Units are SI unless the exported name states otherwise.
   ============================================================================ */

export const G = 6.67430e-11; // m^3 kg^-1 s^-2
export const M_SUN = 1.98847e30; // kg
export const R_SUN = 6.957e8; // m
export const R_EARTH = 6.371e6; // m
export const R_JUPITER = 6.9911e7; // m
export const AU = 1.495978707e11; // m
export const DAY_SECONDS = 86400;
export const HOUR_SECONDS = 3600;

export const UNIT_LABELS = Object.freeze({
  semiMajorAxis: "AU",
  transitDepth: "ppm",
  transitDuration: "hours",
  radiusRatio: "Rp/Rstar"
});
