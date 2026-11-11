"""Independent offline transit sensitivity checks, not an inference pipeline."""
import math

def weighted_depth(flux, sigma, in_transit):
    """Independent Gaussian inverse-variance baseline and transit means."""
    if not flux or not (len(flux) == len(sigma) == len(in_transit)):
        raise ValueError("invalid lengths")
    if any(not math.isfinite(f) for f in flux) or any(not math.isfinite(s) or s <= 0 for s in sigma):
        raise ValueError("invalid flux or uncertainty")
    def mean(flag):
        pairs=[(f,1/s**2) for f,s,m in zip(flux,sigma,in_transit) if bool(m)==flag]
        if not pairs: raise ValueError("both transit and baseline required")
        sw=sum(w for _,w in pairs)
        return sum(f*w for f,w in pairs)/sw,1/sw
    inside,vi=mean(True)
    outside,vo=mean(False)
    if outside<=0:raise ValueError("nonpositive baseline")
    depth=1-inside/outside
    variance=vi/outside**2+inside**2*vo/outside**4
    return depth,math.sqrt(variance)

def mask_sensitivity(times,flux,sigma,midpoint,half_widths):
    """Depth as a function of explicitly selected symmetric transit mask."""
    if len(times)!=len(flux) or any(not math.isfinite(t) for t in times):
        raise ValueError("invalid times")
    if any(not math.isfinite(w) or w<=0 for w in half_widths):
        raise ValueError("invalid widths")
    return [(w,*weighted_depth(flux,sigma,[abs(t-midpoint)<=w for t in times])) for w in half_widths]

def dilution_correct(depth_observed,contaminant_fraction,sigma_depth=0,sigma_fraction=0):
    """Third light F_c/F_star, independent first-order propagation."""
    x=(depth_observed,contaminant_fraction,sigma_depth,sigma_fraction)
    if any(not math.isfinite(t) for t in x) or min(contaminant_fraction,sigma_depth,sigma_fraction)<0:
        raise ValueError("invalid dilution inputs")
    return (depth_observed*(1+contaminant_fraction),
            math.hypot((1+contaminant_fraction)*sigma_depth,depth_observed*sigma_fraction))
