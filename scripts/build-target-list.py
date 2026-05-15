import json
import math
from pathlib import Path
from typing import Any
import requests

NASA_TAP = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"
OUT = Path("public/targets.json")
QUERY = Path("queries/gold_targets.sql").read_text(encoding="utf-8").strip()

def safe_float(row: dict[str, Any], key: str, default: float | None = None) -> float | None:
    value = row.get(key)
    if value in (None, "", "null"):
        return default
    try:
        value = float(value)
        if math.isfinite(value):
            return value
    except Exception:
        pass
    return default

def score_target(row: dict[str, Any]) -> float:
    depth = safe_float(row, "pl_trandep", 0.0) or 0.0
    vmag = safe_float(row, "sy_vmag", 15.0) or 15.0
    duration = safe_float(row, "pl_trandur", 0.0) or 0.0
    rp_rs = safe_float(row, "pl_ratror", 0.0) or 0.0
    brightness_score = max(0.0, 12.0 - vmag) / 12.0
    depth_score = math.log10(max(10.0, depth)) / 5.0
    duration_score = min(duration / 5.0, 1.0)
    radius_score = min(rp_rs / 0.15, 1.0)
    return round(100.0 * (0.40 * depth_score + 0.30 * brightness_score + 0.20 * duration_score + 0.10 * radius_score), 3)

def main() -> None:
    print("Querying NASA Exoplanet Archive TAP...")
    response = requests.get(NASA_TAP, params={"query": QUERY, "format": "json"}, timeout=120)
    response.raise_for_status()
    rows = response.json()
    targets = []
    for row in rows:
        cleaned = {
            "pl_name": row.get("pl_name"),
            "hostname": row.get("hostname"),
            "ra": safe_float(row, "ra"),
            "dec": safe_float(row, "dec"),
            "period_days": safe_float(row, "pl_orbper"),
            "transit_depth_ppm": safe_float(row, "pl_trandep"),
            "duration_hours": safe_float(row, "pl_trandur"),
            "rp_rs": safe_float(row, "pl_ratror"),
            "a_rs": safe_float(row, "pl_ratdor"),
            "inclination_deg": safe_float(row, "pl_orbincl"),
            "eccentricity": safe_float(row, "pl_orbeccen", 0.0),
            "omega_deg": safe_float(row, "pl_orblper", 90.0),
            "stellar_teff_k": safe_float(row, "st_teff"),
            "stellar_radius_rsun": safe_float(row, "st_rad"),
            "stellar_mass_msun": safe_float(row, "st_mass"),
            "stellar_lum_log": safe_float(row, "st_lum"),
            "vmag": safe_float(row, "sy_vmag"),
        }
        if None in [cleaned["ra"], cleaned["dec"], cleaned["period_days"], cleaned["rp_rs"], cleaned["a_rs"]]:
            continue
        cleaned["exo_intel_score"] = score_target(row)
        targets.append(cleaned)
    targets.sort(key=lambda t: t["exo_intel_score"], reverse=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(targets, indent=2), encoding="utf-8")
    print(f"Wrote {len(targets)} targets to {OUT}")

if __name__ == "__main__":
    main()
