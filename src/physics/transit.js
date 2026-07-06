import { R_EARTH, R_SUN } from "./constants.js";
import { clamp, projectedOrbit } from "./orbit.js";

function requirePositiveFinite(value, label) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new RangeError(`${label} must be a positive finite number.`);
  }
  return numeric;
}

export function radiusRatio(planetRadiusEarth, stellarRadiusSolar) {
  const rpMetres = requirePositiveFinite(planetRadiusEarth, "planetRadiusEarth") * R_EARTH;
  const rStarMetres = requirePositiveFinite(stellarRadiusSolar, "stellarRadiusSolar") * R_SUN;
  return rpMetres / rStarMetres;
}

export function transitDepthPpm(rpRs) {
  const ratio = requirePositiveFinite(rpRs, "rpRs");
  return ratio * ratio * 1e6;
}

export function radiusRatioFromDepthPpm(depthPpm) {
  return Math.sqrt(requirePositiveFinite(depthPpm, "depthPpm") / 1e6);
}

export function transitDurationHours(periodDays, stellarRadiusSolar, semiMajorAxisAU, impactParameter = 0) {
  const periodHoursValue = requirePositiveFinite(periodDays, "periodDays") * 24;
  const rStarAU = requirePositiveFinite(stellarRadiusSolar, "stellarRadiusSolar") * R_SUN / 1.495978707e11;
  const aAU = requirePositiveFinite(semiMajorAxisAU, "semiMajorAxisAU");
  const b = Math.abs(Number(impactParameter) || 0);
  const chord = Math.sqrt(Math.max(0, 1 - b * b));
  const argument = clamp((rStarAU / aAU) * chord, 0, 1);
  return (periodHoursValue / Math.PI) * Math.asin(argument);
}

export function targetToObservableSummary(target) {
  const periodDays = Number(target?.pl_orbper);
  const depthPpm = Number(target?.pl_trandep);
  const ratio = Number.isFinite(Number(target?.pl_ratror)) && Number(target.pl_ratror) > 0
    ? Number(target.pl_ratror)
    : Number.isFinite(depthPpm) && depthPpm > 0
      ? radiusRatioFromDepthPpm(depthPpm)
      : null;
  return {
    periodDays: Number.isFinite(periodDays) ? periodDays : null,
    depthPpm: Number.isFinite(depthPpm) ? depthPpm : ratio ? transitDepthPpm(ratio) : null,
    radiusRatio: ratio
  };
}

function makeGrid(R = 80, A = 144) {
  const pts = [];
  for (let ir = 0; ir < R; ir++) {
    const r0 = ir / R;
    const r1 = (ir + 1) / R;
    const r = Math.sqrt((r0 * r0 + r1 * r1) / 2);
    const area = Math.PI * (r1 * r1 - r0 * r0) / A;
    for (let ia = 0; ia < A; ia++) {
      const th = ia / A * Math.PI * 2;
      pts.push({ x: r * Math.cos(th), y: r * Math.sin(th), r, area });
    }
  }
  return pts;
}

const GRID = makeGrid();

export function nonLinearLD(r, c) {
  const mu = Math.sqrt(Math.max(0, 1 - r * r));
  return Math.max(0, 1 - c[0] * (1 - Math.sqrt(mu)) - c[1] * (1 - mu) - c[2] * (1 - Math.pow(mu, 1.5)) - c[3] * (1 - mu * mu));
}

export function fluxAt(params, phase) {
  const p = projectedOrbit({ ...params, phase });
  const c = params.limb;
  let total = 0;
  let visible = 0;
  const occ = [{ x: p.x, y: p.y, r: params.rpRs }];
  if (params.moon) {
    const a = phase * Math.PI * 4;
    occ.push({ x: p.x + Math.cos(a) * params.rpRs * 5, y: p.y + Math.sin(a) * params.rpRs * 1.5, r: params.rpRs * 0.27 });
  }
  for (const pt of GRID) {
    let intensity = nonLinearLD(pt.r, c);
    if (params.spot) {
      const d = Math.hypot(pt.x + 0.22, pt.y - 0.16);
      if (d < 0.18) intensity *= 0.55 + 0.45 * (d / 0.18);
    }
    const weight = intensity * pt.area;
    total += weight;
    let block = false;
    for (const o of occ) {
      const dx = pt.x - o.x;
      const dy = pt.y - o.y;
      if (dx * dx + dy * dy <= o.r * o.r) {
        block = true;
        break;
      }
    }
    visible += block ? 0 : weight;
  }
  return clamp(visible / Math.max(1e-9, total), 0, 1);
}

export function makeLightCurve(params, N = 900) {
  const arr = [];
  for (let i = 0; i < N; i++) {
    const phase = i / (N - 1);
    const model = fluxAt(params, phase);
    const u = Math.sin(i * 12.9898) * 43758.5453;
    const noise = (u - Math.floor(u) - 0.5) * params.noisePpm / 1e6;
    arr.push({ phase, model, observed: model + noise, residual: noise });
  }
  return arr;
}
