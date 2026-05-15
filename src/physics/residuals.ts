import type { LightCurveSeries, ModelPoint, ResidualSummary } from "../types";

function interpolateModel(model: ModelPoint[], phase: number): number {
  if (model.length === 0) return 1;
  const min = model[0].phase;
  const max = model[model.length - 1].phase;
  const t = (phase - min) / Math.max(1e-9, max - min);
  const idx = Math.max(0, Math.min(model.length - 2, Math.floor(t * (model.length - 1))));
  const a = model[idx];
  const b = model[idx + 1];
  const u = (phase - a.phase) / Math.max(1e-9, b.phase - a.phase);
  return a.modelFlux + (b.modelFlux - a.modelFlux) * Math.max(0, Math.min(1, u));
}

export function summarizeResiduals(series: LightCurveSeries, model: ModelPoint[]): ResidualSummary {
  const res: number[] = [];
  for (let i = 0; i < series.flux.length; i++) {
    const mf = interpolateModel(model, series.phase[i]);
    res.push((series.flux[i] - mf) * 1_000_000);
  }
  const n = Math.max(1, res.length);
  const rmsPpm = Math.sqrt(res.reduce((a, b) => a + b * b, 0) / n);
  const med = [...res].sort((a, b) => a - b)[Math.floor(n / 2)] ?? 0;
  const madPpm = [...res].map(v => Math.abs(v - med)).sort((a, b) => a - b)[Math.floor(n / 2)] ?? 0;
  const chi2Proxy = (rmsPpm / Math.max(1, madPpm * 1.4826)) ** 2;
  return { rmsPpm, madPpm, chi2Proxy, n };
}
