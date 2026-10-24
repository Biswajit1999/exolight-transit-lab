"""Analytical limits, conservation and controlled injection recovery."""
import sys
from pathlib import Path
import numpy as np
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from transit_robustness import (trapezoid_flux, integrated_trapezoid_flux,
    dilution_radius_ratio, fit_box_depth_with_baseline, window_sensitivity)


def test_zero_exposure_exact_limit():
    t = np.linspace(-0.07, 0.07, 101)
    np.testing.assert_array_equal(integrated_trapezoid_flux(t, 0, 0.01, 0.05, 0.01),
                                  trapezoid_flux(t, 0.01, 0.05, 0.01))


def test_cadence_symmetric_and_physical():
    t = np.linspace(-0.08, 0.08, 201)
    f = integrated_trapezoid_flux(t, 0.02, 0.012, 0.04, 0.008)
    np.testing.assert_allclose(f, f[::-1], atol=1e-12)
    assert np.min(f) >= 0.988 - 1e-12 and np.max(f) <= 1


def test_area_conservation():
    t = np.linspace(-0.1, 0.1, 40001)
    f = integrated_trapezoid_flux(t, 0.018, 0.01, 0.05, 0.01)
    assert np.trapezoid(1 - f, t) == pytest.approx(0.01 * (0.05 - 0.01), rel=2e-5)


def test_long_exposure_reduces_central_depth():
    f0 = float(integrated_trapezoid_flux(0.0, 0, 0.02, 0.03, 0.005))
    f1 = float(integrated_trapezoid_flux(0.0, 0.08, 0.02, 0.03, 0.005))
    assert f0 == pytest.approx(0.98)
    assert f1 > f0


def test_dilution_exact_uniform_source_relation():
    d = dilution_radius_ratio(0.01 / 1.5, 0.5)
    assert d["radius_ratio"] == pytest.approx(0.1)
    assert d["dilution_correction_factor"] == pytest.approx(np.sqrt(1.5))


def test_dilution_uncertainty_matches_finite_difference():
    d, q = 0.002, 0.4
    h = 1e-7
    f = lambda x, y: dilution_radius_ratio(x, y)["radius_ratio"]
    dd = (f(d+h,q)-f(d-h,q))/(2*h)
    dq = (f(d,q+h)-f(d,q-h))/(2*h)
    out = dilution_radius_ratio(d,q,0.0001,0.05)
    assert out["radius_ratio_sigma_linear"] == pytest.approx(np.hypot(dd*0.0001,dq*0.05),rel=1e-7)


def test_dilution_invalid_unphysical_rejected():
    with pytest.raises(ValueError):
        dilution_radius_ratio(0.9, 1)


def test_linear_baseline_recovers_injected_box_depth():
    phase = np.linspace(-0.075, 0.075, 601)
    depth = 0.0015
    flux = 1 + 0.004 * phase - depth * (np.abs(phase) < 0.008)
    out = fit_box_depth_with_baseline(phase, flux, 0.02, 0.06)
    assert out["depth_ppm"] == pytest.approx(1500, abs=1e-7)
    assert out["baseline_slope_per_phase"] == pytest.approx(0.004, abs=1e-10)


def test_window_sensitivity_on_clean_signal():
    t = np.linspace(-0.08, 0.08, 801)
    y = 1 - 0.0008 * (np.abs(t) < 0.008)
    results = window_sensitivity(t, y, 0.02)
    assert len(results) == 3
    assert all(r["depth_ppm"] == pytest.approx(800, abs=1e-6) for r in results)


def test_missing_inside_samples_rejected():
    t = np.linspace(0.03, 0.07, 40)
    with pytest.raises(ValueError, match="insufficient"):
        fit_box_depth_with_baseline(t, np.ones_like(t), 0.02, 0.07)


def test_invalid_sigma_rejected():
    t = np.linspace(-0.08, 0.08, 201)
    with pytest.raises(ValueError, match="sigma"):
        fit_box_depth_with_baseline(t, np.ones_like(t), 0.02, 0.07, sigma=np.zeros_like(t))
