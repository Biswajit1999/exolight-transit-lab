const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;
const R_SUN_AU = 0.00465047;
const R_EARTH_R_SUN = 0.0091577;
const M_EARTH_M_SUN = 0.0000030034896;

export function orbitPhaseToTransitPhase(orbitPhase) {
  const phase = wrap01(orbitPhase);
  return phase > 0.5 ? phase - 1.0 : phase;
}

export function transitPhaseToOrbitPhase(transitPhase) {
  return wrap01(transitPhase);
}

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
    spotX: 0.18,
    spotY: 0.08,
    spotRadius: 0.09,
    spotContrast: 0.78,

    ttvEnabled: false,
    ttvAmplitude: 0.01,
    ttvPeriodEpochs: 16
  };
}

export function mergeTargetIntoParams(params, target) {
  if (!target) return { ...params };

  const limb = estimateQuadraticLimbDarkening(target.st_teff);
  const inferredARs = inferARs(target.pl_orbsmax, target.st_rad);

  return {
    ...params,
    rpRs: finite(target.pl_ratror)
      ? clamp(target.pl_ratror, 0.005, 0.28)
      : params.rpRs,

    aRs: finite(target.a_rs)
      ? clamp(target.a_rs, 1.5, 80)
      : finite(inferredARs)
        ? clamp(inferredARs, 1.5, 80)
        : params.aRs,

    inclinationDeg: finite(target.pl_orbincl)
      ? clamp(target.pl_orbincl, 70, 90)
      : params.inclinationDeg,

    periodDays: finite(target.pl_orbper)
      ? clamp(target.pl_orbper, 0.1, 500)
      : params.periodDays,

    eccentricity: finite(target.pl_orbeccen)
      ? clamp(target.pl_orbeccen, 0, 0.95)
      : params.eccentricity,

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

  const aRs = finite(target?.a_rs)
    ? target.a_rs
    : finite(p.aRs)
      ? p.aRs
      : null;

  const rpRs = finite(target?.pl_ratror)
    ? target.pl_ratror
    : finite(p.rpRs)
      ? p.rpRs
      : null;

  const periodDays = finite(target?.pl_orbper)
    ? target.pl_orbper
    : finite(p.periodDays)
      ? p.periodDays
      : null;

  const inclinationDeg = finite(target?.pl_orbincl)
    ? target.pl_orbincl
    : finite(p.inclinationDeg)
      ? p.inclinationDeg
      : null;

  const eccentricity = finite(target?.pl_orbeccen)
    ? target.pl_orbeccen
    : finite(p.eccentricity)
      ? p.eccentricity
      : 0;

  const semiMajor = finite(target?.pl_orbsmax)
    ? target.pl_orbsmax
    : finite(stRad) && finite(aRs)
      ? aRs * stRad * R_SUN_AU
      : null;

  return {
    planet: target?.pl_name || "Manual System",
    host: target?.hostname || "Synthetic Host",
    stellarClass: classifyStar(teff),
    teff,
    aRs,
    rpRs,
    mpMs: finite(plMassEarth) && finite(stMass) && stMass > 0
      ? plMassEarth * M_EARTH_M_SUN / stMass
      : null,
    hzIndex: estimateHZIndex(teff, stRad, semiMajor),
    transitProbability: estimateTransitProbability(aRs, rpRs, eccentricity),
    ingressMinutes: estimateIngressMinutes(periodDays, aRs, rpRs, inclinationDeg),
    quality: target ? "TARGET LOCK" : "SYNTHETIC"
  };
}

export class TransitPhysicsEngine {
  constructor(options = {}) {
    this.rings = Math.max(10, Math.trunc(options.rings || 82));
    this.azimuth = Math.max(24, Math.trunc(options.azimuth || 150));
    this.samples = this.buildPolarGrid(this.rings, this.azimuth);

    this.lastIntensityKey = "";
    this.lastIntensityNorm = 1;

    this.lastSpotKey = "";
    this.lastSpotComponents = [];
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

        samples.push({
          x,
          y,
          r,
          mu,
          area
        });
      }
    }

    return samples;
  }

  quadraticIntensity(mu, u1, u2) {
    const safeMu = clamp(mu, 0, 1);
    const q = 1 - safeMu;
    return Math.max(0, 1 - u1 * q - u2 * q * q);
  }

  getEpochPhaseShift(params, epoch = 0) {
    if (!params?.ttvEnabled) return 0;

    const period = Math.max(1, Number(params.ttvPeriodEpochs) || 1);
    const amplitude = Number(params.ttvAmplitude) || 0;

    return amplitude * Math.sin(TWO_PI * epoch / period);
  }

  applyTTV(phase, params, epoch = 0) {
    return phase - this.getEpochPhaseShift(params, epoch);
  }

  computeImpactParameter(params) {
    const i = clamp(params.inclinationDeg, 0, 90) * DEG;
    const e = clamp(params.eccentricity || 0, 0, 0.95);
    const denom = Math.max(0.05, 1 + e);
    return Math.abs(params.aRs * Math.cos(i) * (1 - e * e) / denom);
  }

  getSpotComponents(params) {
    if (!params?.spotEnabled) return [];

    const key = [
      params.spotEnabled ? 1 : 0,
      fmtKey(params.spotX, 5),
      fmtKey(params.spotY, 5),
      fmtKey(params.spotRadius, 5),
      fmtKey(params.spotContrast, 5)
    ].join("|");

    if (key === this.lastSpotKey) {
      return this.lastSpotComponents;
    }

    const baseX = clamp(params.spotX ?? 0.18, -0.90, 0.90);
    const baseY = clamp(params.spotY ?? 0.08, -0.90, 0.90);
    const radius = clamp(params.spotRadius ?? 0.09, 0.02, 0.24);
    const contrast = clamp(params.spotContrast ?? 0.78, 0.05, 0.97);

    const seed = stableHash([
      fmtKey(baseX, 5),
      fmtKey(baseY, 5),
      fmtKey(radius, 5),
      fmtKey(contrast, 5)
    ].join("|"));

    const rand = mulberry32(seed);
    const axisAngle = rand() * TWO_PI;

    const penumbraOpacity = clamp(0.26 + 0.28 * contrast, 0.18, 0.62);
    const umbraOpacity = clamp(0.48 + 0.42 * contrast, 0.30, 0.92);

    const components = [
      {
        x: baseX,
        y: baseY,
        rx: radius * 1.22,
        ry: radius * 0.82,
        angle: axisAngle,
        opacity: penumbraOpacity,
        kind: "penumbra",
        lift: 0.010
      },
      {
        x: clamp(baseX + radius * 0.10, -0.96, 0.96),
        y: clamp(baseY - radius * 0.04, -0.96, 0.96),
        rx: radius * 0.68,
        ry: radius * 0.46,
        angle: axisAngle + 0.35,
        opacity: umbraOpacity,
        kind: "umbra",
        lift: 0.016
      }
    ];

    for (let i = 0; i < 9; i++) {
      const a = rand() * TWO_PI;
      const d = radius * (0.10 + 0.72 * rand());
      const dx = Math.cos(a) * d * (0.68 + 0.16 * rand());
      const dy = Math.sin(a) * d * (0.45 + 0.18 * rand());
      const isUmbra = i % 4 === 0;

      components.push({
        x: clamp(baseX + dx, -0.96, 0.96),
        y: clamp(baseY + dy, -0.96, 0.96),
        rx: radius * (0.10 + 0.18 * rand()),
        ry: radius * (0.05 + 0.13 * rand()),
        angle: rand() * TWO_PI,
        opacity: isUmbra
          ? clamp(0.34 + 0.38 * contrast * rand(), 0.18, 0.86)
          : clamp(0.12 + 0.22 * contrast * rand(), 0.08, 0.44),
        kind: isUmbra ? "umbra" : "penumbra-fragment",
        lift: 0.018 + i * 0.0015
      });
    }

    this.lastSpotKey = key;
    this.lastSpotComponents = components.filter(component =>
      component.x * component.x + component.y * component.y < 0.985 * 0.985
    );

    return this.lastSpotComponents;
  }

  ellipseWeight(x, y, component) {
    const ca = Math.cos(component.angle || 0);
    const sa = Math.sin(component.angle || 0);

    const dx = x - component.x;
    const dy = y - component.y;

    const xp = dx * ca + dy * sa;
    const yp = -dx * sa + dy * ca;

    const rx2 = Math.max(1e-10, component.rx * component.rx);
    const ry2 = Math.max(1e-10, component.ry * component.ry);

    const rr = (xp * xp) / rx2 + (yp * yp) / ry2;

    if (rr >= 1) return 0;

    const t = Math.sqrt(rr);

    return 0.5 + 0.5 * Math.cos(Math.PI * t);
  }

  spotTransmissionAt(x, y, params) {
    if (!params?.spotEnabled) {
      return {
        ratio: 1,
        coverage: 0,
        darkening: 0
      };
    }

    let darkening = 0;
    let coverage = 0;

    for (const component of this.getSpotComponents(params)) {
      const weight = this.ellipseWeight(x, y, component);
      if (weight <= 0) continue;

      coverage = Math.max(coverage, weight);
      darkening += component.opacity * weight * (1 - darkening);
    }

    return {
      ratio: clamp(1 - darkening, 0.04, 1),
      coverage,
      darkening
    };
  }

  stellarIntensityAt(sample, params) {
    const unspotted = this.quadraticIntensity(sample.mu, params.u1, params.u2);
    const spot = this.spotTransmissionAt(sample.x, sample.y, params);

    return {
      intensity: unspotted * spot.ratio,
      unspotted,
      spotCoverage: spot.coverage,
      spotRatio: spot.ratio,
      spotDarkening: spot.darkening
    };
  }

  computeIntensityNorm(params) {
    const key = [
      fmtKey(params.u1, 6),
      fmtKey(params.u2, 6),
      params.spotEnabled ? 1 : 0,
      fmtKey(params.spotX, 5),
      fmtKey(params.spotY, 5),
      fmtKey(params.spotRadius, 5),
      fmtKey(params.spotContrast, 5)
    ].join("|");

    if (key === this.lastIntensityKey && finite(this.lastIntensityNorm)) {
      return this.lastIntensityNorm;
    }

    let total = 0;

    for (const sample of this.samples) {
      const radiance = this.stellarIntensityAt(sample, params);
      total += radiance.intensity * sample.area;
    }

    this.lastIntensityKey = key;
    this.lastIntensityNorm = total > 0 ? total : 1;

    return this.lastIntensityNorm;
  }

  computePlanetState(orbitPhase, params) {
    const phase = wrap01(orbitPhase);
    const theta = TWO_PI * phase;
    const inc = clamp(params.inclinationDeg, 0, 90) * DEG;
    const e = clamp(params.eccentricity || 0, 0, 0.95);
    const r = params.aRs * (1 - e * e) / Math.max(0.05, 1 + e * Math.cos(theta));

    const x = r * Math.sin(theta);
    const y = -r * Math.cos(theta) * Math.cos(inc);
    const z = r * Math.cos(theta) * Math.sin(inc);

    return {
      x,
      y,
      z,
      radius: clamp(params.rpRs ?? 0.1, 0.005, 0.28),
      front: z > 0,
      orbitPhase: phase,
      theta,
      distanceRs: r
    };
  }

  computeMoonState(orbitPhase, params) {
    const planet = this.computePlanetState(orbitPhase, params);
    return this.computeMoonStateFromPlanet(orbitPhase, planet, params);
  }

  computeMoonStateFromPlanet(orbitPhase, planet, params) {
    if (!params?.moonEnabled) {
      return {
        enabled: false,
        x: 0,
        y: 0,
        z: -1,
        radius: 0,
        front: false,
        label: "DISABLED",
        vector: [0, 0, 0],
        orbitPhase: wrap01(orbitPhase)
      };
    }

    const phase = wrap01(orbitPhase);
    const moonPhase =
      (params.moonPhaseDeg ?? 45) * DEG +
      TWO_PI * phase * (params.moonAngularRate ?? 8);

    const node = (params.moonNodeDeg ?? 35) * DEG;
    const inc = (params.moonInclinationDeg ?? 12) * DEG;
    const distance = clamp(params.moonDistance ?? 0.55, 0.05, 2.5);

    let local = [
      distance * Math.cos(moonPhase),
      distance * Math.sin(moonPhase),
      0
    ];

    local = rotateX(local, inc);
    local = rotateZ(local, node);

    const x = planet.x + local[0];
    const y = planet.y + local[1];
    const z = planet.z + local[2];

    return {
      enabled: true,
      x,
      y,
      z,
      radius: clamp(params.moonRadius ?? 0.025, 0.004, 0.08),
      front: z > 0,
      label: z >= planet.z ? "FRONT ARC" : "BACK ARC",
      vector: local,
      moonPhase: wrap01(moonPhase / TWO_PI),
      orbitPhase: phase
    };
  }

  evaluateAtPhase(phase, params, epoch = 0, options = {}) {
    const correctedTransitPhase = this.applyTTV(phase, params, epoch);
    return this.evaluateCorrectedTransitPhase(
      correctedTransitPhase,
      params,
      epoch,
      options,
      phase
    );
  }

  evaluateAtOrbitPhase(orbitPhase, params, epoch = 0, options = {}) {
    const rawOrbitPhase = wrap01(orbitPhase);
    const rawTransitPhase = orbitPhaseToTransitPhase(rawOrbitPhase);
    const correctedTransitPhase = this.applyTTV(rawTransitPhase, params, epoch);

    const state = this.evaluateCorrectedTransitPhase(
      correctedTransitPhase,
      params,
      epoch,
      options,
      rawTransitPhase
    );

    state.rawOrbitPhase = rawOrbitPhase;
    state.correctedOrbitPhase = transitPhaseToOrbitPhase(correctedTransitPhase);

    return state;
  }

  evaluateCorrectedTransitPhase(correctedTransitPhase, params, epoch = 0, options = {}, requestedPhase = null) {
    const orbitPhase = transitPhaseToOrbitPhase(correctedTransitPhase);
    const planet = this.computePlanetState(orbitPhase, params);
    const moon = this.computeMoonStateFromPlanet(orbitPhase, planet, params);
    const spotComponents = options.includeVisual === false ? [] : this.getSpotComponents(params);
    const norm = this.computeIntensityNorm(params);

    let visibleFlux = 0;
    let occultedFlux = 0;
    let planetOccultedFlux = 0;
    let moonOccultedFlux = 0;
    let spotBoostFlux = 0;
    let occultedSpotSamples = 0;

    const planetR2 = planet.radius * planet.radius;
    const moonR2 = moon.radius * moon.radius;

    for (const sample of this.samples) {
      const radiance = this.stellarIntensityAt(sample, params);
      const weighted = radiance.intensity * sample.area;
      const unspottedWeighted = radiance.unspotted * sample.area;

      let occulted = false;
      let byPlanet = false;
      let byMoon = false;

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
          byMoon = true;
        }
      }

      if (occulted) {
        occultedFlux += weighted;

        if (byPlanet) {
          planetOccultedFlux += weighted;

          if (radiance.spotCoverage > 1e-5) {
            spotBoostFlux += Math.max(0, unspottedWeighted - weighted);
            occultedSpotSamples += 1;
          }
        }

        if (byMoon) {
          moonOccultedFlux += weighted;
        }
      } else {
        visibleFlux += weighted;
      }
    }

    const flux = clamp(visibleFlux / norm, 0, 1.05);
    const depth = Math.max(0, 1 - flux);
    const planetDepth = Math.max(0, planetOccultedFlux / norm);
    const moonDepth = Math.max(0, moonOccultedFlux / norm);
    const spotBoost = Math.max(0, spotBoostFlux / norm);

    return {
      phase: requestedPhase ?? correctedTransitPhase,
      transitPhase: correctedTransitPhase,
      orbitPhase,
      rawOrbitPhase: orbitPhase,
      correctedOrbitPhase: orbitPhase,

      flux,
      depth,
      depthPpm: depth * 1e6,

      planetDepth,
      planetDepthPpm: planetDepth * 1e6,
      moonDepth,
      moonDepthPpm: moonDepth * 1e6,
      spotBoost,
      spotBoostFlux,
      spotBoostPpm: spotBoost * 1e6,

      occultedFlux,
      planetOccultedFlux,
      moonOccultedFlux,
      occultedSpotSamples,

      planet,
      moon,
      impact: this.computeImpactParameter(params),
      spotComponents,
      epoch,

      integration: {
        rings: this.rings,
        azimuth: this.azimuth,
        samples: this.samples.length,
        norm
      }
    };
  }

  generateLightCurve({ params, phaseMin = -0.08, phaseMax = 0.08, points = 241, epoch = 0 }) {
    const n = Math.max(2, Math.trunc(points));
    const curve = [];

    for (let i = 0; i < n; i++) {
      const phase = phaseMin + (phaseMax - phaseMin) * i / (n - 1);
      const state = this.evaluateAtPhase(phase, params, epoch, { includeVisual: false });

      curve.push({
        phase,
        flux: state.flux,
        depth: state.depth,
        depthPpm: state.depthPpm,
        planetDepthPpm: state.planetDepthPpm,
        moonDepthPpm: state.moonDepthPpm,
        spotBoostPpm: state.spotBoostPpm,
        planet: state.planet,
        moon: state.moon,
        impact: state.impact
      });
    }

    return curve;
  }

  summarizeCurve(curve) {
    if (!Array.isArray(curve) || !curve.length) {
      return {
        minFlux: null,
        maxDepth: null,
        depthPpm: null,
        phaseAtMin: null,
        durationPhase: 0,
        points: 0,
        maxMoonDepthPpm: 0,
        maxSpotBoostPpm: 0
      };
    }

    let minFlux = Infinity;
    let maxDepth = 0;
    let maxMoonDepthPpm = 0;
    let maxSpotBoostPpm = 0;
    let phaseAtMin = null;
    let firstTransit = null;
    let lastTransit = null;

    for (const point of curve) {
      if (!finite(point?.flux) || !finite(point?.phase)) continue;

      if (point.flux < minFlux) {
        minFlux = point.flux;
        phaseAtMin = point.phase;
      }

      if (finite(point.depth) && point.depth > maxDepth) {
        maxDepth = point.depth;
      }

      if (finite(point.moonDepthPpm) && point.moonDepthPpm > maxMoonDepthPpm) {
        maxMoonDepthPpm = point.moonDepthPpm;
      }

      if (finite(point.spotBoostPpm) && point.spotBoostPpm > maxSpotBoostPpm) {
        maxSpotBoostPpm = point.spotBoostPpm;
      }

      if ((point.depth || 0) > 1e-6) {
        if (firstTransit === null) firstTransit = point.phase;
        lastTransit = point.phase;
      }
    }

    return {
      minFlux: finite(minFlux) ? minFlux : null,
      maxDepth: Math.max(0, maxDepth),
      depthPpm: Math.max(0, maxDepth) * 1e6,
      phaseAtMin,
      durationPhase: firstTransit === null || lastTransit === null
        ? 0
        : Math.abs(lastTransit - firstTransit),
      points: curve.length,
      maxMoonDepthPpm,
      maxSpotBoostPpm
    };
  }
}

function estimateQuadraticLimbDarkening(teff) {
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
  if (
    !finite(periodDays) ||
    !finite(aRs) ||
    !finite(rpRs) ||
    !finite(inclinationDeg) ||
    aRs <= 0 ||
    rpRs <= 0
  ) {
    return null;
  }

  const i = inclinationDeg * DEG;
  const sinI = Math.max(1e-6, Math.sin(i));
  const b = Math.abs(aRs * Math.cos(i));

  const outer = Math.sqrt(Math.max(0, (1 + rpRs) * (1 + rpRs) - b * b));
  const inner = Math.sqrt(Math.max(0, (1 - rpRs) * (1 - rpRs) - b * b));

  const totalHours = periodDays * 24 / Math.PI * Math.asin(clamp(outer / Math.max(1e-6, aRs * sinI), 0, 1));
  const fullHours = periodDays * 24 / Math.PI * Math.asin(clamp(inner / Math.max(1e-6, aRs * sinI), 0, 1));

  return Math.max(0, (totalHours - fullHours) * 30);
}

function estimateHZIndex(teff, stRad, semiMajorAu) {
  if (!finite(teff) || !finite(stRad) || !finite(semiMajorAu) || semiMajorAu <= 0) {
    return null;
  }

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

  return [
    v[0],
    v[1] * c - v[2] * s,
    v[1] * s + v[2] * c
  ];
}

function rotateZ(v, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);

  return [
    v[0] * c - v[1] * s,
    v[0] * s + v[1] * c,
    v[2]
  ];
}

function mulberry32(seed) {
  let t = seed >>> 0;

  return function random() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function stableHash(value) {
  const text = String(value);
  let hash = 2166136261;

  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function fmtKey(value, digits) {
  return finite(value) ? Number(value).toFixed(digits) : "x";
}

function wrap01(value) {
  let v = Number(value) || 0;
  v %= 1;

  if (v < 0) v += 1;

  return v;
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
