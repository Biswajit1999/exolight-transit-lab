import type { FitParameters, ModelPoint } from "../types";
import { projectedOrbitRs } from "./orbit";
import { radialIntensity } from "./limbDarkening";

const RADIAL = 74;
const ANGULAR = 148;
const DISK = buildDisk();

interface DiskPoint { x: number; y: number; r: number; area: number; }

function buildDisk(): DiskPoint[] {
  const pts: DiskPoint[] = [];
  for (let ir = 0; ir < RADIAL; ir++) {
    const r0 = ir / RADIAL;
    const r1 = (ir + 1) / RADIAL;
    const r = Math.sqrt((r0 * r0 + r1 * r1) * 0.5);
    const area = Math.PI * (r1 * r1 - r0 * r0) / ANGULAR;
    for (let ia = 0; ia < ANGULAR; ia++) {
      const th = (ia + 0.5) / ANGULAR * Math.PI * 2;
      pts.push({ x: r * Math.cos(th), y: r * Math.sin(th), r, area });
    }
  }
  return pts;
}

function spotMultiplier(x: number, y: number, fit: FitParameters): number {
  if (!fit.starspotEnabled) return 1;
  const [sx, sy, sr, contrast] = fit.spotA;
  const d = Math.hypot(x - sx, y - sy);
  if (d > sr) return 1;
  const edge = Math.min(1, Math.max(0, d / Math.max(sr, 1e-6)));
  return 1 - contrast * (1 - edge * edge);
}

export function integrateTransitFlux(fit: FitParameters, timeDays: number): { flux: number; z: number } {
  const orbit = projectedOrbitRs({
    timeDays,
    t0Days: fit.t0,
    periodDays: fit.period,
    aRs: fit.aRs,
    inclinationRad: fit.inclinationDeg * Math.PI / 180,
    eccentricity: Math.max(0, Math.min(0.95, fit.eccentricity)),
    omegaRad: fit.omegaDeg * Math.PI / 180
  });

  let total = 0;
  let visible = 0;
  for (const p of DISK) {
    const intensity = radialIntensity(p.r, fit.limb) * spotMultiplier(p.x, p.y, fit) * p.area;
    total += intensity;
    const blocked = Math.hypot(p.x - orbit.xRs, p.y - orbit.yRs) <= fit.rpRs;
    if (!blocked) visible += intensity;
  }
  return { flux: visible / Math.max(total, 1e-12), z: orbit.separationRs };
}

export function synthesizeModelLightCurve(fit: FitParameters, n = 1500, windowDays = 0.30): ModelPoint[] {
  const out: ModelPoint[] = [];
  const start = -windowDays / 2;
  for (let i = 0; i < n; i++) {
    const timeDays = start + (i / Math.max(1, n - 1)) * windowDays;
    const m = integrateTransitFlux(fit, timeDays);
    out.push({ timeDays, phase: timeDays / fit.period, z: m.z, modelFlux: m.flux });
  }
  return out;
}
