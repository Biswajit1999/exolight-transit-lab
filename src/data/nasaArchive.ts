import type { ExoTarget } from "../types";

const TAP_SYNC = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync";

export const GOLD_TARGET_QUERY = `
SELECT TOP 150
    pl_name, hostname, ra, dec, pl_orbper, pl_trandep, pl_trandur,
    pl_ratror, pl_ratdor, pl_orbincl, pl_orbeccen, pl_orblper,
    st_teff, st_rad, st_mass, st_lum, sy_vmag
FROM pscomppars
WHERE
    tran_flag = 1
    AND pl_ratror IS NOT NULL
    AND pl_ratdor IS NOT NULL
    AND sy_vmag < 12
ORDER BY pl_trandep DESC
`.trim();

function n(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeArchiveRow(row: Record<string, unknown>): ExoTarget {
  return {
    pl_name: String(row.pl_name ?? "unknown"),
    hostname: String(row.hostname ?? "unknown"),
    ra: row.ra == null ? null : n(row.ra),
    dec: row.dec == null ? null : n(row.dec),
    period_days: n(row.pl_orbper, 1),
    transit_depth_ppm: n(row.pl_trandep, 0),
    duration_hours: n(row.pl_trandur, 2),
    rp_rs: n(row.pl_ratror, 0.1),
    a_rs: n(row.pl_ratdor, 10),
    inclination_deg: n(row.pl_orbincl, 89),
    eccentricity: n(row.pl_orbeccen, 0),
    omega_deg: n(row.pl_orblper, 90),
    stellar_teff_k: n(row.st_teff, 5772),
    stellar_radius_rsun: n(row.st_rad, 1),
    stellar_mass_msun: n(row.st_mass, 1),
    stellar_lum_log: row.st_lum == null ? null : n(row.st_lum),
    vmag: row.sy_vmag == null ? null : n(row.sy_vmag),
    exo_intel_score: 0
  };
}

export async function fetchArchiveTargets(): Promise<ExoTarget[]> {
  const params = new URLSearchParams({ query: GOLD_TARGET_QUERY, format: "json" });
  const response = await fetch(`${TAP_SYNC}?${params.toString()}`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`NASA Exoplanet Archive TAP failed: HTTP ${response.status}`);
  const rows = await response.json() as Record<string, unknown>[];
  return rows.map(normalizeArchiveRow);
}
