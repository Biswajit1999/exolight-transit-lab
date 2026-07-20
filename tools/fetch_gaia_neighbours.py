#!/usr/bin/env python3
"""
ExoIntel-Prime Gaia DR3 neighbour cache builder.

Queries the Gaia DR3 archive (ESA, gea.esac.esa.int TAP service) for a cone
search around each target host star and caches the result as a single static
JSON file:

    data/gaia-neighbours.json

The frontend never fabricates neighbour or contamination data. If a target
has no cached entry in this file, the Observatory Deck shows an explicit
"neighbour data not yet available" state rather than inventing a sky map.

The contamination-risk band computed here is a transparent heuristic (flux
ratio versus separation), not a formal blend/false-positive probability. It
is intended as a quick-look flag, matching the rest of ExoLight's diagnostics.

Requirements:
    pip install requests

Run:
    python tools/fetch_gaia_neighbours.py
    python tools/fetch_gaia_neighbours.py --limit 20
    python tools/fetch_gaia_neighbours.py --radius-arcsec 60
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

GAIA_TAP_URL = "https://gea.esac.esa.int/tap-server/tap/sync"
GAIA_RELEASE = "Gaia DR3"

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
EXOPLANET_CACHE_PATH = DATA_DIR / "exoplanets.json"
NEIGHBOURS_CACHE_PATH = DATA_DIR / "gaia-neighbours.json"

DEFAULT_RADIUS_ARCSEC = 100.0
TARGET_STAR_MATCH_ARCSEC = 2.0
APERTURE_SCALE_ARCSEC = 21.0  # roughly one TESS pixel; used only to weight the risk heuristic
REQUEST_TIMEOUT = 30
REQUEST_DELAY_SECONDS = 0.35


def slugify(value: Any) -> str:
    text = str(value or "unknown-target").strip().lower()
    text = text.replace("+", " plus ")
    text = re.sub(r"[’'\"]", "", text)
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"^-+|-+$", "", text)
    return text or "unknown-target"


def load_targets() -> list[dict[str, Any]]:
    payload = json.loads(EXOPLANET_CACHE_PATH.read_text(encoding="utf-8"))
    return payload if isinstance(payload, list) else payload.get("targets", [])


def load_existing_cache() -> dict[str, Any]:
    if not NEIGHBOURS_CACHE_PATH.exists():
        return {}
    try:
        return json.loads(NEIGHBOURS_CACHE_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def build_query(ra: float, dec: float, radius_deg: float) -> str:
    return f"""
SELECT source_id, ra, dec, phot_g_mean_mag, parallax,
DISTANCE(POINT('ICRS', ra, dec), POINT('ICRS', {ra}, {dec})) AS sep_deg
FROM gaiadr3.gaia_source
WHERE 1=CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', {ra}, {dec}, {radius_deg}))
ORDER BY sep_deg ASC
""".strip()


def query_gaia_neighbours(ra: float, dec: float, radius_arcsec: float) -> list[dict[str, Any]] | None:
    radius_deg = radius_arcsec / 3600.0
    query = build_query(ra, dec, radius_deg)
    try:
        response = requests.get(
            GAIA_TAP_URL,
            params={"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "json", "QUERY": query},
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        payload = response.json()
    except (requests.RequestException, ValueError) as error:
        print(f"    Gaia query failed: {error}", file=sys.stderr)
        return None

    columns = [column["name"] for column in payload.get("metadata", [])]
    rows = payload.get("data", [])
    return [dict(zip(columns, row)) for row in rows]


def contamination_risk(separation_arcsec: float, delta_mag: float | None) -> str:
    if delta_mag is None:
        return "unknown"
    flux_ratio = 10 ** (-0.4 * delta_mag)
    weight = 1.0 / (1.0 + (separation_arcsec / APERTURE_SCALE_ARCSEC) ** 2)
    proxy = flux_ratio * weight
    if proxy > 0.05:
        return "high"
    if proxy > 0.005:
        return "medium"
    return "low"


def process_target(target: dict[str, Any], radius_arcsec: float) -> dict[str, Any] | None:
    ra = target.get("ra")
    dec = target.get("dec")
    if ra is None or dec is None:
        return None

    rows = query_gaia_neighbours(float(ra), float(dec), radius_arcsec)
    if rows is None:
        return None

    target_row = None
    for row in rows:
        sep_arcsec = float(row.get("sep_deg") or 0.0) * 3600.0
        if sep_arcsec <= TARGET_STAR_MATCH_ARCSEC:
            target_row = row
            break
    target_mag = target_row.get("phot_g_mean_mag") if target_row else None
    target_source_id = target_row.get("source_id") if target_row else None

    neighbours = []
    for row in rows:
        if target_row is not None and row.get("source_id") == target_row.get("source_id"):
            continue
        sep_arcsec = float(row.get("sep_deg") or 0.0) * 3600.0
        neighbour_mag = row.get("phot_g_mean_mag")
        delta_mag = (neighbour_mag - target_mag) if (neighbour_mag is not None and target_mag is not None) else None
        neighbours.append({
            "sourceId": str(row.get("source_id")) if row.get("source_id") is not None else None,
            "separationArcsec": round(sep_arcsec, 3),
            "gMag": round(neighbour_mag, 3) if neighbour_mag is not None else None,
            "deltaMag": round(delta_mag, 3) if delta_mag is not None else None,
            "parallaxMas": round(row["parallax"], 4) if row.get("parallax") is not None else None,
            "contaminationRisk": contamination_risk(sep_arcsec, delta_mag),
        })
    neighbours.sort(key=lambda item: item["separationArcsec"])

    return {
        "targetSourceId": str(target_source_id) if target_source_id is not None else None,
        "targetGMag": round(target_mag, 3) if target_mag is not None else None,
        "searchRadiusArcsec": radius_arcsec,
        "release": GAIA_RELEASE,
        "retrievedUtc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "neighbourCount": len(neighbours),
        "neighbours": neighbours[:25],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=None, help="Only process the first N eligible targets.")
    parser.add_argument("--radius-arcsec", type=float, default=DEFAULT_RADIUS_ARCSEC, help="Cone search radius in arcseconds.")
    parser.add_argument("--observed-only", action="store_true", default=True, help="Only fetch neighbours for targets with a local light curve (default).")
    parser.add_argument("--all-targets", dest="observed_only", action="store_false", help="Fetch neighbours for every catalogue target, not just observed ones.")
    parser.add_argument("--force", action="store_true", help="Re-fetch targets that already have a cached entry.")
    args = parser.parse_args()

    targets = load_targets()
    if args.observed_only:
        targets = [t for t in targets if t.get("lightcurve_available")]

    cache = load_existing_cache()
    processed = 0
    failed = 0

    for target in targets:
        if args.limit is not None and processed >= args.limit:
            break
        slug = slugify(target.get("pl_name"))
        if slug in cache and not args.force:
            continue

        print(f"[{processed + 1}] {target.get('pl_name')} ({target.get('hostname')}) ...")
        entry = process_target(target, args.radius_arcsec)
        if entry is None:
            print("    skipped (no coordinates or query failed)")
            failed += 1
            continue

        entry["pl_name"] = target.get("pl_name")
        entry["hostname"] = target.get("hostname")
        cache[slug] = entry
        processed += 1
        NEIGHBOURS_CACHE_PATH.write_text(json.dumps(cache, indent=2, sort_keys=True), encoding="utf-8")
        time.sleep(REQUEST_DELAY_SECONDS)

    print(f"\nDone. {processed} targets fetched this run, {failed} failed, {len(cache)} total cached.")
    print(f"Wrote {NEIGHBOURS_CACHE_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
