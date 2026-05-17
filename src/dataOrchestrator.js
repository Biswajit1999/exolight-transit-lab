export const DEFAULT_ADQL = `SELECT TOP 200
  pl_name,
  hostname,
  sy_snum,
  sy_pnum,
  ra,
  dec,
  pl_orbper,
  pl_orbsmax,
  pl_ratror,
  pl_rade,
  pl_bmasse,
  pl_orbincl,
  pl_orbeccen,
  pl_trandep,
  pl_trandur,
  pl_tranmid,
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
  AND pl_trandep IS NOT NULL
ORDER BY pl_trandep DESC`;

const TAP_URL = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync";
const R_SUN_AU = 0.00465047;
const R_EARTH_R_SUN = 0.0091577;
const M_EARTH_M_SUN = 0.0000030034896;

const EMBEDDED_FALLBACK = [
  {
    pl_name: "HD 189733 b",
    hostname: "HD 189733",
    sy_snum: 2,
    sy_pnum: 1,
    pl_orbper: 2.21857567,
    pl_orbsmax: 0.03126,
    pl_ratror: 0.15534,
    pl_rade: 12.66617,
    pl_bmasse: 359.1479,
    pl_orbincl: 85.71,
    pl_orbeccen: 0,
    pl_trandep: 24000,
    pl_trandep_percent: 2.4,
    pl_trandur: 1.8233621,
    pl_tranmid: 2453955.5255511,
    st_teff: 5052,
    st_rad: 0.75,
    st_mass: 0.79,
    st_logg: 4.49,
    st_met: -0.03,
    disc_year: 2005,
    discoverymethod: "Transit",
    lightcurve_file: "hd-189733-b.json",
    lightcurve_available: false
  },
  {
    pl_name: "WASP-43 b",
    hostname: "WASP-43",
    sy_snum: 1,
    sy_pnum: 1,
    pl_orbper: 0.813475,
    pl_orbsmax: 0.0142,
    pl_ratror: 0.1594,
    pl_rade: 10.424,
    pl_bmasse: 565.714,
    pl_orbincl: 82.6,
    pl_orbeccen: 0,
    pl_trandep: 25500,
    pl_trandep_percent: 2.55,
    pl_trandur: 1.1592,
    st_teff: 4400,
    st_rad: 0.6,
    st_mass: 0.58,
    st_logg: 4.65,
    st_met: 0,
    disc_year: 2011,
    discoverymethod: "Transit",
    lightcurve_file: "wasp-43-b.json",
    lightcurve_available: false
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

    const response = await fetch(`${this.cacheUrl}?v=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
      headers: {
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Local cache HTTP ${response.status}`);
    }

    const payload = await response.json();
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray(payload.targets)
        ? payload.targets
        : [];

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
      throw new Error("No target supplied for observed light-curve loading");
    }

    if (target.lightcurve_available === false) {
      throw new Error("Target is marked as having no local observed light-curve file");
    }

    const file = this.getLightCurveFile(target);
    const url = `${this.lightcurveBaseUrl}${encodeURIComponent(file).replace(/%2F/g, "/")}?v=${Date.now()}`;
    const cacheKey = `${target.id || target.pl_name || file}|${file}`;

    if (this.lightcurveCache.has(cacheKey)) {
      const cached = this.cloneLightCurve(this.lightcurveCache.get(cacheKey));
      this.attachLightCurveMetadataToTarget(target, cached.meta || {});
      return cached;
    }

    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: {
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Observed light-curve file ${file} HTTP ${response.status}`);
    }

    const payload = await response.json();
    const metadata = this.extractLightCurveMetadata(payload, file);
    const curve = this.normalizeLightCurve(payload);

    if (!curve.length) {
      throw new Error(`Observed light-curve file ${file} contained no valid phase/flux rows`);
    }

    curve.meta = metadata;
    this.attachLightCurveMetadataToTarget(target, metadata);
    this.lightcurveCache.set(cacheKey, curve);

    return this.cloneLightCurve(curve);
  }

  extractLightCurveMetadata(payload, file) {
    return {
      file,
      schema: text(payload?.schema),
      generated_utc: text(payload?.generated_utc),
      source: text(payload?.source),
      planet: text(payload?.planet),
      hostname: text(payload?.hostname),
      period_days: number(payload?.period_days),
      transit_midpoint: number(payload?.transit_midpoint),
      phase_window_used: number(payload?.phase_window_used),
      duration_phase: number(payload?.duration_phase),
      phase_shift_applied: number(payload?.phase_shift_applied),
      processing: text(payload?.processing),
      points_count: integer(payload?.points_count)
    };
  }

  attachLightCurveMetadataToTarget(target, meta = {}) {
    if (!target || typeof target !== "object") return;

    target.lightcurve_metadata = { ...meta };
    target.lc_schema = meta.schema || "";
    target.lc_generated_utc = meta.generated_utc || "";
    target.lc_source = meta.source || "";
    target.lc_phase_window_used = finiteNumber(meta.phase_window_used, null);
    target.lc_duration_phase = finiteNumber(meta.duration_phase, null);
    target.lc_phase_shift_applied = finiteNumber(meta.phase_shift_applied, null);
    target.lc_processing = meta.processing || "";
    target.lc_points_count = finiteNumber(meta.points_count, null);
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
      const err = Array.isArray(payload.error)
        ? payload.error
        : Array.isArray(payload.flux_err)
          ? payload.flux_err
          : [];

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
    const explicit = text(firstDefined(
      target.lightcurve_file,
      target.lightcurveFile,
      target.lc_file,
      target.photometry_file
    ));

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
        const lcA = a.lightcurve_available ? 1 : 0;
        const lcB = b.lightcurve_available ? 1 : 0;
        const scoreA = finiteNumber(a.signal_score, 0);
        const scoreB = finiteNumber(b.signal_score, 0);
        const depthA = finiteNumber(a.pl_trandep, 0);
        const depthB = finiteNumber(b.pl_trandep, 0);

        return (lcB - lcA) || ((scoreB || depthB) - (scoreA || depthA));
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
    const depthPercent = number(firstDefined(r.pl_trandep_percent, r.transit_depth_percent));
    const durationHours = number(firstDefined(r.pl_trandur, r.transit_duration_hours, r.duration_hours));
    const transitMidpoint = number(firstDefined(r.pl_tranmid, r.transit_midpoint, r.t0));
    const discoveryYear = integer(firstDefined(r.disc_year, r.discovery_year));
    const method = text(firstDefined(r.discoverymethod, r.discovery_method, r.method));
    const logg = number(r.st_logg);
    const metallicity = number(firstDefined(r.st_met, r.st_metratio, r.metallicity));
    const snr = number(firstDefined(r.snr, r.signal_to_noise, r.transit_snr));

    const explicitLightCurveFile = text(firstDefined(
      r.lightcurve_file,
      r.lightcurvefile,
      r.lc_file,
      r.photometry_file
    ));

    const lightcurveAvailable = bool(firstDefined(
      r.lightcurve_available,
      r.lightcurveavailable,
      r.has_lightcurve,
      r.has_real_lc,
      r.has_observed_lc
    ), false);

    const inferredRpRs = finiteNumber(rpRs, null) ?? inferRpRs(rpEarth, stRad);
    const inferredARs = inferARs(semiMajor, stRad);
    const inferredDepth = finiteNumber(depth, null) ?? (
      finiteNumber(inferredRpRs, null) !== null ? inferredRpRs * inferredRpRs * 1e6 : null
    );

    const score = finiteNumber(snr, null) ?? finiteNumber(inferredDepth, 0);
    const id = stableId(plName || `planet-${index}`, host || "unknown-host");

    return {
      id,
      source,
      pl_name: plName,
      hostname: host,
      sy_snum: integer(firstDefined(r.sy_snum, r.stellar_count)),
      sy_pnum: integer(firstDefined(r.sy_pnum, r.planet_count)),
      ra: finiteNumber(number(r.ra), null),
      dec: finiteNumber(number(r.dec), null),
      pl_orbper: finiteNumber(period, null),
      pl_orbsmax: finiteNumber(semiMajor, null),
      pl_ratror: finiteNumber(inferredRpRs, null),
      pl_rade: finiteNumber(rpEarth, null),
      pl_bmasse: finiteNumber(mpEarth, null),
      pl_orbincl: finiteNumber(incl, null),
      pl_orbeccen: finiteNumber(ecc, 0),
      pl_trandep: finiteNumber(inferredDepth, null),
      pl_trandep_percent: finiteNumber(depthPercent, null),
      pl_trandur: finiteNumber(durationHours, null),
      pl_tranmid: finiteNumber(transitMidpoint, null),
      st_teff: finiteNumber(stTeff, null),
      st_rad: finiteNumber(stRad, null),
      st_mass: finiteNumber(stMass, null),
      st_logg: finiteNumber(logg, null),
      st_met: finiteNumber(metallicity, null),
      disc_year: finiteNumber(discoveryYear, null),
      discoverymethod: method || "Transit",
      a_rs: finiteNumber(inferredARs, null),
      signal_score: finiteNumber(score, 0),
      lightcurve_file: explicitLightCurveFile || `${slugify(plName || id)}.json`,
      lightcurve_available: lightcurveAvailable,
      lc_schema: text(r.lc_schema),
      lc_generated_utc: text(r.lc_generated_utc),
      lc_source: text(r.lc_source),
      lc_phase_window_used: finiteNumber(number(r.lc_phase_window_used), null),
      lc_duration_phase: finiteNumber(number(r.lc_duration_phase), null),
      lc_phase_shift_applied: finiteNumber(number(r.lc_phase_shift_applied), null),
      lc_processing: text(r.lc_processing),
      lc_points_count: finiteNumber(integer(r.lc_points_count), null)
    };
  }

  filterTargets(targets, query) {
    const q = String(query || "").trim().toLowerCase();

    if (!q) {
      return this.cloneTargets(targets);
    }

    const tokens = q.split(/\s+/).filter(Boolean);

    return this.cloneTargets(targets.filter(target => {
      const observedText = target.lightcurve_available
        ? "real lc obs lc observed light curve lightcurve photometry telescope data mast tess kepler k2 cleaned local json"
        : "model only no lc no observed no photometry no telescope data";

      const systemText = [
        finiteNumber(target.sy_snum, 1) > 1 ? "binary multi star multiple stars possible dilution" : "single star",
        finiteNumber(target.sy_pnum, 1) > 1 ? "multi planet multiple planets" : "single planet one planet"
      ].join(" ");

      const haystack = [
        target.pl_name,
        target.hostname,
        target.discoverymethod,
        target.disc_year,
        target.st_teff,
        target.pl_orbper,
        target.pl_trandep,
        target.lightcurve_file,
        target.lc_processing,
        target.lc_source,
        target.lc_schema,
        observedText,
        systemText
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
    return (targets || []).map(target => ({
      ...target,
      lightcurve_metadata: target.lightcurve_metadata ? { ...target.lightcurve_metadata } : undefined
    }));
  }

  cloneLightCurve(curve) {
    const cloned = (curve || []).map(point => ({ ...point }));
    cloned.meta = curve?.meta ? { ...curve.meta } : undefined;
    return cloned;
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

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  const v = String(value).trim().toLowerCase();

  if (["true", "1", "yes", "y", "available", "online"].includes(v)) {
    return true;
  }

  if (["false", "0", "no", "n", "missing", "offline"].includes(v)) {
    return false;
  }

  return fallback;
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
