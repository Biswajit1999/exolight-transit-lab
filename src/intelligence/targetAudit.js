import { calculateTargetAuditScore } from "./auditScore.js";
import { generateResearchHints } from "./researchHints.js";

function safeValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : value ?? null;
}

export function buildTargetAudit({ target, params, metrics, archivalCurve }) {
  const audit = calculateTargetAuditScore({
    target,
    params,
    metrics,
    archivalCurve
  });

  const hints = generateResearchHints({
    target,
    params,
    metrics,
    archivalCurve,
    audit
  });

  return {
    generatedUtc: new Date().toISOString(),
    targetName: target?.pl_name ?? "Unknown target",
    hostName: target?.hostname ?? "Unknown host",
    audit,
    hints,
    state: {
      catalogue: {
        periodDays: safeValue(target?.pl_orbper),
        depthPpm: safeValue(target?.pl_trandep),
        radiusRatio: safeValue(target?.pl_ratror),
        semiMajorAxisAU: safeValue(target?.pl_orbsmax),
        inclinationDeg: safeValue(target?.pl_orbincl),
        eccentricity: safeValue(target?.pl_orbeccen),
        stellarRadiusSolar: safeValue(target?.st_rad),
        stellarMassSolar: safeValue(target?.st_mass),
        lightcurveAvailable: Boolean(target?.lightcurve_available),
        lightcurveFile: target?.lightcurve_file ?? ""
      },
      model: {
        radiusRatio: safeValue(params?.rpRs),
        scaledSemiMajorAxis: safeValue(params?.aRs),
        inclinationDeg: safeValue(params?.inclinationDeg),
        eccentricity: safeValue(params?.eccentricity),
        limbDarkening: [safeValue(params?.u1), safeValue(params?.u2)],
        exposureIntegration: Boolean(params?.exposureIntegration),
        exposureSamples: safeValue(params?.exposureSamples),
        starspotEnabled: Boolean(params?.spotEnabled),
        exomoonEnabled: Boolean(params?.moonEnabled)
      },
      metrics: {
        modelDepthPpm: safeValue(metrics?.modelDepthPpm),
        residualRmsPpm: safeValue(metrics?.residualRmsPpm),
        ootRmsPpm: safeValue(metrics?.ootRmsPpm),
        depthContrast: safeValue(metrics?.snr)
      }
    }
  };
}

export function auditToMarkdown(audit) {
  const lines = [];

  lines.push(`# ExoLight Target Audit — ${audit.targetName}`);
  lines.push("");
  lines.push(`Host star: ${audit.hostName}`);
  lines.push(`Generated UTC: ${audit.generatedUtc}`);
  lines.push("");
  lines.push("## Mission Control Score");
  lines.push("");
  lines.push(`Score: ${audit.audit.total}/100`);
  lines.push(`Rating: ${audit.audit.rating}`);
  lines.push("");
  lines.push("## Research next steps");
  lines.push("");

  for (const hint of audit.hints) {
    lines.push(`- **${hint.title}** (${hint.level}): ${hint.text}`);
  }

  lines.push("");
  lines.push("## Audit checks");
  lines.push("");
  for (const check of audit.audit.checks) {
    lines.push(`- ${check.label}: ${check.detail} (${check.score} points)`);
  }

  lines.push("");
  lines.push("## Catalogue state");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(audit.state.catalogue, null, 2));
  lines.push("```");

  lines.push("");
  lines.push("## Model state");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(audit.state.model, null, 2));
  lines.push("```");

  lines.push("");
  lines.push("## Metrics");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(audit.state.metrics, null, 2));
  lines.push("```");

  lines.push("");
  lines.push("> ExoLight is an exploratory visual and educational toolkit. This audit is not a detection claim or formal inference result.");

  return lines.join("\n");
}
