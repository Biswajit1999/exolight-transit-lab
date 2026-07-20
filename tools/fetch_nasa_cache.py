#!/usr/bin/env python3
"""
ExoIntel-Prime cache builder.

This script performs two offline data-ingestion tasks:

1. Queries the NASA Exoplanet Archive TAP service for the deepest-transit
   confirmed exoplanets (TARGET_COUNT, currently 1200) with complete core
   orbital and stellar parameters, plus any previously-catalogued targets
   that would otherwise fall out of that ranking as TARGET_COUNT grows.

2. Tries to find real MAST-hosted TESS/Kepler/K2 light-curve FITS products for
   each target, phase-folds the real photometric data, normalizes the flux, and
   saves lightweight static JSON files to:

       data/lightcurves/[planet-name].json

The frontend never fabricates scatter points. If no compatible archive light
curve is found for a target, no fake light-curve JSON is produced for that
target.

Requirements:
    pip install requests

Run:
    python tools/fetch_nasa_cache.py

Optional:
    python tools/fetch_nasa_cache.py --max-lightcurves 25
    python tools/fetch_nasa_cache.py --skip-lightcurves
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import re
import statistics
import struct
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

import requests


TAP_URL = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"
MAST_INVOKE_URL = "https://mast.stsci.edu/api/v0/invoke"
MAST_DOWNLOAD_URL = "https://mast.stsci.edu/api/v0.1/Download/file"

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
LIGHTCURVE_DIR = DATA_DIR / "lightcurves"
EXOPLANET_CACHE_PATH = DATA_DIR / "exoplanets.json"

TARGET_COUNT = 1200
DEFAULT_TIMEOUT = 45
DEFAULT_PHASE_WINDOW = 0.16
DEFAULT_MAX_POINTS = 1800

ADQL_QUERY = f"""
SELECT TOP {TARGET_COUNT}
  pl_name,
  hostname,
  sy_snum,
  sy_pnum,
  ra,
  dec,
  pl_orbper,
  pl_orbsmax,
  pl_ratror,
  pl_rade,
  pl_bmasse,
  pl_orbincl,
  pl_orbeccen,
  pl_trandep,
  pl_trandur,
  pl_tranmid,
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
  AND st_rad IS NOT NULL
  AND st_teff IS NOT NULL
  AND pl_trandep IS NOT NULL
ORDER BY pl_trandep DESC
"""


def as_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def as_int(value: Any) -> int | None:
    number = as_float(value)
    return int(number) if number is not None else None


def clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None


def slugify(value: Any) -> str:
    text = str(value or "unknown-target").strip().lower()
    text = text.replace("+", " plus ")
    text = re.sub(r"[’'\"]", "", text)
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"^-+|-+$", "", text)
    return text or "unknown-target"


def safe_median(values: list[float]) -> float | None:
    clean = [v for v in values if math.isfinite(v)]
    return statistics.median(clean) if clean else None


def percentile(values: list[float], pct: float) -> float | None:
    clean = sorted(v for v in values if math.isfinite(v))
    if not clean:
        return None
    if len(clean) == 1:
        return clean[0]
    idx = (len(clean) - 1) * pct / 100.0
    lo = math.floor(idx)
    hi = math.ceil(idx)
    if lo == hi:
        return clean[lo]
    frac = idx - lo
    return clean[lo] * (1.0 - frac) + clean[hi] * frac


def load_previously_cached_target_names() -> list[str]:
    """Names already in data/exoplanets.json before this run, if any. Read
    once at the start so a bigger TARGET_COUNT can grow the catalogue
    without silently dropping targets that fall outside the new top-N
    ordering (the archive has a huge dynamic range in transit depth, so
    "top N by depth" alone is not a stable superset relationship as N grows)."""
    if not EXOPLANET_CACHE_PATH.exists():
        return []
    try:
        existing = json.loads(EXOPLANET_CACHE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []
    targets = existing if isinstance(existing, list) else existing.get("targets", [])
    return [t.get("pl_name") for t in targets if isinstance(t, dict) and t.get("pl_name")]


def normalise_exoplanet_row(row: dict[str, Any]) -> dict[str, Any]:
    planet_name = clean_text(row.get("pl_name"))
    # NASA Exoplanet Archive reports pl_trandep in PERCENT (verified directly
    # against the archive: HD 189733 b returns 2.4, i.e. 2.4%, matching its
    # well-documented ~24,000 ppm transit depth). ExoLight's whole frontend
    # (physics, evidence scoring, ppm display formatting) assumes ppm, so
    # convert here once, at the source, rather than downstream.
    trandep_percent = as_float(row.get("pl_trandep"))
    trandep_ppm = trandep_percent * 10000 if trandep_percent is not None else None
    return {
        "pl_name": planet_name,
        "hostname": clean_text(row.get("hostname")),
        "sy_snum": as_int(row.get("sy_snum")),
        "sy_pnum": as_int(row.get("sy_pnum")),
        "ra": as_float(row.get("ra")),
        "dec": as_float(row.get("dec")),
        "pl_orbper": as_float(row.get("pl_orbper")),
        "pl_orbsmax": as_float(row.get("pl_orbsmax")),
        "pl_ratror": as_float(row.get("pl_ratror")),
        "pl_rade": as_float(row.get("pl_rade")),
        "pl_bmasse": as_float(row.get("pl_bmasse")),
        "pl_orbincl": as_float(row.get("pl_orbincl")),
        "pl_orbeccen": as_float(row.get("pl_orbeccen")),
        "pl_trandep": trandep_ppm,
        "pl_trandur": as_float(row.get("pl_trandur")),
        "pl_tranmid": as_float(row.get("pl_tranmid")),
        "st_teff": as_float(row.get("st_teff")),
        "st_rad": as_float(row.get("st_rad")),
        "st_mass": as_float(row.get("st_mass")),
        "st_logg": as_float(row.get("st_logg")),
        "st_met": as_float(row.get("st_met")),
        "disc_year": as_int(row.get("disc_year")),
        "discoverymethod": clean_text(row.get("discoverymethod")) or "Transit",
        "lightcurve_file": f"{slugify(planet_name)}.json" if planet_name else None,
        "lightcurve_available": False,
    }


def required_exoplanet_fields_complete(row: dict[str, Any]) -> bool:
    # pl_orbeccen is deliberately not required: the frontend already defaults
    # a missing eccentricity to 0 (assumed circular) in every place it's
    # used (see numberValue(target.pl_orbeccen, 0) in src/app.js), and
    # requiring it here excludes real, otherwise-complete targets purely
    # because the archive hasn't measured/published that one field yet.
    required = [
        "pl_name",
        "hostname",
        "pl_orbper",
        "pl_orbsmax",
        "pl_ratror",
        "pl_orbincl",
        "pl_trandep",
        "st_rad",
        "st_teff",
    ]
    return all(row.get(key) is not None for key in required)


def post_json_form(url: str, payload: dict[str, Any], timeout: int = DEFAULT_TIMEOUT) -> Any:
    response = requests.post(url, data=payload, timeout=timeout)
    response.raise_for_status()
    return response.json()


def _rows_from_adql(query: str) -> list[dict[str, Any]]:
    payload = {
        "request": "doQuery",
        "lang": "ADQL",
        "format": "json",
        "query": query,
    }
    data = post_json_form(TAP_URL, payload)

    if not isinstance(data, list):
        raise ValueError("NASA TAP response was not a JSON row list")

    rows: list[dict[str, Any]] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        row = normalise_exoplanet_row(item)
        if required_exoplanet_fields_complete(row):
            rows.append(row)
    return rows


def fetch_rows_by_name(names: list[str]) -> list[dict[str, Any]]:
    """Fetch specific targets by name, so a catalogue refresh with a larger
    TARGET_COUNT can't silently drop previously-included targets just
    because the archive now has more deeper-transit rows ahead of them in
    the ORDER BY pl_trandep ranking."""
    if not names:
        return []
    columns = ADQL_QUERY.split("SELECT TOP")[1].split("FROM")[0]
    columns = columns.split(f"{TARGET_COUNT}", 1)[1] if f"{TARGET_COUNT}" in columns else columns
    rows: list[dict[str, Any]] = []
    batch_size = 40
    for i in range(0, len(names), batch_size):
        batch = names[i:i + batch_size]
        name_list = ", ".join("'" + n.replace("'", "''") + "'" for n in batch)
        query = f"""
SELECT{columns}FROM pscomppars
WHERE pl_name IN ({name_list})
"""
        try:
            rows.extend(_rows_from_adql(query))
        except requests.RequestException:
            continue
    return rows


def fetch_exoplanet_rows() -> list[dict[str, Any]]:
    preserved_names = load_previously_cached_target_names()
    depth_ranked = _rows_from_adql(ADQL_QUERY)

    seen_keys = {(r["pl_name"], r["hostname"]) for r in depth_ranked}
    missing_names = [n for n in preserved_names if not any(r["pl_name"] == n for r in depth_ranked)]
    if missing_names:
        print(f"Re-fetching {len(missing_names)} previously-catalogued targets that fell outside "
              f"the top {TARGET_COUNT} by transit depth, so they aren't silently dropped...")
        preserved_rows = fetch_rows_by_name(missing_names)
        for row in preserved_rows:
            key = (row["pl_name"], row["hostname"])
            if key not in seen_keys:
                seen_keys.add(key)
                depth_ranked.append(row)

    rows: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for row in depth_ranked:
        key = (row["pl_name"] or "", row["hostname"] or "")
        if key in seen:
            continue
        seen.add(key)
        rows.append(row)

    rows.sort(
        key=lambda r: (
            r["pl_trandep"] if r["pl_trandep"] is not None else -1.0,
            r["pl_ratror"] if r["pl_ratror"] is not None else -1.0,
        ),
        reverse=True,
    )

    # Deliberately not truncated to TARGET_COUNT here: the top-N-by-depth
    # query is already capped at the SQL level, and any extra rows past that
    # are previously-catalogued targets being preserved (see
    # load_previously_cached_target_names), which should never be silently
    # dropped just because the catalogue grew.
    return rows


def mast_invoke(service: str, params: dict[str, Any], timeout: int = DEFAULT_TIMEOUT) -> list[dict[str, Any]]:
    request_payload = {
        "service": service,
        "params": params,
        "format": "json",
        "pagesize": 2000,
        "page": 1,
    }
    response = requests.post(
        MAST_INVOKE_URL,
        data={"request": json.dumps(request_payload)},
        timeout=timeout,
    )
    response.raise_for_status()
    payload = response.json()

    if isinstance(payload, dict):
        status = str(payload.get("status", "")).upper()
        if status and status not in {"COMPLETE", "EXECUTING"}:
            message = payload.get("msg") or payload.get("message") or f"MAST service {service} returned status {status}"
            raise RuntimeError(str(message))

        data = payload.get("data", [])
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]

    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]

    return []


def query_mast_observations(target: dict[str, Any]) -> list[dict[str, Any]]:
    filters = [
        {"paramName": "obs_collection", "values": ["TESS", "Kepler", "K2"]},
        {"paramName": "dataproduct_type", "values": ["timeseries"]},
    ]

    columns = ",".join(
        [
            "obsid",
            "obs_id",
            "obs_collection",
            "target_name",
            "dataproduct_type",
            "t_min",
            "t_max",
            "filters",
            "proposal_id",
            "sequence_number",
        ]
    )

    ra = target.get("ra")
    dec = target.get("dec")

    rows: list[dict[str, Any]] = []

    if isinstance(ra, (int, float)) and isinstance(dec, (int, float)) and math.isfinite(ra) and math.isfinite(dec):
        for radius_deg in (0.02, 0.04, 0.08):
            try:
                params = {
                    "columns": columns,
                    "filters": filters,
                    "position": f"{ra} {dec} {radius_deg}",
                }
                rows = mast_invoke("Mast.Caom.Filtered.Position", params, timeout=DEFAULT_TIMEOUT)
                if rows:
                    break
            except Exception:
                rows = []

    if not rows:
        for name in [target.get("hostname"), target.get("pl_name")]:
            if not name:
                continue

            try:
                params = {
                    "columns": columns,
                    "filters": filters + [{"paramName": "target_name", "values": [str(name)]}],
                }
                rows = mast_invoke("Mast.Caom.Filtered", params, timeout=DEFAULT_TIMEOUT)
                if rows:
                    break
            except Exception:
                rows = []

    rows.sort(key=observation_score, reverse=True)
    return rows


def observation_score(row: dict[str, Any]) -> float:
    collection = str(row.get("obs_collection", "")).upper()
    target_name = str(row.get("target_name", "")).upper()
    score = 0.0

    if collection == "TESS":
        score += 40.0
    elif collection == "KEPLER":
        score += 35.0
    elif collection == "K2":
        score += 30.0

    if target_name:
        score += 5.0

    t_min = as_float(row.get("t_min"))
    t_max = as_float(row.get("t_max"))
    if t_min is not None and t_max is not None:
        score += min(20.0, max(0.0, t_max - t_min) / 30.0)

    return score


def query_mast_products(obsid: Any) -> list[dict[str, Any]]:
    if obsid is None:
        return []

    params = {
        "obsid": str(obsid),
        "columns": "*",
    }
    rows = mast_invoke("Mast.Caom.Products", params, timeout=DEFAULT_TIMEOUT)
    rows.sort(key=product_score, reverse=True)
    return rows


def product_score(product: dict[str, Any]) -> float:
    filename = str(product.get("productFilename") or product.get("filename") or "").lower()
    subgroup = str(product.get("productSubGroupDescription") or "").upper()
    product_type = str(product.get("productType") or "").upper()
    description = str(product.get("description") or "").lower()
    size = as_float(product.get("size"))

    score = 0.0

    if filename.endswith(".fits") or filename.endswith(".fits.gz"):
        score += 30.0
    if subgroup in {"LC", "LLC", "SLC"}:
        score += 50.0
    if subgroup == "LC":
        score += 8.0
    if product_type == "SCIENCE":
        score += 10.0
    if "lightcurve" in description or "light curve" in description:
        score += 12.0
    if "target pixel" in description or subgroup in {"TP", "TPF"}:
        score -= 80.0
    if "ffi" in filename:
        score -= 20.0
    if size is not None:
        score += max(-10.0, min(8.0, 8.0 - size / 80_000_000.0))

    return score


def product_uri(product: dict[str, Any]) -> str | None:
    uri = (
        product.get("dataURI")
        or product.get("dataUri")
        or product.get("uri")
        or product.get("URL")
        or product.get("url")
    )
    return str(uri) if uri else None


def product_filename(product: dict[str, Any]) -> str:
    filename = product.get("productFilename") or product.get("filename") or "mast-lightcurve.fits"
    return str(filename)


def download_mast_product(uri: str, timeout: int = DEFAULT_TIMEOUT) -> bytes:
    url = f"{MAST_DOWNLOAD_URL}?uri={quote(uri, safe='')}"
    response = requests.get(url, timeout=timeout)
    response.raise_for_status()
    content = response.content

    if content[:2] == b"\x1f\x8b":
        return gzip.decompress(content)

    return content


def parse_fits_header_value(raw: str) -> Any:
    text = raw.strip()

    if not text:
        return None

    if text.startswith("'"):
        end = text.find("'", 1)
        if end >= 0:
            return text[1:end].strip()

    text = text.split("/")[0].strip()

    if text in {"T", "F"}:
        return text == "T"

    try:
        if any(mark in text.upper() for mark in [".", "E", "D"]):
            return float(text.replace("D", "E"))
        return int(text)
    except ValueError:
        return text.strip()


def read_fits_header(blob: bytes, offset: int) -> tuple[dict[str, Any], int]:
    cards: list[str] = []
    pos = offset

    while pos + 80 <= len(blob):
        card = blob[pos : pos + 80].decode("ascii", errors="replace")
        cards.append(card)
        pos += 80
        if card.startswith("END"):
            break

    header_bytes = pos - offset
    padded_header_bytes = ((header_bytes + 2879) // 2880) * 2880
    data_start = offset + padded_header_bytes

    header: dict[str, Any] = {}

    for card in cards:
        key = card[:8].strip()
        if not key or key == "END":
            continue
        if card[8:10] == "= ":
            header[key] = parse_fits_header_value(card[10:80])

    return header, data_start


def fits_data_size(header: dict[str, Any]) -> int:
    naxis = as_int(header.get("NAXIS")) or 0
    if naxis == 0:
        base = 0
    else:
        base = 1
        for axis in range(1, naxis + 1):
            base *= max(0, as_int(header.get(f"NAXIS{axis}")) or 0)

    pcount = max(0, as_int(header.get("PCOUNT")) or 0)
    gcount = max(1, as_int(header.get("GCOUNT")) or 1)
    bitpix = abs(as_int(header.get("BITPIX")) or 8)
    return (base + pcount) * gcount * bitpix // 8


def parse_tform(tform: str) -> tuple[int, str, int]:
    match = re.match(r"^\s*(\d*)([A-Z])", str(tform).strip().upper())
    if not match:
        return 1, "X", 0

    repeat = int(match.group(1) or "1")
    code = match.group(2)
    sizes = {
        "L": 1,
        "A": 1,
        "B": 1,
        "I": 2,
        "J": 4,
        "K": 8,
        "E": 4,
        "D": 8,
    }
    return repeat, code, repeat * sizes.get(code, 0)


def unpack_fits_value(blob: bytes, offset: int, repeat: int, code: str) -> Any:
    if code == "A":
        return blob[offset : offset + repeat].decode("ascii", errors="ignore").strip()
    if code == "L":
        values = [blob[offset + i : offset + i + 1] == b"T" for i in range(repeat)]
        return values[0] if repeat == 1 else values
    if code == "B":
        values = list(blob[offset : offset + repeat])
        return values[0] if repeat == 1 else values

    fmt_map = {
        "I": ">h",
        "J": ">i",
        "K": ">q",
        "E": ">f",
        "D": ">d",
    }

    fmt = fmt_map.get(code)
    if fmt is None:
        return None

    size = struct.calcsize(fmt)
    values = []
    for i in range(repeat):
        start = offset + i * size
        end = start + size
        if end > len(blob):
            values.append(None)
        else:
            values.append(struct.unpack(fmt, blob[start:end])[0])

    return values[0] if repeat == 1 else values


def extract_fits_table(blob: bytes) -> list[dict[str, Any]]:
    offset = 0

    while offset < len(blob):
        header, data_start = read_fits_header(blob, offset)
        xtension = str(header.get("XTENSION", "")).strip().upper()
        data_size = fits_data_size(header)
        next_offset = data_start + ((data_size + 2879) // 2880) * 2880

        if xtension == "BINTABLE":
            row_len = as_int(header.get("NAXIS1")) or 0
            row_count = as_int(header.get("NAXIS2")) or 0
            field_count = as_int(header.get("TFIELDS")) or 0

            if row_len > 0 and row_count > 0 and field_count > 0:
                columns = []
                cursor = 0

                for idx in range(1, field_count + 1):
                    name = str(header.get(f"TTYPE{idx}", f"COL{idx}")).strip()
                    repeat, code, size = parse_tform(str(header.get(f"TFORM{idx}", "")))
                    columns.append(
                        {
                            "name": name,
                            "repeat": repeat,
                            "code": code,
                            "size": size,
                            "offset": cursor,
                        }
                    )
                    cursor += size

                rows: list[dict[str, Any]] = []
                max_rows = min(row_count, 300_000)

                for row_index in range(max_rows):
                    base = data_start + row_index * row_len
                    if base + row_len > len(blob):
                        break

                    row: dict[str, Any] = {}
                    for col in columns:
                        if col["size"] <= 0:
                            continue
                        row[col["name"]] = unpack_fits_value(
                            blob,
                            base + col["offset"],
                            col["repeat"],
                            col["code"],
                        )
                    rows.append(row)

                if rows and table_has_lightcurve_columns(rows[0]):
                    return rows

        if next_offset <= offset:
            break

        offset = next_offset

    return []


def table_has_lightcurve_columns(row: dict[str, Any]) -> bool:
    names = {str(k).upper() for k in row.keys()}
    return "TIME" in names and bool(
        names.intersection(
            {
                "PDCSAP_FLUX",
                "SAP_FLUX",
                "FLUX",
                "KSPSAP_FLUX",
                "DET_FLUX",
            }
        )
    )


def row_get_case_insensitive(row: dict[str, Any], names: list[str]) -> Any:
    lowered = {str(key).lower(): value for key, value in row.items()}
    for name in names:
        key = name.lower()
        if key in lowered:
            return lowered[key]
    return None


def extract_lightcurve_points_from_fits(blob: bytes) -> list[dict[str, float | int | None]]:
    rows = extract_fits_table(blob)
    points: list[dict[str, float | int | None]] = []

    for row in rows:
        time = as_float(row_get_case_insensitive(row, ["TIME"]))
        flux = as_float(
            row_get_case_insensitive(
                row,
                ["PDCSAP_FLUX", "SAP_FLUX", "FLUX", "KSPSAP_FLUX", "DET_FLUX"],
            )
        )
        error = as_float(
            row_get_case_insensitive(
                row,
                ["PDCSAP_FLUX_ERR", "SAP_FLUX_ERR", "FLUX_ERR", "KSPSAP_FLUX_ERR"],
            )
        )
        quality = as_int(row_get_case_insensitive(row, ["QUALITY", "SAP_QUALITY"]))

        if time is None or flux is None:
            continue

        if quality is not None and quality != 0:
            continue

        if not math.isfinite(time) or not math.isfinite(flux) or flux <= 0:
            continue

        points.append(
            {
                "time": time,
                "flux": flux,
                "error": error if error is not None and math.isfinite(error) else None,
                "quality": quality,
            }
        )

    return points


def robust_normalize_flux(points: list[dict[str, float | int | None]]) -> list[dict[str, float | None]]:
    fluxes = [float(p["flux"]) for p in points if isinstance(p.get("flux"), (int, float)) and math.isfinite(float(p["flux"]))]
    med = safe_median(fluxes)

    if med is None or med <= 0:
        return []

    normalized: list[dict[str, float | None]] = []

    for point in points:
        time = point.get("time")
        flux = point.get("flux")
        error = point.get("error")

        if not isinstance(time, (int, float)) or not isinstance(flux, (int, float)):
            continue

        norm_flux = float(flux) / med

        if not math.isfinite(norm_flux) or norm_flux < 0.2 or norm_flux > 1.8:
            continue

        norm_error = None
        if isinstance(error, (int, float)) and math.isfinite(float(error)):
            norm_error = float(error) / med

        normalized.append(
            {
                "time": float(time),
                "flux": norm_flux,
                "error": norm_error,
            }
        )

    return sigma_clip_flux(normalized)


def sigma_clip_flux(points: list[dict[str, float | None]], sigma: float = 6.0) -> list[dict[str, float | None]]:
    fluxes = [p["flux"] for p in points if isinstance(p.get("flux"), float) and math.isfinite(float(p["flux"]))]
    med = safe_median(fluxes)

    if med is None:
        return points

    abs_dev = [abs(float(f) - med) for f in fluxes]
    mad = safe_median(abs_dev)

    if mad is None or mad <= 0:
        return points

    robust_sigma = 1.4826 * mad
    limit = sigma * robust_sigma

    return [
        point
        for point in points
        if isinstance(point.get("flux"), float)
        and abs(float(point["flux"]) - med) <= max(limit, 0.02)
    ]


def wrap_phase(value: float) -> float:
    return ((value + 0.5) % 1.0) - 0.5


def phase_fold_points(
    points: list[dict[str, float | None]],
    period_days: float,
    transit_midpoint: float | None,
) -> list[dict[str, float | None]]:
    if not points or not math.isfinite(period_days) or period_days <= 0:
        return []

    times = [float(p["time"]) for p in points if isinstance(p.get("time"), float)]
    if not times:
        return []

    candidates: list[float] = []

    if transit_midpoint is not None and math.isfinite(transit_midpoint):
        candidates.extend(
            [
                transit_midpoint,
                transit_midpoint - 2_457_000.0,
                transit_midpoint - 2_454_833.0,
                transit_midpoint - 2_400_000.5,
            ]
        )

    candidates.append(safe_median(times) or times[0])

    best_candidate = candidates[0]
    best_score = float("inf")

    for candidate in candidates:
        folded = []
        for point in points:
            time = point.get("time")
            flux = point.get("flux")
            if isinstance(time, float) and isinstance(flux, float):
                folded.append((wrap_phase((time - candidate) / period_days), flux))

        if not folded:
            continue

        sorted_by_flux = sorted(folded, key=lambda x: x[1])
        low = sorted_by_flux[: max(5, len(sorted_by_flux) // 100)]
        centre = safe_median([item[0] for item in low])
        score = abs(centre or 0.0)

        if score < best_score:
            best_score = score
            best_candidate = candidate

    folded_points: list[dict[str, float | None]] = []

    for point in points:
        time = point.get("time")
        flux = point.get("flux")
        error = point.get("error")

        if not isinstance(time, float) or not isinstance(flux, float):
            continue

        phase = wrap_phase((time - best_candidate) / period_days)
        folded_points.append(
            {
                "phase": phase,
                "flux": flux,
                "error": error if isinstance(error, float) and math.isfinite(error) else None,
            }
        )

    if folded_points:
        folded_points = centre_transit_by_flux_minimum(folded_points)

    return folded_points


def centre_transit_by_flux_minimum(points: list[dict[str, float | None]]) -> list[dict[str, float | None]]:
    if not points:
        return []

    sorted_by_flux = sorted(points, key=lambda p: float(p["flux"]) if isinstance(p.get("flux"), float) else 999.0)
    low_count = max(5, len(points) // 100)
    low_phases = [
        float(p["phase"])
        for p in sorted_by_flux[:low_count]
        if isinstance(p.get("phase"), float) and math.isfinite(float(p["phase"]))
    ]
    centre = safe_median(low_phases)

    if centre is None:
        centre = 0.0

    shifted = []
    for point in points:
        phase = point.get("phase")
        flux = point.get("flux")
        error = point.get("error")

        if not isinstance(phase, float) or not isinstance(flux, float):
            continue

        shifted.append(
            {
                "phase": wrap_phase(phase - centre),
                "flux": flux,
                "error": error if isinstance(error, float) and math.isfinite(error) else None,
            }
        )

    shifted.sort(key=lambda p: float(p["phase"]))
    return shifted


def crop_phase_window(points: list[dict[str, float | None]], window: float) -> list[dict[str, float | None]]:
    cropped = [
        p
        for p in points
        if isinstance(p.get("phase"), float)
        and isinstance(p.get("flux"), float)
        and -window <= float(p["phase"]) <= window
    ]

    if len(cropped) >= 80:
        return cropped

    wider = [
        p
        for p in points
        if isinstance(p.get("phase"), float)
        and isinstance(p.get("flux"), float)
        and -0.30 <= float(p["phase"]) <= 0.30
    ]

    return wider if len(wider) > len(cropped) else cropped


def median_bin_lightcurve(
    points: list[dict[str, float | None]],
    max_points: int = DEFAULT_MAX_POINTS,
) -> list[dict[str, float | None]]:
    if len(points) <= max_points:
        return sorted(points, key=lambda p: float(p["phase"]))

    sorted_points = sorted(points, key=lambda p: float(p["phase"]))
    phase_min = float(sorted_points[0]["phase"])
    phase_max = float(sorted_points[-1]["phase"])
    bins = max(50, max_points)
    width = (phase_max - phase_min) / bins if phase_max > phase_min else 1.0
    grouped: list[list[dict[str, float | None]]] = [[] for _ in range(bins)]

    for point in sorted_points:
        phase = float(point["phase"])
        idx = int((phase - phase_min) / width) if width > 0 else 0
        idx = max(0, min(bins - 1, idx))
        grouped[idx].append(point)

    binned: list[dict[str, float | None]] = []

    for group in grouped:
        if not group:
            continue

        phases = [float(p["phase"]) for p in group if isinstance(p.get("phase"), float)]
        fluxes = [float(p["flux"]) for p in group if isinstance(p.get("flux"), float)]
        errors = [float(p["error"]) for p in group if isinstance(p.get("error"), float)]

        phase = safe_median(phases)
        flux = safe_median(fluxes)
        error = safe_median(errors) if errors else None

        if phase is not None and flux is not None:
            binned.append(
                {
                    "phase": phase,
                    "flux": flux,
                    "error": error,
                }
            )

    binned.sort(key=lambda p: float(p["phase"]))
    return binned[:max_points]


def save_lightcurve_json(
    target: dict[str, Any],
    product: dict[str, Any],
    observation: dict[str, Any],
    points: list[dict[str, float | None]],
) -> Path:
    file_name = target.get("lightcurve_file") or f"{slugify(target.get('pl_name'))}.json"
    path = LIGHTCURVE_DIR / str(file_name)

    payload = {
        "schema": "exointel-prime-real-lightcurve-v1",
        "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "MAST archive FITS time-series product",
        "planet": target.get("pl_name"),
        "hostname": target.get("hostname"),
        "period_days": target.get("pl_orbper"),
        "transit_midpoint": target.get("pl_tranmid"),
        "obs_collection": observation.get("obs_collection"),
        "obsid": observation.get("obsid") or observation.get("obsID"),
        "target_name": observation.get("target_name"),
        "product_filename": product_filename(product),
        "product_subgroup": product.get("productSubGroupDescription"),
        "reduction": "real archive flux, quality-filtered, median-normalized, phase-folded, transit-centred, median-binned",
        "points_count": len(points),
        "phase": [round(float(p["phase"]), 8) for p in points],
        "flux": [round(float(p["flux"]), 8) for p in points],
        "error": [
            round(float(p["error"]), 8) if isinstance(p.get("error"), float) and math.isfinite(float(p["error"])) else None
            for p in points
        ],
        "points": [
            {
                "phase": round(float(p["phase"]), 8),
                "flux": round(float(p["flux"]), 8),
                "error": round(float(p["error"]), 8) if isinstance(p.get("error"), float) and math.isfinite(float(p["error"])) else None,
            }
            for p in points
        ],
    }

    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def build_lightcurve_for_target(
    target: dict[str, Any],
    max_points: int,
    phase_window: float,
) -> tuple[bool, str]:
    period = target.get("pl_orbper")

    if not isinstance(period, (int, float)) or not math.isfinite(period) or period <= 0:
        return False, "missing valid orbital period"

    observations = query_mast_observations(target)

    if not observations:
        return False, "no MAST TESS/Kepler/K2 time-series observations found"

    for observation in observations[:8]:
        obsid = observation.get("obsid") or observation.get("obsID")
        products = query_mast_products(obsid)

        for product in products[:12]:
            uri = product_uri(product)
            filename = product_filename(product).lower()

            if not uri:
                continue

            if not (filename.endswith(".fits") or filename.endswith(".fits.gz")):
                continue

            if product_score(product) < 20:
                continue

            try:
                blob = download_mast_product(uri)
                raw_points = extract_lightcurve_points_from_fits(blob)
                if len(raw_points) < 80:
                    continue

                normalized = robust_normalize_flux(raw_points)
                if len(normalized) < 80:
                    continue

                folded = phase_fold_points(normalized, float(period), target.get("pl_tranmid"))
                cropped = crop_phase_window(folded, phase_window)
                binned = median_bin_lightcurve(cropped, max_points=max_points)

                if len(binned) < 60:
                    continue

                save_lightcurve_json(target, product, observation, binned)
                target["lightcurve_available"] = True
                return True, f"{len(binned)} real points from {product_filename(product)}"

            except Exception as exc:
                continue

    return False, "compatible products found, but no usable light-curve table was extracted"


def build_exoplanet_cache(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "schema": "exointel-prime-gold-target-cache-v2",
        "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "NASA Exoplanet Archive TAP pscomppars",
        "tap_url": TAP_URL,
        "adql": ADQL_QUERY.strip(),
        "target_count": len(rows),
        "lightcurve_directory": "data/lightcurves",
        "columns": [
            "pl_name",
            "hostname",
            "sy_snum",
            "sy_pnum",
            "ra",
            "dec",
            "pl_orbper",
            "pl_orbsmax",
            "pl_ratror",
            "pl_rade",
            "pl_bmasse",
            "pl_orbincl",
            "pl_orbeccen",
            "pl_trandep",
            "pl_trandur",
            "pl_tranmid",
            "st_teff",
            "st_rad",
            "st_mass",
            "st_logg",
            "st_met",
            "disc_year",
            "discoverymethod",
            "lightcurve_file",
            "lightcurve_available",
        ],
        "targets": rows,
    }


def write_gitkeep() -> None:
    gitkeep = LIGHTCURVE_DIR / ".gitkeep"
    if not gitkeep.exists():
        gitkeep.write_text("", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build ExoIntel-Prime exoplanet and real light-curve caches.")
    parser.add_argument(
        "--skip-lightcurves",
        action="store_true",
        help="Only refresh data/exoplanets.json; do not query MAST light-curve products.",
    )
    parser.add_argument(
        "--refetch-existing",
        action="store_true",
        help="Re-query MAST even for targets that already have a cached light-curve JSON file "
             "(by default those are left untouched and counted as already succeeded).",
    )
    parser.add_argument(
        "--max-lightcurves",
        type=int,
        default=TARGET_COUNT,
        help="Maximum number of targets for which to attempt MAST light-curve harvesting.",
    )
    parser.add_argument(
        "--max-points",
        type=int,
        default=DEFAULT_MAX_POINTS,
        help="Maximum number of phase-folded points saved per light-curve JSON.",
    )
    parser.add_argument(
        "--phase-window",
        type=float,
        default=DEFAULT_PHASE_WINDOW,
        help="Half-width of phase window retained around transit centre.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    LIGHTCURVE_DIR.mkdir(parents=True, exist_ok=True)
    write_gitkeep()

    try:
        print(f"Querying NASA Exoplanet Archive TAP for the top {TARGET_COUNT} transiting targets by depth...")
        rows = fetch_exoplanet_rows()
        preserved_extra = len(rows) - TARGET_COUNT
        if preserved_extra > 0:
            print(f"Catalogue has {len(rows)} targets: top {TARGET_COUNT} by depth, plus {preserved_extra} "
                  f"previously-catalogued targets outside that ranking that were preserved rather than dropped.")
        elif len(rows) < TARGET_COUNT:
            print(f"Warning: expected {TARGET_COUNT} targets but received {len(rows)} after cleaning.", file=sys.stderr)

        # Always do this pass first, regardless of --skip-lightcurves: it's a
        # pure filesystem check, so targets that already have a cached local
        # light curve from a previous run keep lightcurve_available=true even
        # if this run never touches the network.
        already_cached = 0
        for target in rows:
            name = target.get("pl_name") or ""
            expected_file = target.get("lightcurve_file") or f"{slugify(name)}.json"
            if not args.refetch_existing and (LIGHTCURVE_DIR / str(expected_file)).exists():
                target["lightcurve_available"] = True
                already_cached += 1
        print(f"{already_cached}/{len(rows)} targets already have a cached local light curve.")

        if not args.skip_lightcurves:
            attempts = max(0, min(int(args.max_lightcurves), len(rows)))
            print(f"Attempting real MAST light-curve pre-fetch for up to {attempts} targets...")

            successes = 0
            skipped_existing = 0
            for idx, target in enumerate(rows[:attempts], start=1):
                name = target.get("pl_name") or f"target-{idx}"
                if target.get("lightcurve_available"):
                    skipped_existing += 1
                    successes += 1
                    continue
                try:
                    ok, message = build_lightcurve_for_target(
                        target,
                        max_points=max(100, int(args.max_points)),
                        phase_window=max(0.03, float(args.phase_window)),
                    )
                    if ok:
                        successes += 1
                        print(f"[{idx:03d}/{attempts:03d}] {name}: saved {message}")
                    else:
                        print(f"[{idx:03d}/{attempts:03d}] {name}: no local LC ({message})")
                except KeyboardInterrupt:
                    print("\nInterrupted by user. Writing catalog with completed light curves so far.", file=sys.stderr)
                    break
                except Exception as exc:
                    print(f"[{idx:03d}/{attempts:03d}] {name}: failed ({exc})")

            print(f"Real light-curve files saved for {successes}/{attempts} attempted targets ({skipped_existing} already cached, skipped).")
        else:
            print("Skipping MAST light-curve harvesting by user request.")

        cache = build_exoplanet_cache(rows)
        EXOPLANET_CACHE_PATH.write_text(
            json.dumps(cache, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

        print(f"Saved exoplanet cache to {EXOPLANET_CACHE_PATH}")
        print(f"Light-curve directory ready at {LIGHTCURVE_DIR}")
        return 0

    except requests.RequestException as exc:
        print(f"Network request failed: {exc}", file=sys.stderr)
        return 1
    except (ValueError, OSError, json.JSONDecodeError, RuntimeError) as exc:
        print(f"Cache generation failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
