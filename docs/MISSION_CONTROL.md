# ExoLight Mission Control

Mission Control is the Phase III audit layer for ExoLight Transit Lab. It turns the live transit dashboard into a research cockpit by combining catalogue fields, current model state, worker diagnostics, hypothesis flags, and exportable target notes.

## Purpose

The panel is designed to answer five questions for every selected target:

1. Which values come from the catalogue?
2. Which values are currently being used by the live model?
3. Is the catalogue/model comparison internally reasonable?
4. Are starspot or exomoon modes enabled as hypotheses?
5. What should a researcher inspect next?

Mission Control is an exploratory audit layer. It does not claim a detection, a posterior fit, or a validated astrophysical interpretation.

## New modules

```text
src/intelligence/auditScore.js
src/intelligence/researchHints.js
src/intelligence/targetAudit.js
src/ui/missionControl.js
src/ui/missionControl.css
src/missionControlRuntime.js
```

## Runtime design

The public site remains zero-dependency and GitHub Pages friendly.

- `missionControlRuntime.js` mounts the panel into the existing dashboard.
- `missionControl.js` renders the cockpit card and export button.
- `targetAudit.js` builds a structured target audit object.
- `auditScore.js` calculates the catalogue/model readiness score.
- `researchHints.js` generates concrete next-step research guidance.

The worker solver is not modified by this upgrade. Mission Control reads the live page state, current controls, selected target, local catalogue cache, and visible diagnostics.

## Score interpretation

```text
90-100  Strong catalogue/model agreement
70-89   Usable with cautions
40-69   Educational / exploratory quality
0-39    Poorly constrained
```

The score is not a discovery score. It is a readiness and consistency score based on fields such as period availability, radius ratio, stellar parameters, local light-curve state, baseline-vs-hypothesis mode, and catalogue/model depth agreement.

## Exported audit

The `Export target audit` button downloads a Markdown note containing:

- target name and host star;
- Mission Control score;
- research next steps;
- catalogue state;
- model state;
- current metrics;
- caution that the audit is exploratory only.

This creates a reproducible note for teaching, GitHub documentation, and follow-up analysis.

## Scientific boundaries

Mission Control deliberately uses conservative wording:

- starspot mode is labelled as a hypothesis;
- exomoon mode is labelled as a hypothesis;
- high residual scatter triggers a caution;
- catalogue/model mismatches are treated as audit prompts, not conclusions;
- model-only targets are clearly separated from targets with local photometry.
