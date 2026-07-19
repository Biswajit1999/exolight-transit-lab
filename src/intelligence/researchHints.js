function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function depthMismatch(target, metrics) {
  const catalogueDepth = finite(target?.pl_trandep);
  const modelDepth = finite(metrics?.modelDepthPpm);

  if (catalogueDepth === null || modelDepth === null || catalogueDepth <= 0) return null;
  return Math.abs(modelDepth - catalogueDepth) / catalogueDepth;
}

export function generateResearchHints({ target, params, metrics, archivalCurve, audit }) {
  const hints = [];
  const mismatch = depthMismatch(target, metrics);

  if (mismatch !== null && mismatch > 0.10) {
    hints.push({
      level: "warning",
      title: "Depth mismatch",
      text: "Catalogue depth and current model depth differ by more than 10%. Check passband, literature source, dilution, and radius-ratio assumptions before interpreting the curve."
    });
  }

  if (!target?.lightcurve_available && !Number(archivalCurve?.points)) {
    hints.push({
      level: "info",
      title: "Model-only target",
      text: "No local light curve is available for this target. Add a TESS, Kepler, K2, or ground-based JSON light curve before using it for data-driven interpretation."
    });
  }

  if (params?.spotEnabled) {
    hints.push({
      level: "caution",
      title: "Starspot hypothesis active",
      text: "Treat the spot feature as a controlled morphology experiment, not evidence for a physical spot unless repeated transits show phase-consistent anomalies."
    });
  }

  if (params?.moonEnabled) {
    hints.push({
      level: "caution",
      title: "Exomoon hypothesis active",
      text: "Moon-like structure requires repeated events, dynamical consistency, and formal model comparison before any physical claim."
    });
  }

  if (finite(target?.st_rad) === null || finite(target?.st_mass) === null) {
    hints.push({
      level: "info",
      title: "Incomplete stellar context",
      text: "Stellar radius and mass affect physical interpretation. Check composite catalogue values before using this target for quantitative work."
    });
  }

  if (finite(metrics?.residualRmsPpm) !== null && finite(metrics?.modelDepthPpm) !== null) {
    const ratio = metrics.residualRmsPpm / Math.max(metrics.modelDepthPpm, 1);
    if (ratio > 0.25) {
      hints.push({
        level: "warning",
        title: "High residual scatter",
        text: "Residual RMS is large relative to transit depth. Inspect detrending, phase alignment, outliers, and ingress/egress structure."
      });
    }
  }

  if (audit?.total >= 90 && hints.length < 2) {
    hints.push({
      level: "good",
      title: "Strong first-pass target",
      text: "Catalogue fields, local photometry state, and model diagnostics are suitable for a clean first-pass exploratory audit."
    });
  }

  if (!hints.length) {
    hints.push({
      level: "good",
      title: "Ready for visual audit",
      text: "The selected target has enough information for an exploratory visual-model comparison. Next, inspect residual behaviour around ingress and egress."
    });
  }

  return hints.slice(0, 4);
}
