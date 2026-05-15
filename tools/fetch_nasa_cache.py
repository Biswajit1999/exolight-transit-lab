import json
from pathlib import Path

try:
    import requests
except ImportError:
    raise SystemExit("Install requests first: pip install requests")

ENDPOINT = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"
OUT = Path("data/exoplanets.json")
QUERY = """
SELECT TOP 500
  pl_name, hostname, pl_orbper, pl_orbsmax, pl_rade, pl_radj, pl_bmassj,
  pl_orbincl, pl_trandep, pl_trandur, st_rad, st_mass, st_teff, sy_dist, discoverymethod
FROM pscomppars
WHERE tran_flag = 1
  AND pl_orbper IS NOT NULL
  AND st_rad IS NOT NULL
  AND (pl_rade IS NOT NULL OR pl_radj IS NOT NULL)
ORDER BY pl_trandep DESC
""".strip()

def main():
    print("Fetching NASA Exoplanet Archive TAP data...")
    r = requests.get(ENDPOINT, params={"query": QUERY, "format": "json"}, timeout=90)
    r.raise_for_status()
    rows = r.json()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(rows, indent=2), encoding="utf-8")
    print(f"Wrote {len(rows)} rows to {OUT}")

if __name__ == "__main__":
    main()
