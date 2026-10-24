"""Run independent sensitivity diagnostics on an existing retained K2 light curve."""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from transit_robustness import dilution_radius_ratio, integrated_trapezoid_flux, window_sensitivity


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=Path(__file__).resolve().parents[1] / "data/lightcurves/hd-189733-b.json")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    data = json.loads(args.data.read_text(encoding="utf-8"))
    phase = np.asarray(data["phase"], dtype=float)
    flux = np.asarray(data["flux"], dtype=float)
    duration = float(data["duration_phase"])
    if data.get("planet") != "HD 189733 b" or len(phase) != int(data["points_count"]):
        raise ValueError("unexpected source light-curve identity or length")
    if data.get("error") is not None and any(x is not None for x in data["error"]):
        raise ValueError("this demonstration explicitly expects unavailable per-point uncertainties")
    cadence = [float(integrated_trapezoid_flux(0.0, exposure, 0.001, duration, duration / 6))
               for exposure in (0, duration / 5, duration / 2, duration)]
    result = {"planet": data["planet"], "source": data["source"],
              "processing": data.get("processing"), "n_retained_points": len(phase),
              "windows": window_sensitivity(phase, flux, duration, windows=(0.04, 0.05, 0.07)),
              "illustrative_cadence_central_flux": cadence,
              "illustrative_dilution": dilution_radius_ratio(0.001, 0.25, 0.0001, 0.05),
              "limitations": "Input light curve is preprocessed and has null per-point errors; depth errors assume IID residuals and are not calibrated. Trapezoid and dilution calculations are approximations, not physical inference."}
    output = json.dumps(result, indent=2) + "\n"
    if args.output:
        args.output.write_text(output, encoding="utf-8")
    else:
        print(output)


if __name__ == "__main__":
    main()
