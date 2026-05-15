export const DEFAULT_ADQL = `SELECT TOP 150
  pl_name,
  hostname,
  sy_snum,
  sy_pnum,
  pl_orbper,
  pl_orbsmax,
  pl_ratror,
  pl_rade,
  pl_bmasse,
  pl_orbincl,
  pl_orbeccen,
  pl_trandep,
  pl_trandur,
  st_teff,
  st_rad,
  st_mass,
  st_logg,
  st_met,
  disc_year,
  discoverymethod
FROM pscomppars
WHERE tran_flag = 1
  AND pl_name IS NOT NULL
  AND hostname IS NOT NULL
  AND pl_orbper IS NOT NULL
  AND pl_orbsmax IS NOT NULL
  AND pl_ratror IS NOT NULL
  AND pl_orbincl IS NOT NULL
  AND pl_orbeccen IS NOT NULL
  AND st_rad IS NOT NULL
  AND st_teff IS NOT NULL
ORDER BY pl_trandep DESC`;

const TAP_URL = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync";
const R_SUN_AU = 0.00465047;
const R_EARTH_R_SUN = 0.0091577;
const M_EARTH_M_SUN = 0.0000030034896;

const EMBEDDED_FALLBACK = [
  {
    pl_name: "WASP-12 b",
    hostname: "WASP-12",
    sy_snum: 1,
    sy_pnum: 1,
    pl_orbper: 1.09142,
    pl_orbsmax: 0.0234,
    pl_ratror: 0.117,
    pl_rade: 20.2,
    pl_bmasse: 465,
    pl_orbincl: 83.37,
    pl_orbeccen: 0,
    pl_trandep: 14100,
    pl_trandur: 2.93,
    st_teff: 6300,
    st_rad: 1.63,
    st_mass: 1.35,
    st_logg: 4.2,
    st_met: 0.3,
    disc_year: 2008,
    discoverymethod: "Transit",
    lightcurve_file: "wasp-12-b.json"
  },
  {
    pl_name: "HD 209458 b",
    hostname: "HD 209458",
    sy_snum: 1,
    sy_pnum: 1,
    pl_orbper: 3.52475,
    pl_orbsmax: 0.0471,
    pl_ratror: 0.1207,
    pl_rade: 15.9,
    pl_bmasse: 219,
    pl_orbincl: 86.71,
    pl_orbeccen: 0,
    pl_trandep: 14500,
    pl_trandur: 3.1,
    st_teff: 6065,
    st_rad: 1.2,
    st_mass: 1.15,
    st_logg: 4.38,
    st_met: 0.02,
    disc_year: 1999,
    discoverymethod: "Transit",
    lightcurve_file: "hd-209458-b.json"
  },
  {
    pl_name: "TrES-3 b",
    hostname: "TrES-3",
    sy_snum: 1,
    sy_pnum: 1,
    pl_orbper: 1.30619,
    pl_orbsmax: 0.0226,
    pl_ratror: 0.166,
    pl_rade: 14.3,
    pl_bmasse: 607,
    pl_orbincl: 81.85,
    pl_orbeccen: 0,
    pl_trandep: 27400,
    pl_trandur: 1.31,
    st_teff: 5650,
    st_rad: 0.83,
    st_mass: 0.93,
    st_logg: 4.54,
    st_met: -0.19,
    disc_year: 2007,
    discoverymethod: "Transit",
    lightcurve_file: "tres-3-b.json"
  },
  {
    pl_name: "HAT-P-7 b",
    hostname: "HAT-P-7",
    sy_snum: 1,
    sy_pnum: 1,
    pl_orbper: 2.20474,
    pl_orbsmax: 0.0379,
    pl_ratror: 0.076,
    pl_rade: 16.0,
    pl_bmasse: 572,
    pl_orbincl: 83.11,
    pl_orbeccen: 0,
    pl_trandep: 5900,
    pl_trandur: 4.0,
    st_teff: 6350,
    st_rad: 1.84,
    st_mass: 1.52,
    st_logg: 4.07,
    st_met: 0.26,
    disc_year: 2008,
    discoverymethod: "Transit",
    lightcurve_file: "hat-p-7-b.json"
  },
  {
    pl_name: "KELT-9 b",
    hostname: "KELT-9",
    sy_snum: 1,
    sy_pnum: 1,
    pl_orbper: 1.48112,
    pl_orbsmax: 0.0346,
    pl_ratror: 0.0804,
    pl_rade: 21.3,
    pl_bmasse: 915,
    pl_orbincl: 86.79,
    pl_orbeccen: 0,
    pl_trandep: 6500,
    pl_trandur: 3.91,
    st_teff: 10170,
    st_rad: 2.36,
    st_mass: 2.52,
    st_logg: 4.09,
    st_met: -0.03,
    disc_year: 2017,
    discoverymethod: "Transit",
    lightcurve_file: "kelt-9-b.json"
  },
  {
    pl_name: "Kepler-10 b",
    hostname: "Kepler-10",
    sy_snum: 1,
    sy_pnum: 2,
    pl_orbper: 0.83749,
    pl_orbsmax: 0.01684,
    pl_ratror: 0.0126,
    pl_rade: 1.47,
    pl_bmasse: 3.72,
    pl_orbincl: 84.4,
    pl_orbeccen: 0,
    pl_trandep: 160,
    pl_trandur: 1.8,
    st_teff: 5627,
    st_rad: 1.06,
    st_mass: 0.91,
    st_logg: 4.34,
    st_met: -0.15,
    disc_year: 2011,
    discoverymethod: "Transit",
    lightcurve_file: "kepler-10-b.json"
  },
  {
    pl_name: "Kepler-22 b",
    hostname: "Kepler-22",
    sy_snum: 1,
    sy_pnum: 1,
    pl_orbper: 289.862,
    pl_orbsmax: 0.849,
    pl_ratror: 0.021,
    pl_rade: 2.38,
    pl_bmasse: null,
    pl_orbincl: 89.76,
    pl_orbeccen: 0,
    pl_trandep: 492,
    pl_trandur: 7.4,
    st_teff: 5518,
    st_rad: 0.98,
    st_mass: 0.97,
    st_logg: 4.44,
    st_met: -0.29,
    disc_year: 2011,
    discoverymethod: "Transit",
    lightcurve_file: "kepler-22-b.json"
  },
  {
    pl_name: "TRAPPIST-1 e",
    hostname: "TRAPPIST-1",
    sy_snum: 1,
    sy_pnum: 7,
    pl_orbper: 6.099,
    pl_orbsmax: 0.02925,
    pl_ratror: 0.081,
    pl_rade: 0.92,
    pl_bmasse: 0.69,
    pl_orbincl: 89.74,
    pl_orbeccen: 0.006,
    pl_trandep: 6700,
    pl_trandur: 0.94,
    st_teff: 2566,
    st_rad: 0.119,
    st_mass: 0.089,
    st_logg: 5.23,
    st_met: 0.04,
    disc_year: 2017,
    discoverymethod: "Transit",
    lightcurve_file: "trappist-1-e.json"
  },
  {
    pl_name: "GJ 1214 b",
    hostname: "GJ 1214",
    sy_snum: 1,
    sy_pnum: 1,
    pl_orbper: 1.5804,
    pl_orbsmax: 0.0149,
    pl_ratror: 0.116,
    pl_rade: 2.74,
    pl_bmasse: 8.17,
    pl_orbincl: 88.7,
    pl_orbeccen: 0,
    pl_trandep: 13400,
    pl_trandur: 0.87,
    st_teff: 3250,
    st_rad: 0.22,
    st_mass: 0.18,
    st_logg: 5.03,
    st_met: 0.29,
    disc_year: 2009,
    discoverymethod: "Transit",
    lightcurve_file: "gj-1214-b.json"
  },
  {
    pl_name: "55 Cnc e",
    hostname: "55 Cnc",
    sy_snum: 2,
    sy_pnum: 5,
    pl_orbper: 0.73655,
    pl_orbsmax: 0.01544,
    pl_ratror: 0.0187,
    pl_rade: 1.88,
    pl_bmasse: 8.59,
    pl_orbincl: 83.6,
    pl_orbeccen: 0.05,
    pl_trandep: 350,
    pl_trandur: 1.55,
    st_teff: 5172,
    st_rad: 0.94,
    st_mass: 0.91,
    st_logg: 4.45,
    st_met: 0.35,
    disc_year: 2004,
    discoverymethod: "Radial Velocity",
    lightcurve_file: "55-cnc-e.json"
  }
];

export class DataOrchestrator {
  constructor(options = {}) {
    this.cacheUrl = options.cacheUrl || "./data/exoplanets.json";
    this.lightcurveBaseUrl = options.lightcurveBaseUrl || "./data/lightcurves/";
    this.tapUrl = options.tapUrl || TAP_URL;
    this.timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 12000;
    this.cache = null;
    this.lightcurveCache = new Map();
    this.lastSource = "unloaded";
    this.lastError = null;
  }

  async loadLocalCache(force = false) {
    if (this.cache && !force) {
      return this.cloneTargets(this.cache);
    }

    const bust = force ? `?t=${Date.now()}` : "";
    const response = await fetch(`${this.cacheUrl}${bust}`, {
      method: "GET",
      cache: force ? "reload" : "default",
      headers: {
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Local cache HTTP ${response.status}`);
    }

    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : Array.isArray(payload.targets) ? payload.targets : [];
    const normalized = this.normalizeRows(rows, "cache");

    if (!normalized.length) {
      throw new Error("Local cache contained no valid target rows");
    }

    this.cache = normalized;
    this.lastSource = "local-cache";
    this.lastError = null;
    return this.cloneTargets(normalized);
  }

  async queryTap(adql) {
    const clean = this.validateAdql(adql);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const body = new URLSearchParams({
      request: "doQuery",
      lang: "ADQL",
      format: "json",
      query: clean
    });

    try {
      const response = await fetch(this.tapUrl, {
        method: "POST",
        mode: "cors",
        signal: controller.signal,
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
        },
        body
      });

      if (!response.ok) {
        throw new Error(`NASA TAP HTTP ${response.status}`);
      }

      const payload = await response.json();
      const rows = this.extractTapRows(payload);
      const normalized = this.normalizeRows(rows, "tap");

      if (!normalized.length) {
        throw new Error("NASA TAP returned no usable planet rows");
      }

      this.lastSource = "nasa-tap";
      this.lastError = null;
      return normalized;
    } catch (error) {
      this.lastError = error;
      this.lastSource = "tap-failed";
      if (error.name === "AbortError") {
        throw new Error("NASA TAP request timed out before completion");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async loadLightCurve(target) {
    if (!target) {
      throw new Error("No target supplied for light-curve loading");
    }

    const file = this.getLightCurveFile(target);
    const url = `${this.lightcurveBaseUrl}${encodeURIComponent(file).replace(/%2F/g, "/")}`;
    const cacheKey = `${target.id || target.pl_name || file}|${file}`;

    if (this.lightcurveCache.has(cacheKey)) {
      return this.cloneLightCurve(this.lightcurveCache.get(cacheKey));
    }

    const response = await fetch(url, {
      method: "GET",
      cache: "default",
      headers: {
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Light-curve file ${file} HTTP ${response.status}`);
    }

    const payload = await response.json();
    const curve = this.normalizeLightCurve(payload);

    if (!curve.length) {
      throw new Error(`Light-curve file ${file} contained no valid phase/flux rows`);
    }

    this.lightcurveCache.set(cacheKey, curve);
    return this.cloneLightCurve(curve);
  }

  normalizeLightCurve(payload) {
    const rows = this.extractLightCurveRows(payload);
    const clean = [];

    for (const row of rows) {
      const phase = number(firstDefined(row.phase, row.Phase, row.ph, row.x, row.time_phase));
      const flux = number(firstDefined(row.flux, row.Flux, row.normalized_flux, row.norm_flux, row.y, row.sap_flux_norm, row.pdcsap_flux_norm));
      const error = number(firstDefined(row.error, row.flux_err, row.err, row.sigma));

      if (!Number.isFinite(phase) || !Number.isFinite(flux)) {
        continue;
      }

      if (phase < -1.5 || phase > 1.5 || flux < 0.2 || flux > 1.8) {
        continue;
      }

      clean.push({
        phase,
        flux,
        error: Number.isFinite(error) ? error : null
      });
    }

    clean.sort((a, b) => a.phase - b.phase);
    return clean;
  }

  extractLightCurveRows(payload) {
    if (Array.isArray(payload)) {
      return payload;
    }

    if (!payload || typeof payload !== "object") {
      return [];
    }

    if (Array.isArray(payload.points)) {
      return payload.points;
    }

    if (Array.isArray(payload.data)) {
      if (payload.data.length && Array.isArray(payload.data[0])) {
        return payload.data.map(row => ({
          phase: row[0],
          flux: row[1],
          error: row[2]
        }));
      }
      return payload.data;
    }

    if (Array.isArray(payload.phase) && Array.isArray(payload.flux)) {
      const n = Math.min(payload.phase.length, payload.flux.length);
      const err = Array.isArray(payload.error) ? payload.error : Array.isArray(payload.flux_err) ? payload.flux_err : [];
      const out = [];

      for (let i = 0; i < n; i++) {
        out.push({
          phase: payload.phase[i],
          flux: payload.flux[i],
          error: err[i] ?? null
        });
      }

      return out;
    }

    if (Array.isArray(payload.phases) && Array.isArray(payload.fluxes)) {
      const n = Math.min(payload.phases.length, payload.fluxes.length);
      const out = [];

      for (let i = 0; i < n; i++) {
        out.push({
          phase: payload.phases[i],
          flux: payload.fluxes[i],
          error: null
        });
      }

      return out;
    }

    return [];
  }

  getLightCurveFile(target) {
    const explicit = text(firstDefined(target.lightcurve_file, target.lightcurveFile, target.lc_file, target.photometry_file));
    if (explicit) {
      return explicit;
    }

    const name = text(firstDefined(target.pl_name, target.name, target.planet, "unknown-target"));
    return `${slugify(name)}.json`;
  }

  validateAdql(adql) {
    const clean = String(adql || "").trim();

    if (!clean) {
      throw new Error("ADQL query is empty");
    }

    const compact = clean.replace(/\s+/g, " ").toLowerCase();
    const forbidden = [
      "drop ",
      "delete ",
      "update ",
      "insert ",
      "alter ",
      "create ",
      "truncate ",
      "grant ",
      "revoke ",
      "merge ",
      "call ",
      "exec "
    ];

    if (!compact.startsWith("select ")) {
      throw new Error("Only SELECT ADQL queries are permitted in the live console");
    }

    if (forbidden.some(token => compact.includes(token))) {
      throw new Error("ADQL console rejected a non-read-only statement");
    }

    const semicolons = clean.match(/;/g);
    if (semicolons && semicolons.length > 1) {
      throw new Error("ADQL console accepts one read-only query at a time");
    }

    return clean.replace(/;+\s*$/, "");
  }

  extractTapRows(payload) {
    if (Array.isArray(payload)) {
      return payload;
    }

    if (payload && Array.isArray(payload.data) && Array.isArray(payload.metadata)) {
      const names = payload.metadata.map(col => col.name || col.label || col.ID || col.id);

      return payload.data.map(row => {
        const out = {};
        names.forEach((name, index) => {
          out[name] = row[index];
        });
        return out;
      });
    }

    if (payload && Array.isArray(payload.rows)) {
      return payload.rows;
    }

    if (payload && Array.isArray(payload.targets)) {
      return payload.targets;
    }

    return [];
  }

  normalizeRows(rows, source = "unknown") {
    const seen = new Set();

    return rows
      .map((row, index) => this.normalizeRow(row, source, index))
      .filter(row => {
        const key = `${row.pl_name}|${row.hostname}`;
        if (!row.pl_name || !row.hostname || seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .sort((a, b) => {
        const scoreA = finiteNumber(a.signal_score, 0);
        const scoreB = finiteNumber(b.signal_score, 0);
        const depthA = finiteNumber(a.pl_trandep, 0);
        const depthB = finiteNumber(b.pl_trandep, 0);
        return (scoreB || depthB) - (scoreA || depthA);
      });
  }

  normalizeRow(row, source, index) {
    const r = lowerKeyClone(row);
    const plName = text(firstDefined(r.pl_name, r.name, r.planet, r.planet_name, r.plname));
    const host = text(firstDefined(r.hostname, r.host, r.star, r.star_name, r.hostname_str));

    const stRad = number(firstDefined(r.st_rad, r.stellar_radius, r.star_radius));
    const stMass = number(firstDefined(r.st_mass, r.stellar_mass, r.star_mass));
    const stTeff = number(firstDefined(r.st_teff, r.teff, r.stellar_teff));
    const semiMajor = number(firstDefined(r.pl_orbsmax, r.semi_major_axis_au, r.a_au));
    const rpRs = number(firstDefined(r.pl_ratror, r.rp_rs, r.radius_ratio));
    const rpEarth = number(firstDefined(r.pl_rade, r.radius_earth, r.rp_earth));
    const mpEarth = number(firstDefined(r.pl_bmasse, r.mass_earth, r.mp_earth));
    const period = number(firstDefined(r.pl_orbper, r.period_days, r.period));
    const incl = number(firstDefined(r.pl_orbincl, r.inclination_deg, r.inclination));
    const ecc = number(firstDefined(r.pl_orbeccen, r.eccentricity, r.ecc));
    const depth = number(firstDefined(r.pl_trandep, r.transit_depth_ppm, r.depth_ppm));
    const durationHours = number(firstDefined(r.pl_trandur, r.transit_duration_hours, r.duration_hours));
    const discoveryYear = integer(firstDefined(r.disc_year, r.discovery_year));
    const method = text(firstDefined(r.discoverymethod, r.discovery_method, r.method));
    const logg = number(r.st_logg);
    const metallicity = number(firstDefined(r.st_met, r.st_metratio, r.metallicity));
    const snr = number(firstDefined(r.snr, r.signal_to_noise, r.transit_snr));
    const explicitLightCurveFile = text(firstDefined(r.lightcurve_file, r.lightcurvefile, r.lc_file, r.photometry_file));

    const inferredRpRs = finiteNumber(rpRs, null) ?? inferRpRs(rpEarth, stRad);
    const inferredARs = inferARs(semiMajor, stRad);
    const inferredDepth = finiteNumber(depth, null) ?? (finiteNumber(inferredRpRs, null) !== null ? inferredRpRs * inferredRpRs * 1e6 : null);
    const score = finiteNumber(snr, null) ?? finiteNumber(inferredDepth, 0);
    const id = stableId(plName || `planet-${index}`, host || "unknown-host");

    return {
      id,
      source,
      pl_name: plName,
      hostname: host,
      sy_snum: integer(firstDefined(r.sy_snum, r.stellar_count)),
      sy_pnum: integer(firstDefined(r.sy_pnum, r.planet_count)),
      pl_orbper: finiteNumber(period, null),
      pl_orbsmax: finiteNumber(semiMajor, null),
      pl_ratror: finiteNumber(inferredRpRs, null),
      pl_rade: finiteNumber(rpEarth, null),
      pl_bmasse: finiteNumber(mpEarth, null),
      pl_orbincl: finiteNumber(incl, null),
      pl_orbeccen: finiteNumber(ecc, 0),
      pl_trandep: finiteNumber(inferredDepth, null),
      pl_trandur: finiteNumber(durationHours, null),
      st_teff: finiteNumber(stTeff, null),
      st_rad: finiteNumber(stRad, null),
      st_mass: finiteNumber(stMass, null),
      st_logg: finiteNumber(logg, null),
      st_met: finiteNumber(metallicity, null),
      disc_year: finiteNumber(discoveryYear, null),
      discoverymethod: method || "Transit",
      a_rs: finiteNumber(inferredARs, null),
      signal_score: finiteNumber(score, 0),
      lightcurve_file: explicitLightCurveFile || `${slugify(plName || id)}.json`
    };
  }

  filterTargets(targets, query) {
    const q = String(query || "").trim().toLowerCase();

    if (!q) {
      return this.cloneTargets(targets);
    }

    const tokens = q.split(/\s+/).filter(Boolean);

    return this.cloneTargets(targets.filter(target => {
      const haystack = [
        target.pl_name,
        target.hostname,
        target.discoverymethod,
        target.disc_year,
        target.st_teff,
        target.pl_orbper,
        target.pl_trandep
      ].join(" ").toLowerCase();

      return tokens.every(token => haystack.includes(token));
    }));
  }

  getEmbeddedFallback() {
    const normalized = this.normalizeRows(EMBEDDED_FALLBACK, "embedded");
    this.lastSource = "embedded-fallback";
    return this.cloneTargets(normalized);
  }

  cloneTargets(targets) {
    return (targets || []).map(target => ({ ...target }));
  }

  cloneLightCurve(curve) {
    return (curve || []).map(point => ({ ...point }));
  }

  getDefaultQuery() {
    return DEFAULT_ADQL;
  }

  getLastSource() {
    return this.lastSource;
  }

  getLastError() {
    return this.lastError;
  }
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return null;
}

function text(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim();
}

function number(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function integer(value) {
  const n = number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function finiteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function lowerKeyClone(row) {
  const out = {};

  Object.entries(row || {}).forEach(([key, value]) => {
    out[String(key).toLowerCase()] = value;
  });

  return out;
}

function inferRpRs(rpEarth, stRadSolar) {
  if (!Number.isFinite(rpEarth) || !Number.isFinite(stRadSolar) || stRadSolar <= 0) {
    return null;
  }
  return (rpEarth * R_EARTH_R_SUN) / stRadSolar;
}

function inferARs(aAu, stRadSolar) {
  if (!Number.isFinite(aAu) || !Number.isFinite(stRadSolar) || stRadSolar <= 0) {
    return null;
  }
  return aAu / (stRadSolar * R_SUN_AU);
}

function stableId(planet, host) {
  return `${host}::${planet}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function slugify(value) {
  return String(value || "unknown-target")
    .trim()
    .toLowerCase()
    .replace(/\+/g, " plus ")
    .replace(/['’"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown-target";
}

export const DATA_CONSTANTS = {
  TAP_URL,
  R_SUN_AU,
  R_EARTH_R_SUN,
  M_EARTH_M_SUN
};
