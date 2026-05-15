import type { ExoTarget, LightCurveSeries } from "../types";
import { phaseFold } from "../physics/phaseFold";

export function normalizeLightCurve(raw: { time: number[]; flux: number[]; fluxErr?: number[]; quality?: number[]; label?: string }, target: ExoTarget): LightCurveSeries {
  const timeBjd = new Float64Array(raw.time);
  const median = [...raw.flux].sort((a, b) => a - b)[Math.floor(raw.flux.length / 2)] || 1;
  const flux = new Float32Array(raw.flux.map(v => v / median));
  const fluxErr = new Float32Array((raw.fluxErr ?? raw.flux.map(() => 0.0005)).map(v => v / median));
  const quality = new Uint32Array(raw.quality ?? raw.flux.map(() => 0));
  const phase = phaseFold(timeBjd, target.period_days, 0);
  return { mission: "TESS", label: raw.label ?? target.pl_name, timeBjd, phase, flux, fluxErr, quality };
}
