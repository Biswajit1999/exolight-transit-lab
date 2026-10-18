"""Synthetic timing and depth diagnostics; no observational discovery claims."""
import numpy as np
import pytest
from tools.transit_timing_diagnostics import (
    fit_linear_ephemeris,leave_one_epoch_out,even_odd_depth_test,
)


def fixture():
    rng=np.random.default_rng(20261018)
    ep=np.arange(24)
    sigma=np.full(24,0.0004)
    times=2459000.0+3.271*ep+rng.normal(0,sigma)
    return ep,times,sigma


def test_linear_ephemeris_recovers_period():
    ep,times,sigma=fixture()
    fit=fit_linear_ephemeris(ep,times,sigma)
    assert abs(fit.period_days-3.271)<5e-5
    assert fit.dof==len(ep)-2
    assert fit.covariance.shape==(2,2)


def test_linear_ephemeris_exact_signal_zero_chi2():
    ep=np.arange(10)
    fit=fit_linear_ephemeris(ep,2459000.1+2.4*ep,np.full(10,0.001))
    assert np.max(abs(fit.residual_days))<1e-8
    assert fit.chi2<1e-8


def test_predictive_uncertainty_increases_far_from_reference():
    ep,times,sigma=fixture()
    fit=fit_linear_ephemeris(ep,times,sigma)
    _,s=fit.predict([fit.reference_epoch,fit.reference_epoch+500])
    assert s[1]>s[0]


def test_prediction_matches_fitted_epoch_values():
    ep,times,sigma=fixture()
    fit=fit_linear_ephemeris(ep,times,sigma)
    pred,_=fit.predict(ep)
    assert np.allclose(times-pred,fit.residual_days,rtol=0,atol=1e-8)


def test_covariance_symmetric_positive_definite():
    ep,times,sigma=fixture()
    cov=fit_linear_ephemeris(ep,times,sigma).covariance
    assert np.allclose(cov,cov.T)
    assert np.linalg.eigvalsh(cov).min()>0


def test_leave_one_out_calibrated_order_of_magnitude():
    ep,times,sigma=fixture()
    result=leave_one_epoch_out(ep,times,sigma)
    assert result.predictive_sigma_days.min()>sigma.min()
    assert 0.3<result.rms_standardized_residual<2.0


def test_leave_one_out_flags_injected_ttv_outlier():
    ep,times,sigma=fixture()
    times[10]+=0.004
    result=leave_one_epoch_out(ep,times,sigma)
    assert abs(result.standardized_residual[10])>5


def test_even_odd_equal_depths():
    ep=np.arange(20)
    result=even_odd_depth_test(ep,np.full(20,0.01),np.full(20,0.001))
    assert abs(result.z_score)<1e-12
    assert result.n_even==result.n_odd==10


def test_even_odd_detects_injected_depth_difference():
    ep=np.arange(20)
    depth=np.where(ep%2==0,0.012,0.008)
    result=even_odd_depth_test(ep,depth,np.full(20,0.0005))
    assert result.z_score>10
    assert abs(result.difference_even_minus_odd-0.004)<1e-12


def test_even_odd_heteroskedastic_weighting():
    ep=np.arange(6)
    depth=np.array([0.01,0.01,0.02,0.01,0.01,0.01])
    sigma=np.array([.001,.001,.1,.001,.001,.001])
    result=even_odd_depth_test(ep,depth,sigma)
    assert result.even_depth<0.01001


@pytest.mark.parametrize('epochs',[np.array([0,1,1,3,4]),np.array([0,1,2.5,3,4])])
def test_invalid_epoch_labels_rejected(epochs):
    with pytest.raises(ValueError):
        fit_linear_ephemeris(epochs,np.arange(5.)+10,np.ones(5))


def test_nonpositive_timing_error_rejected():
    with pytest.raises(ValueError):
        fit_linear_ephemeris(np.arange(5),np.arange(5.)+10,[1,1,0,1,1])


def test_too_few_transits_for_loo_rejected():
    with pytest.raises(ValueError):
        leave_one_epoch_out(np.arange(4),np.arange(4.)+10,np.ones(4))
