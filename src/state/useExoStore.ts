import { create } from "zustand";
import type { ConsoleMessage, ExoTarget, FitParameters, LightCurveSeries, ModelPoint, ResidualSummary, SpectralFilter } from "../types";
import { defaultFitFromTarget } from "../physics/fitting";
import { synthesizeModelLightCurve } from "../physics/transitCPU";
import { summarizeResiduals } from "../physics/residuals";

interface ExoState {
  targets: ExoTarget[];
  selectedIndex: number;
  selectedTarget: ExoTarget | null;
  fit: FitParameters | null;
  observed: LightCurveSeries | null;
  model: ModelPoint[];
  residualSummary: ResidualSummary | null;
  phaseCursor: number;
  spectralFilter: SpectralFilter;
  console: ConsoleMessage[];
  setTargets: (targets: ExoTarget[]) => void;
  setSelectedIndex: (index: number) => void;
  setFitPatch: (patch: Partial<FitParameters>) => void;
  setObserved: (series: LightCurveSeries | null) => void;
  setPhaseCursor: (phase: number) => void;
  setSpectralFilter: (filter: SpectralFilter) => void;
  pushConsole: (level: ConsoleMessage["level"], text: string) => void;
  regenerateModel: () => void;
}

export const useExoStore = create<ExoState>((set, get) => ({
  targets: [],
  selectedIndex: 0,
  selectedTarget: null,
  fit: null,
  observed: null,
  model: [],
  residualSummary: null,
  phaseCursor: 0,
  spectralFilter: "VISUAL",
  console: [],

  setTargets: targets => set({ targets }),

  setSelectedIndex: index => {
    const target = get().targets[index] ?? null;
    const fit = target ? defaultFitFromTarget(target) : null;
    set({ selectedIndex: index, selectedTarget: target, fit, phaseCursor: 0, observed: null });
    get().regenerateModel();
  },

  setFitPatch: patch => {
    const current = get().fit;
    if (!current) return;
    set({ fit: { ...current, ...patch } });
    get().regenerateModel();
  },

  setObserved: observed => {
    set({ observed });
    const model = get().model;
    set({ residualSummary: observed ? summarizeResiduals(observed, model) : null });
  },

  setPhaseCursor: phase => set({ phaseCursor: phase }),
  setSpectralFilter: spectralFilter => set({ spectralFilter }),

  pushConsole: (level, text) => {
    const time = new Date().toLocaleTimeString();
    set({ console: [{ time, level, text }, ...get().console].slice(0, 200) });
  },

  regenerateModel: () => {
    const target = get().selectedTarget;
    const fit = get().fit;
    if (!target || !fit) return;
    const model = synthesizeModelLightCurve(fit, 1500, 3.8 * Math.max(0.6, target.duration_hours / 24));
    const observed = get().observed;
    set({ model, residualSummary: observed ? summarizeResiduals(observed, model) : null });
  }
}));
