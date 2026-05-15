import type { ExoTarget, LightCurveSeries } from "../types";
import { fetchArchiveTargets, normalizeArchiveRow } from "./nasaArchive";
import { fetchMastLightCurveProducts, queryMastObservations } from "./mastApi";

export interface OrchestratorResult {
  target: ExoTarget;
  lightCurves: LightCurveSeries[];
  sourceLog: string[];
}

export async function initializeGoldTargets(): Promise<ExoTarget[]> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}targets.json`, { cache: "no-store" });
    if (response.ok) {
      const rows = await response.json() as Record<string, unknown>[];
      if (rows.length) return rows.map(r => ({ ...normalizeArchiveRow(r), ...r } as ExoTarget));
    }
  } catch {
    // Try live archive below.
  }
  return fetchArchiveTargets();
}

export async function hydrateTarget(target: ExoTarget): Promise<OrchestratorResult> {
  const sourceLog: string[] = [`NASA target selected: ${target.pl_name}`];
  if (target.ra == null || target.dec == null) {
    sourceLog.push("Target has no RA/Dec in local cache; MAST search skipped.");
    return { target, lightCurves: [], sourceLog };
  }
  const observations = await queryMastObservations({ ra: target.ra, dec: target.dec, radiusDeg: 0.02, missions: ["TESS", "Kepler", "K2"] });
  sourceLog.push(`MAST observations found: ${observations.length}`);
  const products = await fetchMastLightCurveProducts(observations);
  sourceLog.push(`Photometry products found: ${products.length}`);
  return { target, lightCurves: [], sourceLog };
}
