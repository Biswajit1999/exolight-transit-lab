"""Independent box-transit cadence and third-light sensitivity; not a fitted transit model."""
import math

def integrated_box_depth(depth, duration, exposure, centre_offset=0.):
    """Exact overlap of box transit with one exposure centred at centre_offset."""
    if not (0 <= depth <= 1 and duration > 0 and exposure > 0 and all(map(math.isfinite,(depth,duration,exposure,centre_offset)))):
        raise ValueError('invalid transit parameters')
    overlap=max(0.,min(duration/2,centre_offset+exposure/2)-max(-duration/2,centre_offset-exposure/2))
    return depth*overlap/exposure

def diluted_depth(intrinsic_depth, contaminant_to_target_flux):
    if not (0 <= intrinsic_depth <= 1 and contaminant_to_target_flux >= 0 and math.isfinite(contaminant_to_target_flux)):
        raise ValueError('invalid dilution')
    return intrinsic_depth/(1+contaminant_to_target_flux)

def radius_ratio_from_depth(observed_depth, contamination, sigma_depth=0., sigma_contamination=0.):
    """Small-planet uniform-disc approximation; independent-error delta method."""
    if not (0 < observed_depth <= 1 and contamination >= 0 and sigma_depth >= 0 and sigma_contamination >= 0):
        raise ValueError('invalid radius-ratio inputs')
    ratio=math.sqrt(observed_depth*(1+contamination))
    sigma=ratio/2*math.hypot(sigma_depth/observed_depth,sigma_contamination/(1+contamination))
    return ratio,sigma
