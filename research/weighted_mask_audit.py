"""Weighted two-level transit depth with explicit baseline uncertainty."""
import math

def fit_depth(flux, sigma, in_transit):
    if not flux or len(flux) != len(sigma) or len(flux) != len(in_transit):
        raise ValueError("nonempty equal-length inputs required")
    groups = [[], []]
    for y, s, inside in zip(flux, sigma, in_transit):
        if not (math.isfinite(y) and math.isfinite(s) and s > 0):
            raise ValueError("finite flux and positive errors required")
        groups[int(bool(inside))].append((y, 1 / s**2))
    if not all(groups):
        raise ValueError("both transit and baseline observations required")
    means = [sum(y*w for y,w in g)/sum(w for _,w in g) for g in groups]
    variances = [1/sum(w for _,w in g) for g in groups]
    baseline, inside = means
    if baseline <= 0:
        raise ValueError("positive baseline required")
    depth = 1 - inside/baseline
    variance = variances[1]/baseline**2 + inside**2*variances[0]/baseline**4
    return {"depth": depth, "sigma_depth": math.sqrt(variance),
            "baseline": baseline, "n_out": len(groups[0]), "n_in": len(groups[1])}

def mask_sensitivity(flux, sigma, phase, half_widths):
    if len(flux) != len(phase) or any(not math.isfinite(p) for p in phase):
        raise ValueError("invalid phase")
    results = []
    for width in half_widths:
        if not math.isfinite(width) or width <= 0:
            raise ValueError("positive finite width required")
        results.append({"half_width": width, **fit_depth(
            flux, sigma, [abs(p) <= width for p in phase])})
    return results
