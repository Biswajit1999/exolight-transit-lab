"""Standalone synthetic finite-exposure transit audit. Python 3.10+, stdlib only.
AI-assisted implementation; Biswajit Jana is the requested scientific reviewer.
Not a limb-darkened fit or observational validation.
"""
import math
import unittest


def trapezoid(t, depth, duration, ingress):
    """Uniform-source surrogate, symmetric about t=0, with linear ingress."""
    if not all(map(math.isfinite, (t, depth, duration, ingress))):
        raise ValueError("nonfinite input")
    if not (0 <= depth < 1 and duration > 0 and 0 < ingress <= duration / 2):
        raise ValueError("invalid transit geometry")
    distance = abs(t)
    if distance >= duration / 2:
        return 1.0
    if distance <= duration / 2 - ingress:
        return 1.0 - depth
    return 1.0 - depth * (duration / 2 - distance) / ingress


def exposed_flux(t, exposure, depth, duration, ingress, samples=128):
    """Midpoint integration across a boxcar exposure."""
    if not math.isfinite(exposure) or exposure < 0 or not isinstance(samples, int) or samples < 1:
        raise ValueError("invalid exposure or quadrature")
    if exposure == 0:
        return trapezoid(t, depth, duration, ingress)
    return sum(trapezoid(t + exposure * ((k + 0.5) / samples - 0.5),
                         depth, duration, ingress) for k in range(samples)) / samples


def exposure_sweep(times, exposures, depth, duration, ingress):
    """Return maximum model depth at each supplied integration time."""
    times = tuple(times)
    if not times:
        raise ValueError("no cadence times")
    return [(e, 1.0 - min(exposed_flux(t, e, depth, duration, ingress)
                          for t in times)) for e in exposures]


class SyntheticTests(unittest.TestCase):
    def test_zero_exposure(self):
        self.assertAlmostEqual(exposed_flux(0, 0, .02, 2, .2), .98)
    def test_full_transit(self):
        self.assertAlmostEqual(exposed_flux(0, .1, .02, 2, .2), .98)
    def test_smearing(self):
        self.assertLess(exposure_sweep([0], [2], .02, 2, .2)[0][1], .02)
    def test_convergence(self):
        a = exposed_flux(.85, .4, .02, 2, .2, 1024)
        b = exposed_flux(.85, .4, .02, 2, .2, 2048)
        self.assertLess(abs(a-b), 1e-5)
    def test_invalid(self):
        with self.assertRaises(ValueError):
            exposed_flux(0, -1, .02, 2, .2)


if __name__ == "__main__":
    unittest.main()
