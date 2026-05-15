export type MissionName = "TESS" | "Kepler" | "K2" | "Model";
export type SpectralFilter = "VISUAL" | "IR" | "UV";

export interface ExoTarget {
  pl_name: string;
  hostname: string;
  ra: number | null;
  dec: number | null;
  period_days: number;
  transit_depth_ppm: number;
  duration_hours: number;
  rp_rs: number;
  a_rs: number;
  inclination_deg: number;
  eccentricity: number;
  omega_deg: number;
  stellar_teff_k: number;
  stellar_radius_rsun: number;
  stellar_mass_msun: number;
  stellar_lum_log: number | null;
  vmag: number | null;
  exo_intel_score?: number;
  bootstrap_note?: string;
}

export interface LightCurveSeries {
  mission: MissionName;
  label: string;
  timeBjd: Float64Array;
  phase: Float32Array;
  flux: Float32Array;
  fluxErr: Float32Array;
  quality: Uint32Array;
  cadenceSec?: number;
  sector?: number;
}

export interface FitParameters {
  period: number;
  t0: number;
  rpRs: number;
  aRs: number;
  inclinationDeg: number;
  eccentricity: number;
  omegaDeg: number;
  limb: [number, number, number, number];
  starspotEnabled: boolean;
  spotA: [number, number, number, number];
}

export interface ModelPoint {
  timeDays: number;
  phase: number;
  z: number;
  modelFlux: number;
}

export interface ResidualSummary {
  rmsPpm: number;
  madPpm: number;
  chi2Proxy: number;
  n: number;
}

export interface ConsoleMessage {
  time: string;
  level: "ok" | "warn" | "bad";
  text: string;
}
