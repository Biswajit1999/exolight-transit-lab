"""Optional offline transit-ephemeris and depth-consistency diagnostics.

Time inputs must be in a *single explicitly chosen* time standard, e.g.
BJD_TDB days; no UTC/TDB or barycentric conversion is performed here.
Uncertainties are independent Gaussian 1-sigma estimates. Results from
synthetic tests are NOT observational evidence or a transit detection.

This offline Python tool does not change the zero-dependency browser app.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import numpy as np


@dataclass(frozen=True)
class EphemerisFit:
    reference_epoch: float
    reference_midtime_days: float
    period_days: float
    covariance: np.ndarray  # (T_reference, P) with days and days/cycle
    residual_days: np.ndarray
    chi2: float
    dof: int

    def predict(self, epochs: Sequence[float]) -> tuple[np.ndarray, np.ndarray]:
        e = np.asarray(epochs, dtype=float)
        if not np.isfinite(e).all():
            raise ValueError("epochs must be finite")
        x = e - self.reference_epoch
        predicted = self.reference_midtime_days + self.period_days*x
        variance = self.covariance[0,0] + 2*x*self.covariance[0,1] + x*x*self.covariance[1,1]
        return predicted, np.sqrt(np.maximum(0.0, variance))


@dataclass(frozen=True)
class LeaveOneEpochOut:
    predictive_residual_days: np.ndarray
    predictive_sigma_days: np.ndarray
    standardized_residual: np.ndarray
    rms_standardized_residual: float
    max_absolute_standardized_residual: float


@dataclass(frozen=True)
class EvenOddDepth:
    even_depth: float
    odd_depth: float
    even_error: float
    odd_error: float
    difference_even_minus_odd: float
    difference_error: float
    z_score: float
    n_even: int
    n_odd: int


def _valid(epochs: Sequence[int], measurements: Sequence[float], error: Sequence[float], *, minimum: int) -> tuple[np.ndarray,np.ndarray,np.ndarray]:
    ep = np.asarray(epochs, dtype=float)
    y = np.asarray(measurements, dtype=float)
    sigma = np.asarray(error, dtype=float)
    if ep.ndim != 1 or y.shape != ep.shape or sigma.shape != ep.shape or ep.size < minimum:
        raise ValueError(f"matching one-dimensional arrays with >= {minimum} points required")
    if not (np.isfinite(ep).all() and np.isfinite(y).all() and np.isfinite(sigma).all()):
        raise ValueError("all measurements must be finite; no silent filtering")
    if np.any(sigma <= 0) or np.any(ep != np.rint(ep)) or len(np.unique(ep)) != len(ep):
        raise ValueError("errors must be positive and integer epochs unique")
    return ep,y,sigma


def fit_linear_ephemeris(
    epochs: Sequence[int], midtimes_days: Sequence[float], timing_error_days: Sequence[float],
) -> EphemerisFit:
    """WLS T(E)=T_ref+P(E-E_ref), including full parameter covariance.

    Fixed uncertainties are not rescaled by reduced chi². An unmodelled TTV,
    correlated timing errors or wrong error bars invalidate this covariance.
    """
    ep, times, sigma = _valid(epochs,midtimes_days,timing_error_days,minimum=3)
    w = 1.0/sigma**2
    eref = float(np.average(ep,weights=w))
    tcentre = float(np.average(times,weights=w))
    x = ep-eref
    X = np.column_stack((np.ones(len(ep)),x))/sigma[:,None]
    if np.linalg.matrix_rank(X) != 2:
        raise ValueError("epoch design matrix rank deficient")
    beta,*_ = np.linalg.lstsq(X,(times-tcentre)/sigma,rcond=None)
    covariance = np.linalg.inv(X.T@X)
    t_ref = float(tcentre+beta[0])
    period = float(beta[1])
    if period <= 0:
        raise ValueError("inferred period must be positive")
    residual = times-(t_ref+period*x)
    return EphemerisFit(eref,t_ref,period,covariance,residual,
                        float(np.sum((residual/sigma)**2)),len(ep)-2)


def leave_one_epoch_out(
    epochs: Sequence[int], midtimes_days: Sequence[float], timing_error_days: Sequence[float],
) -> LeaveOneEpochOut:
    """Out-of-sample O-C diagnostics with held-out predictive uncertainty.

    Each predicted ephemeris excludes the tested transit. Unlike in-sample
    residuals, the held-out timing error is independent of fit covariance
    under the stated independent-noise assumption.
    """
    ep,times,sigma = _valid(epochs,midtimes_days,timing_error_days,minimum=5)
    residuals=np.empty(len(ep))
    predictive_sigma=np.empty(len(ep))
    for i in range(len(ep)):
        keep=np.ones(len(ep),dtype=bool)
        keep[i]=False
        fit=fit_linear_ephemeris(ep[keep],times[keep],sigma[keep])
        prediction, model_error=fit.predict([ep[i]])
        residuals[i]=times[i]-prediction[0]
        predictive_sigma[i]=np.hypot(sigma[i],model_error[0])
    z=residuals/predictive_sigma
    return LeaveOneEpochOut(residuals,predictive_sigma,z,
                            float(np.sqrt(np.mean(z*z))),float(np.max(np.abs(z))))


def even_odd_depth_test(
    epochs: Sequence[int], depths: Sequence[float], depth_error: Sequence[float],
) -> EvenOddDepth:
    """Inverse-variance even/odd transit-depth consistency z-score.

    Assumes independent per-event depth errors, known variance, and fixed
    even/odd partition. A discrepancy can motivate further vetting but is
    not by itself a calibrated false-positive probability.
    """
    ep,y,sigma = _valid(epochs,depths,depth_error,minimum=4)
    even=np.remainder(ep,2)==0
    if even.sum()<2 or (~even).sum()<2:
        raise ValueError("at least two even and two odd transits required")
    def group(mask: np.ndarray) -> tuple[float,float]:
        w=1/sigma[mask]**2
        return float(np.sum(w*y[mask])/np.sum(w)),float(1/np.sqrt(np.sum(w)))
    mean_even,err_even=group(even)
    mean_odd,err_odd=group(~even)
    difference=mean_even-mean_odd
    difference_error=float(np.hypot(err_even,err_odd))
    return EvenOddDepth(mean_even,mean_odd,err_even,err_odd,difference,
                        difference_error,float(difference/difference_error),
                        int(even.sum()),int((~even).sum()))
