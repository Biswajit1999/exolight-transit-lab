import pytest
from research.weighted_mask_audit import fit_depth, mask_sensitivity

def test_depth():
    r=fit_depth([1,1,.98,.98],[.01]*4,[False,False,True,True])
    assert r["depth"] == pytest.approx(.02)
    assert r["sigma_depth"] > 0

def test_error_scaling():
    a=fit_depth([1,.98],[.01,.01],[False,True])
    b=fit_depth([1,.98],[.02,.02],[False,True])
    assert b["sigma_depth"] == pytest.approx(2*a["sigma_depth"])

def test_missing_group():
    with pytest.raises(ValueError):
        fit_depth([1],[.01],[True])

def test_mask_sensitivity():
    r=mask_sensitivity([1,.99,.98,.99,1],[.01]*5,[-2,-1,0,1,2],[.1,1.1])
    assert r[0]["depth"] > r[1]["depth"]
