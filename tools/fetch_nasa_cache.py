#!/usr/bin/env python3
"""
Fetch 150 high-quality confirmed transiting exoplanets from the NASA Exoplanet Archive
and write them to data/exoplanets.json for ExoIntel-Prime.

Usage:
    pip install requests
    python tools/fetch_nasa_cache.py
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests


TAP_URL = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"

ADQL_QUERY = """
SELECT TOP 150
  pl_name,
  hostname,
  sy_snum,
  sy_pnum,
  pl_orbper,
  pl_orbsmax,
  pl_ratror,
  pl_rade,
  pl_bmasse,
  pl_orbincl,
  pl_orbeccen,
  pl_trandep,
  pl_trandur,
  st_teff,
  st_rad,
  st_mass,
  st_logg,
  st_met,
  disc_year,
  discoverymethod
FROM pscomppars
WHERE tran_flag = 1
  AND pl_name IS NOT NULL
  AND hostname IS NOT NULL
  AND pl_orbper IS NOT NULL
  AND pl_orbsmax IS NOT NULL
  AND pl_ratror IS NOT NULL
  AND pl_orbincl IS NOT NULL
  AND pl_orbeccen IS NOT NULL
  AND st_rad IS NOT NULL
  AND st_teff IS NOT NULL
ORDER BY pl_trandep DESC
"""

ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = ROOT / "data" / "exoplanets.json"


def as_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number and number not in (float("inf"), float("-inf")) else None


def as_int(value: Any) -> int | None:
    number = as_float(value)
    return int(number) if number is not None else None


def clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None


def normalise_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "pl_name": clean_text(row.get("pl_name")),
        "hostname": clean_text(row.get("hostname")),
        "sy_snum": as_int(row.get("sy_snum")),
        "sy_pnum": as_int(row.get("sy_pnum")),
        "pl_orbper": as_float(row.get("pl_orbper")),
        "pl_orbsmax": as_float(row.get("pl_orbsmax")),
        "pl_ratror": as_float(row.get("pl_ratror")),
        "pl_rade": as_float(row.get("pl_rade")),
        "pl_bmasse": as_float(row.get("pl_bmasse")),
        "pl_orbincl": as_float(row.get("pl_orbincl")),
        "pl_orbeccen": as_float(row.get("pl_orbeccen")),
        "pl_trandep": as_float(row.get("pl_trandep")),
        "pl_trandur": as_float(row.get("pl_trandur")),
        "st_teff": as_float(row.get("st_teff")),
        "st_rad": as_float(row.get("st_rad")),
        "st_mass": as_float(row.get("st_mass")),
        "st_logg": as_float(row.get("st_logg")),
        "st_met": as_float(row.get("st_met")),
        "disc_year": as_int(row.get("disc_year")),
        "discoverymethod": clean_text(row.get("discoverymethod")),
    }


def required_fields_complete(row: dict[str, Any]) -> bool:
    required = [
        "pl_name",
        "hostname",
        "pl_orbper",
        "pl_orbsmax",
        "pl_ratror",
        "pl_orbincl",
        "pl_orbeccen",
        "st_rad",
        "st_teff",
    ]
    return all(row.get(key) is not None for key in required)


def fetch_rows() -> list[dict[str, Any]]:
    payload = {
        "request": "doQuery",
        "lang": "ADQL",
        "format": "json",
        "query": ADQL_QUERY,
    }

    response = requests.post(TAP_URL, data=payload, timeout=45)
    response.raise_for_status()

    data = response.json()
    if not isinstance(data, list):
        raise ValueError("NASA TAP response was not a JSON row list")

    rows = []
    seen = set()

    for item in data:
        if not isinstance(item, dict):
            continue

        row = normalise_row(item)
        if not required_fields_complete(row):
            continue

        key = (row["pl_name"], row["hostname"])
        if key in seen:
            continue

        seen.add(key)
        rows.append(row)

    rows.sort(
        key=lambda r: (
            r["pl_trandep"] if r["pl_trandep"] is not None else -1,
            r["pl_ratror"] if r["pl_ratror"] is not None else -1,
        ),
        reverse=True,
    )

    return rows[:150]


def build_cache(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "schema": "exointel-prime-gold-target-cache-v1",
        "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "NASA Exoplanet Archive TAP pscomppars",
        "tap_url": TAP_URL,
        "adql": ADQL_QUERY.strip(),
        "target_count": len(rows),
        "columns": [
            "pl_name",
            "hostname",
            "sy_snum",
            "sy_pnum",
            "pl_orbper",
            "pl_orbsmax",
            "pl_ratror",
            "pl_rade",
            "pl_bmasse",
            "pl_orbincl",
            "pl_orbeccen",
            "pl_trandep",
            "pl_trandur",
            "st_teff",
            "st_rad",
            "st_mass",
            "st_logg",
            "st_met",
            "disc_year",
            "discoverymethod",
        ],
        "targets": rows,
    }


def main() -> int:
    try:
        rows = fetch_rows()
        if len(rows) != 150:
            print(f"Warning: expected 150 targets but received {len(rows)} after cleaning.", file=sys.stderr)

        OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        cache = build_cache(rows)
        OUT_PATH.write_text(json.dumps(cache, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

        print(f"Saved {len(rows)} targets to {OUT_PATH}")
        return 0

    except requests.RequestException as exc:
        print(f"NASA TAP request failed: {exc}", file=sys.stderr)
        return 1
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        print(f"Cache generation failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
