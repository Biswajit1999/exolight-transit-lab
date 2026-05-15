"""Fetch MAST observation/product metadata for a target. FITS-to-JSON extraction requires astropy.
Usage:
  pip install requests astropy
  python scripts/mast-lightcurve-fetch.py --ra 300.182 --dec 22.71 --name hd189733
"""
import argparse, json, urllib.parse
from pathlib import Path
import requests

MAST = "https://mast.stsci.edu/api/v0/invoke"

def invoke(request):
    r = requests.post(MAST, data={"request": json.dumps(request)}, timeout=120)
    r.raise_for_status()
    payload = r.json()
    if payload.get("status") == "ERROR":
        raise RuntimeError(payload.get("msg"))
    return payload.get("data", [])

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ra", type=float, required=True)
    ap.add_argument("--dec", type=float, required=True)
    ap.add_argument("--name", default="target")
    args = ap.parse_args()
    obs = invoke({"service":"Mast.Caom.Cone","params":{"ra":args.ra,"dec":args.dec,"radius":0.02},"format":"json","pagesize":2000,"removenullcolumns":True})
    obs = [o for o in obs if o.get("obs_collection") in {"TESS","Kepler","K2"}]
    out = {"target": args.name, "ra": args.ra, "dec": args.dec, "observations": obs[:100]}
    Path("public/examples").mkdir(parents=True, exist_ok=True)
    path = Path(f"public/examples/{args.name}_mast_observations.json")
    path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"Wrote {len(obs)} observations to {path}")

if __name__ == "__main__": main()
