#!/usr/bin/env python3
"""
ExoIntel-Prime stellar field enrichment.

Adds sy_dist (distance, pc), sy_vmag (V magnitude), and st_spectype
(spectral type, when the archive has one on file) to every target already
in data/exoplanets.json, by name, from the NASA Exoplanet Archive TAP
service. Does not touch light curves or any other existing field.

When the archive has no st_spectype on file (common for fainter stars),
approx_spectral_class provides a clearly-labelled temperature-based
approximation instead of leaving the UI with nothing to show. It is never
written into st_spectype itself, so real archive values are never
overwritten by an approximation.

Run:
    python tools/enrich_stellar_fields.py
"""

from __future__ import annotations

import json
import math
import time
from pathlib import Path
from typing import Any

import requests

TAP_URL = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"
ROOT = Path(__file__).resolve().parents[1]
EXOPLANET_CACHE_PATH = ROOT / "data" / "exoplanets.json"
BATCH_SIZE = 40
REQUEST_TIMEOUT = 30

SPECTRAL_TABLE = [
    (30000, "O"), (10000, "B"), (7500, "A"), (6000, "F"),
    (5200, "G"), (3700, "K"), (2400, "M"), (0, "L"),
]


def approx_spectral_class(teff: float | None) -> str | None:
    if teff is None or not math.isfinite(teff):
        return None
    for lower, letter in SPECTRAL_TABLE:
        if teff >= lower:
            return f"~{letter} (Teff-based estimate)"
    return None


def as_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None


def escape_name(name: str) -> str:
    return name.replace("'", "''")


def fetch_batch(names: list[str]) -> dict[str, dict[str, Any]]:
    name_list = ", ".join(f"'{escape_name(n)}'" for n in names)
    query = f"select pl_name, sy_dist, sy_vmag, st_spectype from pscomppars where pl_name in ({name_list})"
    response = requests.get(TAP_URL, params={"query": query, "format": "json"}, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    rows = response.json()
    return {row["pl_name"]: row for row in rows if row.get("pl_name")}


def main() -> None:
    payload = json.loads(EXOPLANET_CACHE_PATH.read_text(encoding="utf-8"))
    targets = payload if isinstance(payload, list) else payload.get("targets", [])

    names = [t.get("pl_name") for t in targets if t.get("pl_name")]
    resolved: dict[str, dict[str, Any]] = {}
    for i in range(0, len(names), BATCH_SIZE):
        batch = names[i:i + BATCH_SIZE]
        print(f"Fetching stellar fields {i + 1}-{i + len(batch)} of {len(names)} ...")
        try:
            resolved.update(fetch_batch(batch))
        except requests.RequestException as error:
            print(f"  batch failed: {error}")
        time.sleep(0.3)

    updated = 0
    for target in targets:
        row = resolved.get(target.get("pl_name"))
        dist = as_float(row.get("sy_dist")) if row else None
        vmag = as_float(row.get("sy_vmag")) if row else None
        spectype = clean_text(row.get("st_spectype")) if row else None

        target["sy_dist"] = dist
        target["sy_vmag"] = vmag
        target["st_spectype"] = spectype
        target["st_spectype_approx"] = None if spectype else approx_spectral_class(target.get("st_teff"))
        if dist is not None or vmag is not None or spectype is not None:
            updated += 1

    output = targets if isinstance(payload, list) else payload
    EXOPLANET_CACHE_PATH.write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(f"\nDone. {updated}/{len(targets)} targets got at least one enriched field.")
    print(f"Wrote {EXOPLANET_CACHE_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
