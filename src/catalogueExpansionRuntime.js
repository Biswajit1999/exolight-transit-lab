/* ============================================================================
   ExoLight Phase III - Live catalogue expansion runtime
   ---------------------------------------------------------------------------
   Keeps the existing 500-target local archive as the offline baseline, then
   merges a lightweight NASA Exoplanet Archive PSCompPars transit supplement
   before src/app.js reads data/exoplanets.json.

   This file intentionally monkey-patches fetch only for data/exoplanets.json.
   Everything else uses the browser's native fetch unchanged.
   ============================================================================ */

const VERSION = "20260720-nasa-transit-supplement-v01";
const TARGET_CACHE_PATTERN = /(?:^|\/)data\/exoplanets\.json(?:\?|$)/;
const CACHE_KEY = `exolight:${VERSION}:rows`;
const NASA_TAP_SYNC = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync";
const MAX_REMOTE_ROWS = 1800;
const REMOTE_TIMEOUT_MS = 5500;

const nativeFetch = window.fetch.bind(window);

const NASA_COLUMNS = [
  "pl_name",
  "hostname",
  "sy_snum",
  "sy_pnum",
  "ra",
  "dec",
  "pl_orbper",
  "pl_orbsmax",
  "pl_ratror",
  "pl_rade",
  "pl_bmasse",
  "pl_orbincl",
  "pl_orbeccen",
  "pl_trandep",
  "pl_trandur",
  "pl_tranmid",
  "st_teff",
  "st_rad",
  "st_mass",
  "st_logg",
  "st_met",
  "disc_year",
  "discoverymethod",
  "disc_facility"
];

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input?.url || "";
}

function isTargetCacheRequest(input) {
  return TARGET_CACHE_PATTERN.test(requestUrl(input));
}

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asPositive(value) {
  const number = asNumber(value);
  return number !== null && number > 0 ? number : null;
}

function asString(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function targetKey(target) {
  return `${asString(target.hostname).toLowerCase()}::${asString(target.pl_name).toLowerCase()}`;
}

function normaliseNasaTarget(row) {
  const planet = asString(row?.pl_name);
  const host = asString(row?.hostname);
  const period = asPositive(row?.pl_orbper);
  if (!planet || !host || period === null) return null;

  // NASA PSCompPars documents pl_trandep as a percentage. ExoLight's internal
  // cache stores pl_trandep in ppm and pl_trandep_percent separately.
  const archiveDepthPercent = asPositive(row?.pl_trandep);
  const archiveRadiusRatio = asPositive(row?.pl_ratror);
  const radiusRatio = archiveRadiusRatio ?? (archiveDepthPercent !== null ? Math.sqrt(archiveDepthPercent / 100) : null);
  const depthPpm = archiveDepthPercent !== null
    ? archiveDepthPercent * 10000
    : radiusRatio !== null
      ? radiusRatio * radiusRatio * 1e6
      : null;

  return {
    pl_name: planet,
    hostname: host,
    sy_snum: asNumber(row?.sy_snum),
    sy_pnum: asNumber(row?.sy_pnum),
    ra: asNumber(row?.ra),
    dec: asNumber(row?.dec),
    pl_orbper: period,
    pl_orbsmax: asPositive(row?.pl_orbsmax),
    pl_ratror: radiusRatio,
    pl_rade: asPositive(row?.pl_rade),
    pl_bmasse: asPositive(row?.pl_bmasse),
    pl_orbincl: asNumber(row?.pl_orbincl),
    pl_orbeccen: asNumber(row?.pl_orbeccen),
    pl_trandep: depthPpm,
    pl_trandep_percent: depthPpm !== null ? depthPpm / 10000 : null,
    pl_trandur: asPositive(row?.pl_trandur),
    pl_tranmid: asNumber(row?.pl_tranmid),
    st_teff: asPositive(row?.st_teff),
    st_rad: asPositive(row?.st_rad),
    st_mass: asPositive(row?.st_mass),
    st_logg: asNumber(row?.st_logg),
    st_met: asNumber(row?.st_met),
    disc_year: asNumber(row?.disc_year),
    discoverymethod: asString(row?.discoverymethod) || "Transit",
    disc_facility: asString(row?.disc_facility),
    lightcurve_file: "",
    lightcurve_available: false,
    catalogue_extension: "NASA Exoplanet Archive PSCompPars transit supplement",
    provenance: {
      source: "NASA Exoplanet Archive",
      table: "pscomppars",
      query_version: VERSION,
      note: "Runtime supplement; local photometry is not bundled for this target."
    }
  };
}

function loadCachedRows() {
  try {
    const cached = JSON.parse(window.localStorage?.getItem(CACHE_KEY) || "[]");
    return Array.isArray(cached) ? cached : [];
  } catch {
    return [];
  }
}

function cacheRows(rows) {
  try {
    if (Array.isArray(rows) && rows.length) {
      window.localStorage?.setItem(CACHE_KEY, JSON.stringify(rows.slice(0, MAX_REMOTE_ROWS)));
    }
  } catch {
    // Local storage may be unavailable or full; the local 500-target archive still works.
  }
}

function buildNasaTapUrl() {
  const query = [
    `select top ${MAX_REMOTE_ROWS}`,
    NASA_COLUMNS.join(","),
    "from pscomppars",
    "where tran_flag=1 and pl_orbper is not null",
    "order by pl_name"
  ].join(" ");

  const url = new URL(NASA_TAP_SYNC);
  url.searchParams.set("query", query);
  url.searchParams.set("format", "json");
  return url.href;
}

async function fetchRemoteRows() {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);

  try {
    const response = await nativeFetch(buildNasaTapUrl(), {
      cache: "force-cache",
      mode: "cors",
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`NASA TAP HTTP ${response.status}`);
    const rows = await response.json();
    const normalised = Array.isArray(rows) ? rows.map(normaliseNasaTarget).filter(Boolean) : [];
    cacheRows(normalised);
    return normalised;
  } catch (error) {
    console.warn("ExoLight catalogue supplement unavailable; using local archive only:", error);
    return [];
  } finally {
    window.clearTimeout(timeout);
  }
}

async function getSupplementRows() {
  const cached = loadCachedRows();
  if (cached.length >= 100) return cached;
  return fetchRemoteRows();
}

async function expandPayload(payload) {
  const baseTargets = Array.isArray(payload) ? payload : Array.isArray(payload?.targets) ? payload.targets : [];
  const supplement = await getSupplementRows();
  const seen = new Set(baseTargets.map(targetKey));
  const merged = [...baseTargets];

  for (const target of supplement) {
    const key = targetKey(target);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(target);
  }

  const lightcurveCount = merged.filter(target => Boolean(target.lightcurve_available)).length;
  const baseObject = Array.isArray(payload) ? {} : { ...payload };

  return {
    ...baseObject,
    schema: baseObject.schema || "exointel-prime-expanded-cache-v3-colab",
    generated_utc: baseObject.generated_utc || new Date().toISOString(),
    source: `${baseObject.source || "Local ExoLight catalogue"}; runtime NASA Exoplanet Archive PSCompPars supplement`,
    target_count: merged.length,
    lightcurve_count: lightcurveCount,
    local_target_count: baseTargets.length,
    remote_supplement_count: Math.max(0, merged.length - baseTargets.length),
    remote_supplement_source: "NASA Exoplanet Archive TAP / PSCompPars, transiting confirmed planets",
    targets: merged
  };
}

window.fetch = async function exolightCatalogueExpansionFetch(input, init) {
  if (!isTargetCacheRequest(input)) return nativeFetch(input, init);

  const originalResponse = await nativeFetch(input, init);
  if (!originalResponse.ok) return originalResponse;

  try {
    const payload = await originalResponse.clone().json();
    const expanded = await expandPayload(payload);
    return new Response(JSON.stringify(expanded), {
      status: 200,
      statusText: "OK",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-exolight-catalogue-expansion": VERSION
      }
    });
  } catch (error) {
    console.warn("ExoLight catalogue expansion failed; returning local catalogue:", error);
    return originalResponse;
  }
};

window.__EXOLIGHT_CATALOGUE_EXPANSION__ = {
  version: VERSION,
  source: "NASA Exoplanet Archive TAP / PSCompPars",
  maxRemoteRows: MAX_REMOTE_ROWS
};
