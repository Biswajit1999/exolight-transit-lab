const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;
const R_SUN_AU = 0.00465047;
const R_EARTH_R_SUN = 0.0091577;
const M_EARTH_M_SUN = 0.0000030034896;

export function createDefaultParams() {
  return {
    rpRs: 0.1,
    aRs: 12,
    inclinationDeg: 88.5,
    periodDays: 4,
    eccentricity: 0,
    u1: 0.32,
    u2: 0.28,
    moonEnabled: false,
    moonRadius: 0.025,
    moonDistance: 0.55,
    moonPhaseDeg: 45,
    moonInclinationDeg: 12,
    moonNodeDeg: 35,
    moonAngularRate: 8,
    spotEnabled: false,
    spotX: 0.2,
    spotY: 0.1,
    spotRadius: 0.12,
    spotContrast: 0.55,
    ttvEnabled: false,
    ttvAmplitude: 0.01,
    ttvPeriodEpochs: 16
  };
}

export function mergeTargetIntoParams(params, target) {
  if (!target) return { ...params };
  const rpRs = finite(target.pl_ratror) ? clamp(target.pl_ratror, 0.005, 0.28) : params.rpRs;
  const aRs = finite(target.a_rs) ? clamp(target.a_rs, 1.5, 80) : inferARs(target.pl_orbsmax, target.st_rad) ?? params.aRs;
  const inclinationDeg = finite(target.pl_orbincl) ? clamp(target.pl_orbincl, 70, 90) : params.inclinationDeg;
  const periodDays = finite(target.pl_orbper) ? clamp(target.pl_orbper, 0.1, 500) : params.periodDays;
  const eccentricity = finite(target.pl_orbeccen) ? clamp(target.pl_orbeccen, 0, 0.95) : params.eccentricity;
  const limb = estimateLimbDarkening(target.st_teff);
  return {
    ...params,
    rpRs,
    aRs,
    inclinationDeg,
    periodDays,
    eccentricity,
    u1: limb.u1,
    u2: limb.u2
  };
}

export function deriveDossier(target, params) {
  const p = params || createDefaultParams();
  const teff = finite(target?.st_teff) ? target.st_teff : null;
  const stRad = finite(target?.st_rad) ? target.st_rad : null;
  const stMass = finite(target?.st_mass) ? target.st_mass : null;
  const plMassEarth = finite(target?.pl_bmasse) ? target.pl_bmasse : null;
  const semiMajor = finite(target?.pl_orbsmax) ? target.pl_orbsmax : stRad ? p.aRs * stRad * R_SUN_AU : null;
  const aRs = finite(target?.a_rs) ? target.a_rs : p.aRs;
  const rpRs = finite(target?.pl_ratror) ? target.pl_ratror : p.rpRs;
  const periodDays = finite(target?.pl_orbper) ? target.pl_orbper : p.periodDays;
  const inclinationDeg = finite(target?.pl_orbincl) ? target.pl_orbincl : p.inclinationDeg;
  const eccentricity = finite(target?.pl_orbeccen) ? target.pl_orbeccen : p.eccentricity;
  const transitProbability = estimateTransitProbability(aRs, rpRs, eccentricity);
  const ingressMinutes = estimateIngressMinutes(periodDays, aRs, rpRs, inclinationDeg);
  const hzIndex = estimateHZIndex(teff, stRad, semiMajor);
  const mpMs = plMassEarth && stMass ? plMassEarth * M_EARTH_M_SUN / stMass : null;

  return {
    planet: target?.pl_name || "Manual System",
    host: target?.hostname || "Synthetic Host",
    stellarClass: classifyStar(teff),
    teff,
    aRs,
    rpRs,
    mpMs,
    hzIndex,
    transitProbability,
    ingressMinutes,
    quality: target ? "TARGET LOCK" : "SYNTHETIC"
  };
}

export class TransitPhysicsEngine {
  constructor(options = {}) {
    this.rings = Math.max(4, Math.trunc(options.rings || 82));
    this.azimuth = Math.max(8, Math.trunc(options.azimuth || 150));
    this.samples = this.buildPolarGrid(this.rings, this.azimuth);
    this.lastIntensityNorm = null;
    this.lastIntensityKey = "";
  }

  buildPolarGrid(rings, azimuth) {
    const samples = [];
    for (let i = 0; i < rings; i++) {
      const r0 = i / rings;
      const r1 = (i + 1) / rings;
      const r = Math.sqrt((r0 * r0 + r1 * r1) * 0.5);
      const area = Math.PI * (r1 * r1 - r0 * r0) / azimuth;
      const offset = (i % 2) * 0.5;
      for (let j = 0; j < azimuth; j++) {
        const theta = TWO_PI * ((j + offset) / azimuth);
        const x = r * Math.cos(theta);
        const y = r * Math.sin(theta);
        const mu = Math.sqrt(Math.max(0, 1 - r * r));
        samples.push({ x, y, r, mu, area });
      }
    }
    return samples;
  }

  quadraticIntensity(mu, u1, u2) {
    const q = 1 - mu;
    return Math.max(0, 1 - u1 * q - u2 * q * q);
  }

  stellarIntensityAt(sample, params) {
    const base = this.quadraticIntensity(sample.mu, params.u1, params.u2);
    if (!params.spotEnabled) return base;

    const dx = sample.x - params.spotX;
    const dy = sample.y - params.spotY;
    const d = Math.sqrt(dx * dx + dy * dy);

    if (d > params.spotRadius) return base;

    const taper = 0.5 + 0.5 * Math.cos(Math.PI * clamp(d / params.spotRadius, 0, 1));
    const contrast = clamp(params.spotContrast, 0.02, 1);
    return base * (1 - taper * (1 - contrast));
  }

  computeIntensityNorm(params) {
    const key = `${params.u1.toFixed(5)}|${params.u2.toFixed(5)}|${params.spotEnabled}|${params.spotX.toFixed(4)}|${params.spotY.toFixed(4)}|${params.spotRadius.toFixed(4)}|${params.spotContrast.toFixed(4)}`;
    if (key === this.lastIntensityKey && finite(this.lastIntensityNorm)) return this.lastIntensityNorm;

    let total = 0;
    for (const sample of this.samples) {
      total += this.stellarIntensityAt(sample, params) * sample.area;
    }

    this.lastIntensityKey = key;
    this.lastIntensityNorm = total > 0 ? total : 1;
    return this.lastIntensityNorm;
  }

  applyTTV(phase, params, epoch = 0) {
    if (!params.ttvEnabled) return phase;
    const period = Math.max(1, params.ttvPeriodEpochs || 1);
    const shift = params.ttvAmplitude * Math.sin(TWO_PI * epoch / period);
    return phase - shift;
  }

  computeImpactParameter(params) {
    const i = clamp(params.inclinationDeg, 0, 90) * DEG;
    return Math.abs(params.aRs * Math.cos(i) * (1 - params.eccentricity * params.eccentricity) / Math.max(0.05, 1 + params.eccentricity));
  }

  computePlanetState(phase, params) {
    const theta = TWO_PI * phase;
    const inc = params.inclinationDeg * DEG;
    const e = clamp(params.eccentricity || 0, 0, 0.95);
    const r = params.aRs * (1 - e * e) / Math.max(0.05, 1 + e * Math.cos(theta));
    return {
      x: r * Math.sin(theta),
      y: -r * Math.cos(theta) * Math.cos(inc),
      z: r * Math.cos(theta) * Math.sin(inc),
      radius: params.rpRs,
      front: r * Math.cos(theta) * Math.sin(inc) > 0
    };
  }

  computeMoonState(phase, params) {
    if (!params.moonEnabled) {
      return {
        enabled: false,
        x: 0,
        y: 0,
        z: -1,
        radius: 0,
        front: false,
        label: "DISABLED",
        vector: [0, 0, 0]
      };
    }

    const planet = this.computePlanetState(phase, params);
    const moonPhase = (params.moonPhaseDeg * DEG) + TWO_PI * phase * (params.moonAngularRate || 8);
    const node = params.moonNodeDeg * DEG;
    const inc = params.moonInclinationDeg * DEG;
    const d = params.moonDistance;

    const local = [
      d * Math.cos(moonPhase),
      d * Math.sin(moonPhase),
      0
    ];

    const tilted = rotateX(local, inc);
    const rotated = rotateZ(tilted, node);
    const x = planet.x + rotated[0];
    const y = planet.y + rotated[1];
    const z = planet.z + rotated[2];

    return {
      enabled: true,
      x,
      y,
      z,
      radius: params.moonRadius,
      front: z > 0,
      label: z >= planet.z ? "FRONT ARC" : "BACK ARC",
      vector: rotated,
      planet
    };
  }

  evaluateAtPhase(phase, params, epoch = 0) {
    const shiftedPhase = this.applyTTV(phase, params, epoch);
    const planet = this.computePlanetState(shiftedPhase, params);
    const moon = this.computeMoonState(shiftedPhase, params);
    const norm = this.computeIntensityNorm(params);

    let visibleFlux = 0;
    let occultedFlux = 0;
    let spotBoostFlux = 0;
    const planetR2 = planet.radius * planet.radius;
    const moonR2 = moon.radius * moon.radius;

    for (const sample of this.samples) {
      const intensity = this.stellarIntensityAt(sample, params);
      const weighted = intensity * sample.area;

      let occulted = false;
      let byPlanet = false;

      if (planet.front) {
        const dxp = sample.x - planet.x;
        const dyp = sample.y - planet.y;
        if (dxp * dxp + dyp * dyp <= planetR2) {
          occulted = true;
          byPlanet = true;
        }
      }

      if (!occulted && moon.enabled && moon.front) {
        const dxm = sample.x - moon.x;
        const dym = sample.y - moon.y;
        if (dxm * dxm + dym * dym <= moonR2) {
          occulted = true;
        }
      }

      if (occulted) {
        occultedFlux += weighted;
        if (byPlanet && params.spotEnabled) {
          const dxs = sample.x - params.spotX;
          const dys = sample.y - params.spotY;
          if (dxs * dxs + dys * dys <= params.spotRadius * params.spotRadius) {
            const unspotted = this.quadraticIntensity(sample.mu, params.u1, params.u2) * sample.area;
            spotBoostFlux += Math.max(0, unspotted - weighted);
          }
        }
      } else {
        visibleFlux += weighted;
      }
    }

    const flux = clamp(visibleFlux / norm, 0, 1.05);
    const depth = Math.max(0, 1 - flux);

    return {
      phase: shiftedPhase,
      flux,
      depth,
      depthPpm: depth * 1e6,
      occultedFlux,
      spotBoostFlux,
      planet,
      moon,
      impact: this.computeImpactParameter(params)
    };
  }

  generateLightCurve({ params, phaseMin = -0.08, phaseMax = 0.08, points = 241, epoch = 0 }) {
    const n = Math.max(2, Math.trunc(points));
    const out = [];
    for (let i = 0; i < n; i++) {
      const phase = phaseMin + (phaseMax - phaseMin) * i / (n - 1);
      out.push(this.evaluateAtPhase(phase, params, epoch));
    }
    return out;
  }

  summarizeCurve(curve) {
    if (!Array.isArray(curve) || !curve.length) {
      return {
        minFlux: 1,
        maxDepth: 0,
        depthPpm: 0,
        phaseAtMin: 0,
        durationPhase: 0,
        points: 0
      };
    }

    let minFlux = Infinity;
    let maxDepth = -Infinity;
    let phaseAtMin = 0;
    let firstTransit = null;
    let lastTransit = null;

    for (const point of curve) {
      if (point.flux < minFlux) {
        minFlux = point.flux;
        phaseAtMin = point.phase;
      }
      if (point.depth > maxDepth) maxDepth = point.depth;
      if (point.depth > 1e-6) {
        if (firstTransit === null) firstTransit = point.phase;
        lastTransit = point.phase;
      }
    }

    return {
      minFlux,
      maxDepth: Math.max(0, maxDepth),
      depthPpm: Math.max(0, maxDepth) * 1e6,
      phaseAtMin,
      durationPhase: firstTransit === null || lastTransit === null ? 0 : Math.abs(lastTransit - firstTransit),
      points: curve.length
    };
  }
}

function estimateLimbDarkening(teff) {
  if (!finite(teff)) return { u1: 0.32, u2: 0.28 };
  if (teff < 3300) return { u1: 0.46, u2: 0.24 };
  if (teff < 4300) return { u1: 0.42, u2: 0.26 };
  if (teff < 5600) return { u1: 0.36, u2: 0.28 };
  if (teff < 7000) return { u1: 0.30, u2: 0.30 };
  if (teff < 9000) return { u1: 0.22, u2: 0.25 };
  return { u1: 0.16, u2: 0.20 };
}

function classifyStar(teff) {
  if (!finite(teff)) return "Unknown";
  if (teff >= 30000) return "O-type";
  if (teff >= 10000) return "B-type";
  if (teff >= 7500) return "A-type";
  if (teff >= 6000) return "F-type";
  if (teff >= 5200) return "G-type";
  if (teff >= 3700) return "K-type";
  if (teff >= 2400) return "M-type";
  return "Ultracool dwarf";
}

function estimateTransitProbability(aRs, rpRs, eccentricity = 0) {
  if (!finite(aRs) || aRs <= 0) return null;
  const eFactor = 1 / Math.max(0.05, 1 - eccentricity * eccentricity);
  return clamp(((1 + Math.max(0, rpRs || 0)) / aRs) * eFactor * 100, 0, 100);
}

function estimateIngressMinutes(periodDays, aRs, rpRs, inclinationDeg) {
  if (!finite(periodDays) || !finite(aRs) || !finite(rpRs) || !finite(inclinationDeg) || aRs <= 0 || rpRs <= 0) return null;
  const i = inclinationDeg * DEG;
  const b = Math.abs(aRs * Math.cos(i));
  const root = Math.sqrt(Math.max(0, (1 + rpRs) * (1 + rpRs) - b * b));
  const fullRoot = Math.sqrt(Math.max(0, (1 - rpRs) * (1 - rpRs) - b * b));
  const totalHours = periodDays * 24 / Math.PI * Math.asin(clamp(root / Math.max(1e-6, aRs * Math.sin(i)), 0, 1));
  const fullHours = periodDays * 24 / Math.PI * Math.asin(clamp(fullRoot / Math.max(1e-6, aRs * Math.sin(i)), 0, 1));
  return Math.max(0, (totalHours - fullHours) * 30);
}

function estimateHZIndex(teff, stRad, semiMajorAu) {
  if (!finite(teff) || !finite(stRad) || !finite(semiMajorAu) || semiMajorAu <= 0) return null;
  const luminosity = stRad * stRad * Math.pow(teff / 5772, 4);
  const earthEquivalentDistance = Math.sqrt(Math.max(0, luminosity));
  const ratio = semiMajorAu / Math.max(1e-6, earthEquivalentDistance);
  return Math.exp(-Math.abs(Math.log(Math.max(1e-6, ratio))) / 0.65);
}

function inferARs(aAu, stRadSolar) {
  if (!finite(aAu) || !finite(stRadSolar) || stRadSolar <= 0) return null;
  return aAu / (stRadSolar * R_SUN_AU);
}

function rotateX(v, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}

function rotateZ(v, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
}

function finite(value) {
  return Number.isFinite(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export const PHYSICS_CONSTANTS = {
  DEG,
  TWO_PI,
  R_SUN_AU,
  R_EARTH_R_SUN,
  M_EARTH_M_SUN
};
