import type { ExoTarget, FitParameters } from "../types";

export function defaultFitFromTarget(target: ExoTarget): FitParameters {
  return {
    period: target.period_days,
    t0: 0,
    rpRs: target.rp_rs,
    aRs: target.a_rs,
    inclinationDeg: target.inclination_deg,
    eccentricity: target.eccentricity ?? 0,
    omegaDeg: target.omega_deg ?? 90,
    limb: [0.45, 0.18, 0.12, 0.04],
    starspotEnabled: false,
    spotA: [0.3, 0.18, 0.12, 0.45]
  };
}

export function applySpectralPreset(filter: "VISUAL" | "IR" | "UV"): [number, number, number, number] {
  if (filter === "IR") return [0.22, 0.10, 0.05, 0.02];
  if (filter === "UV") return [0.70, 0.30, 0.18, 0.08];
  return [0.45, 0.18, 0.12, 0.04];
}
