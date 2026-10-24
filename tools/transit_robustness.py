"""Independent, approximate transit-observation sensitivity calculations.

Not a limb-darkened transit model, catalog fitter or detection pipeline.
"""
from __future__ import annotations

import numpy as np


def _geometry(depth, duration, ingress):
    for name, value in (("depth", depth), ("duration", duration), ("ingress", ingress)):
        if not np.isfinite(value):
            raise ValueError(f"{name} must be finite")
    if not 0 <= depth < 1 or duration <= 0 or not 0 < ingress <= duration / 2:
        raise ValueError("require 0<=depth<1, duration>0, 0<ingress<=duration/2")


def trapezoid_flux(time, depth, duration, ingress):
    """Symmetric, flat-bottomed transit; total duration is first-to-fourth contact."""
    _geometry(depth, duration, ingress)
    t = np.asarray(time, dtype=float)
    if not np.all(np.isfinite(t)):
        raise ValueError("time must be finite")
    x = np.abs(t)
    factor = np.clip((duration / 2 - x) / ingress, 0, 1)
    return 1 - depth * factor


def _cumulative_deficit(time, depth, duration, ingress):
    """Exact integral of a symmetric trapezoidal flux deficit from -infinity."""
    x = np.asarray(time, dtype=float)
    a = -duration / 2
    b = a + ingress
    c = duration / 2 - ingress
    d = duration / 2
    first = depth * np.clip(x - a, 0, ingress)**2 / (2 * ingress)
    flat = depth * np.clip(x - b, 0, c - b)
    end = np.clip(x - c, 0, ingress)
    last = depth * (end - end**2 / (2 * ingress))
    return first + flat + last


def integrated_trapezoid_flux(time, exposure, depth, duration, ingress):
    """Exact finite-exposure average of the piecewise-linear transit model."""
    _geometry(depth, duration, ingress)
    t = np.asarray(time, dtype=float)
    if not np.all(np.isfinite(t)) or not np.isfinite(exposure) or exposure < 0:
        raise ValueError("time must be finite and exposure nonnegative")
    if exposure == 0:
        return trapezoid_flux(t, depth, duration, ingress)
    half = exposure / 2
    deficit = (_cumulative_deficit(t + half, depth, duration, ingress)
               - _cumulative_deficit(t - half, depth, duration, ingress)) / exposure
    return 1 - deficit


def dilution_radius_ratio(observed_depth, flux_ratio, depth_sigma=0, flux_ratio_sigma=0,
                          correlation=0):
    """Invert delta_obs=k^2/(1+F_contam/F_star) with first-order uncertainty.

    The k^2 relation assumes uniform stellar surface brightness and a small
    fully superimposed planet. Limb darkening/grazing geometry invalidate it.
    """
    values = (observed_depth, flux_ratio, depth_sigma, flux_ratio_sigma, correlation)
    if not np.all(np.isfinite(values)):
        raise ValueError("dilution inputs must be finite")
    if not (0 < observed_depth < 1) or flux_ratio < 0 or depth_sigma < 0 or flux_ratio_sigma < 0:
        raise ValueError("invalid depth, contamination ratio or uncertainties")
    if not -1 <= correlation <= 1:
        raise ValueError("uncertainty correlation must be in [-1,1]")
    k2 = observed_depth * (1 + flux_ratio)
    if k2 >= 1:
        raise ValueError("implied radius ratio must be below unity")
    k = np.sqrt(k2)
    dd = (1 + flux_ratio) / (2 * k)
    dq = observed_depth / (2 * k)
    variance = (dd * depth_sigma)**2 + (dq * flux_ratio_sigma)**2 + 2 * correlation * dd * dq * depth_sigma * flux_ratio_sigma
    return {"radius_ratio": float(k), "radius_ratio_sigma_linear": float(np.sqrt(max(0, variance))),
            "uncorrected_radius_ratio": float(np.sqrt(observed_depth)),
            "dilution_correction_factor": float(np.sqrt(1 + flux_ratio))}


def fit_box_depth_with_baseline(phase, flux, duration_phase, window_half_width,
                                inner_fraction=0.35, outer_fraction=0.65, sigma=None):
    """Fit intercept + linear phase trend - box depth after excluding ingress.

    Without supplied per-point sigma, reported uncertainty uses IID residual
    scatter and is conditional/illustrative, not a calibrated error bar.
    """
    t = np.asarray(phase, dtype=float)
    y = np.asarray(flux, dtype=float)
    if t.ndim != 1 or t.shape != y.shape or len(t) < 8 or not np.all(np.isfinite(t)) or not np.all(np.isfinite(y)):
        raise ValueError("phase and flux must be finite matching vectors")
    if not (np.isfinite(duration_phase) and duration_phase > 0 and np.isfinite(window_half_width)
            and window_half_width > duration_phase and 0 < inner_fraction < 0.5 < outer_fraction < 1):
        raise ValueError("invalid duration, window or ingress guard")
    inside = np.abs(t) <= inner_fraction * duration_phase
    outside = np.abs(t) >= outer_fraction * duration_phase
    mask = (np.abs(t) <= window_half_width) & (inside | outside)
    n_in = int(np.count_nonzero(mask & inside))
    n_out = int(np.count_nonzero(mask & outside))
    if n_in < 3 or n_out < 5:
        raise ValueError("insufficient samples inside or outside transit")
    X = np.column_stack((np.ones(mask.sum()), t[mask], -inside[mask].astype(float)))
    if sigma is None:
        w = np.ones(len(t))
        supplied_errors = False
    else:
        s = np.asarray(sigma, dtype=float)
        if s.shape != t.shape or not np.all(np.isfinite(s)) or np.any(s <= 0):
            raise ValueError("sigma must be a matching positive finite vector")
        w = 1 / s**2
        supplied_errors = True
    Xw = X * np.sqrt(w[mask, None])
    yw = y[mask] * np.sqrt(w[mask])
    coeff, _, rank, _ = np.linalg.lstsq(Xw, yw, rcond=None)
    if rank != 3:
        raise ValueError("baseline/depth design is rank deficient")
    resid = y[mask] - X @ coeff
    dof = len(resid) - 3
    scale = float(np.dot(resid * np.sqrt(w[mask]), resid * np.sqrt(w[mask])) / dof)
    covariance = np.linalg.inv(Xw.T @ Xw) * (1 if supplied_errors else scale)
    return {"depth_ppm": float(coeff[2] * 1e6),
            "conditional_depth_sigma_ppm": float(np.sqrt(covariance[2, 2]) * 1e6),
            "baseline_slope_per_phase": float(coeff[1]),
            "residual_rms_ppm": float(np.sqrt(np.mean(resid**2)) * 1e6),
            "n_inside": n_in, "n_outside": n_out, "n_total": int(len(resid)),
            "errors_supplied": supplied_errors,
            "chi2_per_dof_if_errors_supplied": scale if supplied_errors else None}


def window_sensitivity(phase, flux, duration_phase, windows=(0.03, 0.05, 0.07), **kwargs):
    """Re-fit the same detrended series over different symmetric phase windows."""
    return [{"window_half_width": float(w), **fit_box_depth_with_baseline(
        phase, flux, duration_phase, float(w), **kwargs)} for w in windows]
