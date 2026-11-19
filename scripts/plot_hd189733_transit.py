"""Plot the committed TESS transit product without fitting new parameters."""

import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np


def main():
    root = Path(__file__).resolve().parents[1]
    light_curve = json.loads((root / "data/lightcurves/hd-189733-b.json").read_text())
    hours = np.asarray(light_curve["phase"]) * light_curve["period_days"] * 24
    flux = (np.asarray(light_curve["flux"]) - 1) * 100
    edges = np.linspace(hours.min(), hours.max(), 33)
    groups = np.clip(np.searchsorted(edges, hours, side="right") - 1, 0, len(edges) - 2)
    centres = (edges[1:] + edges[:-1]) / 2
    p16, median, p84 = np.asarray(
        [np.percentile(flux[groups == i], [16, 50, 84]) for i in range(centres.size)]
    ).T
    half_duration = light_curve["duration_phase"] * light_curve["period_days"] * 12

    with plt.rc_context({"font.size": 11, "axes.spines.top": False, "axes.spines.right": False}):
        fig, ax = plt.subplots(figsize=(7.8, 4.4), layout="constrained")
        handles = []
        for position in (-half_duration, half_duration):
            line = ax.axvline(position, color="#647489", linestyle="--", lw=0.9)
        ax.axhline(0, color="#a9b0b6", lw=0.8)
        points = ax.scatter(hours, flux, s=8, alpha=0.32, color="#20586d")
        spread = ax.errorbar(
            centres, median, yerr=[median - p16, p84 - median],
            linestyle="none", marker="o", ms=3.4, color="#a53f24", lw=1.0, capsize=2.5,
        )
        handles.extend((points, spread, line))
        ax.set_title("HD 189733 b · processed TESS transit", loc="left", fontweight="bold")
        ax.set(xlabel="Hours from phase zero", ylabel="Flux relative to baseline (%)")
        ax.legend(handles, [
            f"{hours.size} archived points", "Bin median and 16th–84th percentile spread",
            "Archived nominal duration",
        ], frameon=False, loc="lower left", fontsize=9)
        fig.savefig(root / "assets/hd189733-observed-transit.png", dpi=120)
        plt.close(fig)


if __name__ == "__main__":
    main()
