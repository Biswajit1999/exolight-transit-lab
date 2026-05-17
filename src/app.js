import { ExoSceneRenderer } from "./scene.js?v=20260517-scene-worker-sync-03";

/* ============================================================================
   ExoIntel-Prime
   Research-grade Main Thread Orchestrator
   ============================================================================ */

const APP_NAME = "ExoIntel-Prime";
const WORKER_URL = new URL("./transitWorker.js?v=20260517-worker-eccentric-exposure-04", import.meta.url);
const TARGET_CACHE_URL = "./data/exoplanets.json";
const LIGHTCURVE_BASE_URL = "./data/lightcurves/";
const THEME_STORAGE_KEY = "exointel-prime-theme-v4";

const DEFAULT_PARAMS = Object.freeze({
  rpRs: 0.1,
  aRs: 12.0,
  inclinationDeg: 88.5,
  eccentricity: 0.0,
  omegaDeg: 90.0,

  u1: 0.32,
  u2: 0.28,

  spotEnabled: false,
  spotX: 0.2,
  spotY: 0.1,
  spotRadius: 0.12,
  spotContrast: 0.55,

  moonEnabled: false,
  moonRadius: 0.025,
  moonDistance: 0.55,
  moonPhaseDeg: 45,

  phaseShift: 0.0,

  exposureIntegration: true,
  exposureSamples: 5,
  exposurePhaseWidth: 0,

  visualQuality: "balanced",
  modelResolution: 720,
  fidelity: "preview"
});

const DEFAULT_TARGET = Object.freeze({
  id: "synthetic-hot-jupiter",
  pl_name: "Synthetic Hot Jupiter",
  hostname: "Demonstration Host",
  discoverymethod: "Transit",
  disc_year: null,

  pl_orbper: 3.0,
  pl_orblper: 90.0,
  pl_trandur: 2.4,
  pl_trandep: 10000,
  pl_ratror: 0.1,
  pl_orbsmax: null,
  pl_orbincl: 88.5,
  pl_orbeccen: 0.0,
  pl_bmassj: null,
  pl_bmasse: null,
  pl_radj: null,
  pl_rade: null,

  st_teff: 5772,
  st_rad: 1.0,
  st_mass: 1.0,
  st_logg: null,
  st_met: null,

  sy_snum: null,
  sy_pnum: null,

  lightcurve_available: false,
  lightcurve_file: ""
});

const HELP_TEXT = Object.freeze({
  ppm:
    "ppm means parts per million. 10,000 ppm equals a 1% brightness dip. Researchers use ppm because transit signals are often very small.",

  brightnessDip:
    "Brightness dip is the fractional loss of stellar light during transit. It is easier for general users than ppm. Example: 2.8% equals 28,000 ppm.",

  rpRsProxy:
    "Approximate radius-ratio proxy from depth: Rp/R★ ≈ sqrt(depth). This is only exact for a uniform star with no dilution or blending.",

  residualRms:
    "Residual RMS is the typical difference between archival data points and the theoretical model. Lower usually means the model follows the data better.",

  ootRms:
    "OOT RMS means out-of-transit RMS. It estimates the scatter when the planet is not passing in front of the star.",

  depthContrast:
    "Depth contrast is model depth divided by out-of-transit scatter. It is an intuitive quick-look metric, not a formal detection statistic.",

  modelDepth:
    "Model depth is the maximum brightness dip predicted by the current theoretical transit model.",

  moonSignal:
    "Moon signal is an optional hypothesis term. It does not claim a real exomoon; it only shows how an additional small occultor could affect the model.",

  spotBoost:
    "Spot boost is a starspot-crossing anomaly. If a planet crosses a darker stellar region, the measured flux can temporarily rise relative to a spotless model.",

  visualQuality:
    "Visual quality changes the WebGL scene only. It does not change the physics calculation. Use Ultra for screenshots and Balanced for normal work.",

  jsonContribution:
    "To test your own light curve, fork the GitHub repository, add your JSON file under data/lightcurves/, update data/exoplanets.json, and deploy your own fork or open a pull request.",

  eccentricity:
    "The eccentricity and argument of periastron are catalogue values. They are passed into the worker model when available, but kept read-only in this public interface to avoid unphysical manual combinations."
});

class ExoIntelPrimeApp {
  constructor() {
    this.root = document.getElementById("app") || document.body;
    this.worker = null;
    this.scene = null;

    this.currentRevision = 0;
    this.lastSentRevision = 0;
    this.pendingFrame = false;
    this.workerReady = false;

    this.targets = [];
    this.activeTarget = null;
    this.latestTarget = { ...DEFAULT_TARGET };
    this.latestParams = { ...DEFAULT_PARAMS };

    this.archivalCurve = {
      phase: new Float32Array(0),
      flux: new Float32Array(0),
      error: new Float32Array(0),
      source: "none",
      points: 0
    };

    this.latestModel = {
      phase: new Float32Array(0),
      flux: new Float32Array(0),
      revision: 0
    };

    this.metrics = {
      residualRmsPpm: null,
      ootRmsPpm: null,
      snr: null,
      phaseShift: null,
      modelDepthPpm: null,
      maxPlanetDepthPpm: null,
      maxMoonDepthPpm: null,
      maxSpotBoostPpm: null,
      morphologyFlags: ["waiting for physics engine"]
    };

    this.timings = {
      elapsedMs: null,
      samples: null,
      rings: null,
      azimuth: null,
      surfaceSamples: null
    };

    this.theme = this.readInitialTheme();
    this.dom = {};
    this.controlMap = new Map();
    this.resizeObserver = null;
    this.frameCounter = 0;
    this.fps = 0;
    this.lastFpsTime = performance.now();
  }

  async boot() {
    this.installDocumentShell();
    this.cacheDom();
    this.bindUi();
    this.syncControlOutputs();
    this.initWorker();
    this.initScene();
    this.startTelemetryLoop();

    await this.loadTargetCache();
    await this.selectInitialTarget();

    this.issueParameterRevision("initial boot");
    this.draw();
  }

  readInitialTheme() {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === "light" ? "light" : "dark";
  }

  installDocumentShell() {
    document.documentElement.lang = "en";
    document.title = `${APP_NAME} | Transit Photometry Laboratory`;

    const existingStyle = document.getElementById("exointel-dynamic-style");
    if (existingStyle) existingStyle.remove();

    const style = document.createElement("style");
    style.id = "exointel-dynamic-style";
    style.textContent = this.getCss();
    document.head.appendChild(style);

    this.root.className = `exointel-app theme-${this.theme}`;
    this.root.innerHTML = this.getHtml();
  }

  getCss() {
    return `
      :root{
        --font:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
        --mono:"SFMono-Regular","Cascadia Mono","Roboto Mono",Consolas,monospace;
      }

      *{box-sizing:border-box}

      html,body{
        width:100%;
        height:100%;
        margin:0;
        overflow:hidden;
        font-family:var(--font);
        font-size:14px;
        line-height:1.35;
      }

      button,input,textarea,select{font:inherit}
      button{cursor:pointer}

      .exointel-app{
        --bg:#f5f7fb;
        --bg-soft:#eef3f9;
        --surface:#ffffff;
        --surface-2:#f8fafc;
        --surface-3:#f1f6ff;
        --surface-glass:rgba(255,255,255,.92);
        --line:#d9e0ea;
        --line-strong:#b8c3d2;
        --text:#17202a;
        --muted:#637083;
        --muted-2:#8994a5;
        --accent:#1b64d8;
        --accent-2:#123f87;
        --model:#c47a00;
        --data:#176b87;
        --danger:#b42318;
        --ok:#0f7b4f;
        --warn:#9a6700;
        --shadow:0 16px 42px rgba(22,34,51,.10);
        --plot-bg:#ffffff;
        --grid:#d9e0ea;
        --scene-bg-a:#f9fbfe;
        --scene-bg-b:#edf2f8;

        width:100vw;
        height:100vh;
        display:grid;
        grid-template-rows:66px minmax(0,1fr) 34px;
        color:var(--text);
        background:
          radial-gradient(circle at 18% 0%,rgba(27,100,216,.075),transparent 34%),
          radial-gradient(circle at 82% 5%,rgba(196,122,0,.055),transparent 30%),
          linear-gradient(180deg,var(--bg) 0%,var(--bg-soft) 100%);
      }

      .exointel-app.theme-dark{
        --bg:#060b13;
        --bg-soft:#0b1220;
        --surface:#101827;
        --surface-2:#0d1524;
        --surface-3:#142033;
        --surface-glass:rgba(13,21,36,.92);
        --line:#243247;
        --line-strong:#40516b;
        --text:#edf4ff;
        --muted:#9ba9bd;
        --muted-2:#75859a;
        --accent:#63a7ff;
        --accent-2:#8fc0ff;
        --model:#ffb547;
        --data:#50c6df;
        --danger:#ff8a80;
        --ok:#6ee7b7;
        --warn:#facc15;
        --shadow:0 18px 48px rgba(0,0,0,.38);
        --plot-bg:#0b1220;
        --grid:#243247;
        --scene-bg-a:#08111f;
        --scene-bg-b:#030712;

        background:
          radial-gradient(circle at 20% -8%,rgba(99,167,255,.14),transparent 35%),
          radial-gradient(circle at 82% 0%,rgba(255,181,71,.08),transparent 30%),
          radial-gradient(circle at 50% 38%,rgba(80,198,223,.055),transparent 35%),
          linear-gradient(180deg,var(--bg) 0%,var(--bg-soft) 100%);
      }

      .app-header{
        display:grid;
        grid-template-columns:minmax(330px,1fr) minmax(440px,1.12fr) minmax(410px,.95fr);
        align-items:center;
        gap:14px;
        padding:9px 16px;
        border-bottom:1px solid var(--line);
        background:var(--surface-glass);
        backdrop-filter:blur(18px);
        z-index:10;
      }

      .brand{
        display:flex;
        align-items:center;
        gap:13px;
        min-width:0;
      }

      .brand-logo{
        width:50px;
        height:50px;
        flex:0 0 auto;
        filter:drop-shadow(0 12px 22px rgba(0,0,0,.22));
      }

      .brand h1{
        margin:0;
        font-size:16px;
        font-weight:950;
        letter-spacing:.01em;
      }

      .brand p{
        margin:2px 0 0;
        overflow:hidden;
        color:var(--muted);
        font-size:12px;
        white-space:nowrap;
        text-overflow:ellipsis;
      }

      .status-strip{
        display:grid;
        grid-template-columns:repeat(4,minmax(0,1fr));
        gap:8px;
      }

      .status-tile{
        min-width:0;
        padding:7px 9px;
        border:1px solid var(--line);
        border-radius:12px;
        background:linear-gradient(180deg,var(--surface),var(--surface-2));
      }

      .status-tile span{
        display:block;
        color:var(--muted);
        font-size:10px;
        font-weight:850;
        text-transform:uppercase;
        letter-spacing:.075em;
      }

      .status-tile strong{
        display:block;
        margin-top:2px;
        overflow:hidden;
        color:var(--text);
        font-size:12px;
        font-weight:900;
        white-space:nowrap;
        text-overflow:ellipsis;
      }

      .header-actions{
        display:flex;
        justify-content:flex-end;
        align-items:center;
        gap:8px;
        min-width:0;
      }

      .button{
        min-height:36px;
        padding:0 12px;
        border:1px solid var(--line-strong);
        border-radius:11px;
        background:var(--surface);
        color:var(--text);
        font-weight:820;
        font-size:12px;
        white-space:nowrap;
        transition:background .15s ease,border-color .15s ease,transform .15s ease;
      }

      .button:hover{
        background:var(--surface-3);
        border-color:var(--accent);
      }

      .button:active{transform:translateY(1px)}

      .button.primary{
        color:#160d00;
        border-color:var(--model);
        background:linear-gradient(180deg,#ffd38b,var(--model));
        box-shadow:0 8px 18px rgba(0,0,0,.14);
      }

      .theme-switch{
        display:inline-flex;
        align-items:center;
        gap:9px;
        min-height:36px;
        padding:0 10px;
        border:1px solid var(--line-strong);
        border-radius:999px;
        background:var(--surface);
        color:var(--text);
        user-select:none;
        cursor:pointer;
        white-space:nowrap;
      }

      .theme-switch input{
        position:absolute;
        opacity:0;
        pointer-events:none;
      }

      .theme-switch-track{
        position:relative;
        width:42px;
        height:22px;
        border-radius:999px;
        border:1px solid var(--line-strong);
        background:linear-gradient(180deg,#dbe6f6,#f8fafc);
        transition:background .18s ease,border-color .18s ease;
      }

      .theme-dark .theme-switch-track{
        background:linear-gradient(180deg,#17243a,#060b13);
        border-color:#40516b;
      }

      .theme-switch-thumb{
        position:absolute;
        top:2px;
        left:2px;
        width:16px;
        height:16px;
        border-radius:50%;
        background:#ffffff;
        box-shadow:0 2px 8px rgba(0,0,0,.25);
        transition:transform .18s ease,background .18s ease;
      }

      .theme-switch input:checked + .theme-switch-track .theme-switch-thumb{
        transform:translateX(20px);
        background:#ffb547;
      }

      .theme-switch-label{
        min-width:72px;
        color:var(--muted);
        font-size:12px;
        font-weight:850;
      }

      .workspace{
        min-height:0;
        display:grid;
        grid-template-columns:350px minmax(0,1fr) 380px;
        gap:14px;
        padding:14px;
        overflow:hidden;
      }

      .left-panel,.right-panel{
        min-height:0;
        display:grid;
        gap:12px;
        overflow:hidden;
      }

      .left-panel{
        grid-template-rows:250px minmax(0,1fr);
      }

      .right-panel{
        grid-template-rows:minmax(0,1fr);
      }

      .main-panel{
        min-height:0;
        display:grid;
        grid-template-rows:minmax(365px,1fr) 260px;
        gap:12px;
        overflow:hidden;
      }

      .card{
        min-height:0;
        border:1px solid var(--line);
        border-radius:18px;
        background:var(--surface-glass);
        box-shadow:var(--shadow);
        overflow:hidden;
      }

      .card-header{
        min-height:44px;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        padding:10px 14px;
        border-bottom:1px solid var(--line);
        background:linear-gradient(180deg,var(--surface),var(--surface-2));
      }

      .card-header h2{
        margin:0;
        font-size:13px;
        font-weight:950;
        letter-spacing:.01em;
      }

      .card-header span{
        overflow:hidden;
        color:var(--muted);
        font-size:11px;
        font-weight:700;
        white-space:nowrap;
        text-overflow:ellipsis;
      }

      .header-inline{
        display:flex;
        align-items:center;
        gap:8px;
      }

      .card-body{
        min-height:0;
        padding:14px;
      }

      .target-card{
        display:grid;
        grid-template-rows:44px minmax(0,1fr);
      }

      .target-body{
        min-height:0;
        display:grid;
        grid-template-rows:auto minmax(0,1fr);
      }

      .target-search{
        width:100%;
        min-height:38px;
        padding:0 12px;
        border:1px solid var(--line);
        border-radius:12px;
        background:var(--surface);
        color:var(--text);
        outline:none;
      }

      .target-search::placeholder{color:var(--muted-2)}

      .target-search:focus{
        border-color:var(--accent);
        box-shadow:0 0 0 3px rgba(99,167,255,.16);
      }

      .target-list{
        min-height:0;
        overflow:auto;
        margin-top:10px;
        display:flex;
        flex-direction:column;
        gap:6px;
        padding-right:2px;
      }

      .target-row{
        width:100%;
        display:grid;
        grid-template-columns:minmax(0,1fr) auto;
        gap:8px;
        align-items:center;
        padding:8px 9px;
        border:1px solid var(--line);
        border-radius:12px;
        background:var(--surface);
        color:var(--text);
        text-align:left;
      }

      .target-row:hover{
        border-color:var(--accent);
        background:var(--surface-3);
      }

      .target-row.active{
        border-color:var(--accent);
        background:var(--surface-3);
        box-shadow:inset 3px 0 0 var(--accent);
      }

      .target-row strong{
        display:block;
        overflow:hidden;
        font-size:12px;
        white-space:nowrap;
        text-overflow:ellipsis;
      }

      .target-row span{
        display:block;
        overflow:hidden;
        margin-top:2px;
        color:var(--muted);
        font-size:11px;
        white-space:nowrap;
        text-overflow:ellipsis;
      }

      .pill{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        min-height:22px;
        padding:0 8px;
        border-radius:999px;
        border:1px solid var(--line);
        color:var(--muted);
        background:var(--surface);
        font-size:10px;
        font-weight:900;
        letter-spacing:.025em;
        text-transform:uppercase;
      }

      .pill.ok{color:var(--ok);border-color:var(--ok)}
      .pill.warn{color:var(--warn);border-color:var(--warn)}
      .pill.danger{color:var(--danger);border-color:var(--danger)}

      .science-card{
        display:grid;
        grid-template-rows:44px minmax(0,1fr);
      }

      .science-scroll{
        min-height:0;
        overflow:auto;
        padding:14px;
      }

      .section-title{
        margin:0 0 8px;
        color:var(--muted);
        font-size:10px;
        font-weight:950;
        letter-spacing:.10em;
        text-transform:uppercase;
      }

      .readout-grid{
        display:grid;
        grid-template-columns:repeat(2,minmax(0,1fr));
        gap:10px;
        margin-bottom:14px;
      }

      .readout{
        min-height:82px;
        padding:11px;
        border:1px solid var(--line);
        border-radius:14px;
        background:var(--surface);
      }

      .readout.wide{
        grid-column:1 / -1;
      }

      .readout span{
        display:flex;
        align-items:center;
        gap:6px;
        color:var(--muted);
        font-size:10px;
        font-weight:900;
        letter-spacing:.075em;
        text-transform:uppercase;
      }

      .readout strong{
        display:block;
        margin-top:8px;
        font-family:var(--mono);
        font-size:17px;
        font-weight:950;
      }

      .readout small{
        display:block;
        margin-top:3px;
        color:var(--muted-2);
        font-size:11px;
      }

      .property-grid{
        display:grid;
        grid-template-columns:repeat(2,minmax(0,1fr));
        gap:8px;
        margin-bottom:14px;
      }

      .property{
        min-height:54px;
        padding:9px 10px;
        border:1px solid var(--line);
        border-radius:12px;
        background:var(--surface);
      }

      .property span{
        display:block;
        color:var(--muted);
        font-size:10px;
        font-weight:850;
        letter-spacing:.06em;
        text-transform:uppercase;
      }

      .property strong{
        display:block;
        margin-top:5px;
        color:var(--text);
        font-family:var(--mono);
        font-size:13px;
      }

      .help{
        position:relative;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        width:16px;
        height:16px;
        border-radius:999px;
        border:1px solid var(--line-strong);
        color:var(--muted);
        background:var(--surface-2);
        font-size:10px;
        font-weight:900;
        cursor:help;
        text-transform:none;
        letter-spacing:0;
        flex:0 0 auto;
      }

      .help-content{
        position:absolute;
        left:50%;
        bottom:calc(100% + 9px);
        z-index:100;
        width:280px;
        transform:translateX(-50%) translateY(4px);
        opacity:0;
        pointer-events:none;
        padding:10px 11px;
        border:1px solid var(--line-strong);
        border-radius:12px;
        background:var(--surface);
        color:var(--text);
        box-shadow:var(--shadow);
        font-size:12px;
        font-weight:600;
        line-height:1.42;
        text-transform:none;
        letter-spacing:0;
        transition:opacity .12s ease,transform .12s ease;
      }

      .help:hover .help-content,
      .help:focus .help-content,
      .help:focus-within .help-content{
        opacity:1;
        transform:translateX(-50%) translateY(0);
      }

      .scene-panel{
        min-height:0;
        display:grid;
        grid-template-rows:44px minmax(0,1fr);
      }

      .scene-stage{
        min-height:0;
        position:relative;
        background:
          radial-gradient(circle at 50% 42%,rgba(255,181,71,.16),transparent 31%),
          radial-gradient(circle at 18% 12%,rgba(99,167,255,.12),transparent 25%),
          radial-gradient(circle at 88% 8%,rgba(80,198,223,.06),transparent 30%),
          linear-gradient(180deg,var(--scene-bg-a),var(--scene-bg-b));
      }

      .plot-card{
        position:relative;
        display:grid;
        grid-template-rows:44px minmax(0,1fr) 34px;
      }

      .plot-wrap{
        position:relative;
        min-height:0;
        padding:0;
        background:var(--plot-bg);
      }

      .plot-canvas{
        width:100%;
        height:100%;
        display:block;
      }

      .assumption-strip{
        min-height:34px;
        display:flex;
        align-items:center;
        gap:6px;
        overflow:hidden;
        padding:5px 12px;
        border-top:1px solid var(--line);
        background:linear-gradient(180deg,var(--surface),var(--surface-2));
      }

      .assumption-strip .pill{
        flex:0 0 auto;
      }

      .control-card{
        display:grid;
        grid-template-rows:44px minmax(0,1fr);
      }

      .control-list{
        min-height:0;
        overflow:auto;
        display:grid;
        gap:12px;
        padding:14px;
      }

      .control-group{
        padding:12px;
        border:1px solid var(--line);
        border-radius:16px;
        background:var(--surface);
      }

      .control-group h3{
        margin:0 0 10px;
        color:var(--text);
        font-size:12px;
        font-weight:950;
      }

      .control-row,.toggle-row,.select-row{
        display:grid;
        grid-template-columns:132px minmax(0,1fr) 78px;
        gap:10px;
        align-items:center;
        min-height:34px;
      }

      .select-row{
        grid-template-columns:132px minmax(0,1fr) 22px;
      }

      .control-row + .control-row,
      .toggle-row + .toggle-row,
      .select-row + .select-row{
        margin-top:8px;
      }

      .control-row label,.toggle-row label,.select-row label{
        color:var(--muted);
        font-size:12px;
      }

      .control-row output,.toggle-row output{
        color:var(--text);
        font-family:var(--mono);
        font-size:12px;
        text-align:right;
      }

      .disabled-note{
        margin-top:8px;
        color:var(--warn);
        font-size:11px;
        line-height:1.35;
      }

      input[type="range"]{
        width:100%;
        accent-color:var(--accent);
      }

      input[type="checkbox"]{
        width:18px;
        height:18px;
        accent-color:var(--accent);
      }

      select{
        width:100%;
        min-height:34px;
        border:1px solid var(--line-strong);
        border-radius:10px;
        padding:0 10px;
        background:var(--surface-2);
        color:var(--text);
        outline:none;
      }

      select:focus{
        border-color:var(--accent);
        box-shadow:0 0 0 3px rgba(99,167,255,.16);
      }

      .app-footer{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
        padding:0 16px;
        border-top:1px solid var(--line);
        background:var(--surface-glass);
        color:var(--muted);
        font-size:11px;
      }

      .app-footer strong{
        color:var(--text);
        font-weight:950;
      }

      .footer-credit{white-space:nowrap}

      .footer-status{
        overflow:hidden;
        white-space:nowrap;
        text-overflow:ellipsis;
        text-align:right;
      }

      *{
        scrollbar-width:thin;
        scrollbar-color:var(--line-strong) transparent;
      }

      *::-webkit-scrollbar{width:10px;height:10px}
      *::-webkit-scrollbar-track{background:transparent}
      *::-webkit-scrollbar-thumb{
        border:3px solid transparent;
        border-radius:999px;
        background:var(--line-strong);
        background-clip:padding-box;
      }

      @media (max-width:1420px){
        .workspace{grid-template-columns:330px minmax(0,1fr) 350px}
        .control-row,.toggle-row,.select-row{grid-template-columns:120px minmax(0,1fr) 62px}
        .select-row{grid-template-columns:120px minmax(0,1fr) 22px}
      }

      @media (max-width:1180px){
        html,body{overflow:auto}

        .exointel-app{
          height:auto;
          min-height:100vh;
          grid-template-rows:auto auto auto;
        }

        .app-header,.workspace{grid-template-columns:1fr}
        .workspace{overflow:visible}
        .left-panel,.right-panel,.main-panel{overflow:visible}
        .left-panel{grid-template-rows:auto auto}
        .main-panel{grid-template-rows:440px 320px}
        .status-strip{grid-template-columns:repeat(2,minmax(0,1fr))}
        .header-actions{justify-content:flex-start;flex-wrap:wrap}

        .app-footer{
          flex-direction:column;
          align-items:flex-start;
          min-height:54px;
          padding:8px 16px;
        }

        .footer-status{
          text-align:left;
          white-space:normal;
        }
      }
    `;
  }

  getHtml() {
    return `
      <header class="app-header">
        <section class="brand">
          ${transitLogoSvg()}
          <div>
            <h1>ExoIntel-Prime</h1>
            <p>Interactive exoplanet transit modelling with archival photometry overlays</p>
          </div>
        </section>

        <section class="status-strip" aria-label="Application state">
          <div class="status-tile">
            <span>Physics engine</span>
            <strong id="status-worker">initialising</strong>
          </div>
          <div class="status-tile">
            <span>Model iteration</span>
            <strong id="status-revision">0</strong>
          </div>
          <div class="status-tile">
            <span>Transit solver</span>
            <strong id="status-solver">idle</strong>
          </div>
          <div class="status-tile">
            <span>Frame rate</span>
            <strong id="status-fps">-- fps</strong>
          </div>
        </section>

        <section class="header-actions">
          <label class="theme-switch" title="Toggle light and night mode">
            <input id="button-theme" type="checkbox" ${this.theme === "dark" ? "checked" : ""} aria-label="Toggle night mode" />
            <span class="theme-switch-track"><span class="theme-switch-thumb"></span></span>
            <span id="theme-switch-label" class="theme-switch-label">${this.theme === "dark" ? "Night mode" : "Light mode"}</span>
          </label>

          <button class="button" id="button-reset" type="button">Reset model</button>
          <button class="button primary" id="button-high-fidelity" type="button">High-accuracy model</button>
        </section>
      </header>

      <section class="workspace">
        <aside class="left-panel">
          <section class="card target-card">
            <div class="card-header">
              <h2>Target archive</h2>
              <div class="header-inline">
                <span id="target-count">loading</span>
                ${help("jsonContribution")}
              </div>
            </div>
            <div class="card-body target-body">
              <input id="target-search" class="target-search" type="search" placeholder="Search planet, host star, observed data..." />
              <div id="target-list" class="target-list"></div>
            </div>
          </section>

          <section class="card science-card">
            <div class="card-header">
              <h2>Scientific readout</h2>
              <span id="active-target-label">no target</span>
            </div>

            <div class="science-scroll">
              <p class="section-title">Transit observables</p>
              <div class="readout-grid">
                <div class="readout wide">
                  <span>Brightness dip ${help("brightnessDip")}</span>
                  <strong id="metric-depth-percent">—</strong>
                  <small id="metric-depth-secondary">model depth</small>
                </div>

                <div class="readout">
                  <span>Radius proxy ${help("rpRsProxy")}</span>
                  <strong id="metric-rprs-proxy">—</strong>
                  <small>sqrt(depth), approximate</small>
                </div>

                <div class="readout">
                  <span>Depth contrast ${help("depthContrast")}</span>
                  <strong id="metric-snr">—</strong>
                  <small>depth / baseline scatter</small>
                </div>

                <div class="readout">
                  <span>Residual RMS ${help("residualRms")}</span>
                  <strong id="metric-residual-rms">—</strong>
                  <small>data minus model</small>
                </div>

                <div class="readout">
                  <span>OOT RMS ${help("ootRms")}</span>
                  <strong id="metric-oot-rms">—</strong>
                  <small>out-of-transit scatter</small>
                </div>

                <div class="readout">
                  <span>Moon signal ${help("moonSignal")}</span>
                  <strong id="metric-moon">—</strong>
                  <small>hypothesis only</small>
                </div>

                <div class="readout">
                  <span>Spot boost ${help("spotBoost")}</span>
                  <strong id="metric-spot">—</strong>
                  <small>spot anomaly</small>
                </div>
              </div>

              <p class="section-title">Planet parameters</p>
              <div id="planet-properties" class="property-grid"></div>

              <p class="section-title">Host star parameters</p>
              <div id="star-properties" class="property-grid"></div>

              <p class="section-title">Catalogue / provenance</p>
              <div id="catalogue-properties" class="property-grid"></div>
            </div>
          </section>
        </aside>

        <main class="main-panel">
          <section class="card scene-panel">
            <div class="card-header">
              <h2>CGI theoretical model viewport</h2>
              <span id="scene-status">mounting renderer</span>
            </div>
            <div id="scene-stage" class="scene-stage"></div>
          </section>

          <section class="card plot-card">
            <div class="card-header">
              <h2>Archival photometry versus theoretical model</h2>
              <span id="plot-status">waiting for model</span>
            </div>
            <div class="plot-wrap">
              <canvas id="curve-canvas" class="plot-canvas"></canvas>
            </div>
            <div id="assumption-strip" class="assumption-strip"></div>
          </section>
        </main>

        <aside class="right-panel">
          <section class="card control-card">
            <div class="card-header">
              <h2>Model controls</h2>
              <span>live what-if physics</span>
            </div>

            <div class="control-list" id="control-list">
              <div class="control-group">
                <h3>Rendering</h3>
                ${selectControl("visualQuality", "Visual quality", [["low", "Low"], ["balanced", "Balanced"], ["ultra", "Ultra"]], this.latestParams.visualQuality, "visualQuality")}
              </div>

              <div class="control-group">
                <h3>Planet and orbit</h3>
                ${rangeControl("rpRs", "Radius ratio Rp/R★", 0.01, 0.25, 0.001, this.latestParams.rpRs, 3)}
                ${rangeControl("aRs", "Scaled distance a/R★", 2, 60, 0.1, this.latestParams.aRs, 1)}
                ${rangeControl("inclinationDeg", "Inclination", 75, 90, 0.01, this.latestParams.inclinationDeg, 2, "°")}
                ${readonlyControl("eccentricity-display", "Catalogue eccentricity", "—", "eccentricity")}
                <div class="disabled-note">Eccentricity and ω are read from the catalogue and passed to the worker model when available. They are kept read-only here to avoid unphysical manual combinations.</div>
              </div>

              <div class="control-group">
                <h3>Stellar atmosphere</h3>
                ${rangeControl("u1", "Quadratic limb u1", 0, 1, 0.01, this.latestParams.u1, 2)}
                ${rangeControl("u2", "Quadratic limb u2", 0, 1, 0.01, this.latestParams.u2, 2)}
              </div>

              <div class="control-group">
                <h3>Starspot morphology</h3>
                ${toggleControl("spotEnabled", "Enable starspot", this.latestParams.spotEnabled)}
                ${rangeControl("spotX", "Spot x-position", -0.9, 0.9, 0.01, this.latestParams.spotX, 2)}
                ${rangeControl("spotY", "Spot y-position", -0.9, 0.9, 0.01, this.latestParams.spotY, 2)}
                ${rangeControl("spotRadius", "Spot radius", 0.02, 0.3, 0.005, this.latestParams.spotRadius, 3)}
                ${rangeControl("spotContrast", "Spot contrast", 0.05, 0.95, 0.01, this.latestParams.spotContrast, 2)}
              </div>

              <div class="control-group">
                <h3>Exomoon hypothesis</h3>
                ${toggleControl("moonEnabled", "Enable exomoon", this.latestParams.moonEnabled)}
                ${rangeControl("moonRadius", "Moon radius", 0.004, 0.08, 0.001, this.latestParams.moonRadius, 3)}
                ${rangeControl("moonDistance", "Moon distance", 0.05, 2.5, 0.01, this.latestParams.moonDistance, 2)}
                ${rangeControl("moonPhaseDeg", "Moon phase", 0, 360, 1, this.latestParams.moonPhaseDeg, 0, "°")}
              </div>

              <div class="control-group">
                <h3>Model alignment</h3>
                ${rangeControl("phaseShift", "Phase shift", -0.05, 0.05, 0.0005, this.latestParams.phaseShift, 4)}
              </div>
            </div>
          </section>
        </aside>
      </section>

      <footer class="app-footer">
        <span class="footer-credit"><strong>Author: Biswajit Jana</strong> // © 2026</span>
        <span id="footer-message" class="footer-status">Initialising physics engine...</span>
      </footer>
    `;
  }

  cacheDom() {
    this.dom.workerStatus = document.getElementById("status-worker");
    this.dom.revisionStatus = document.getElementById("status-revision");
    this.dom.solverStatus = document.getElementById("status-solver");
    this.dom.fpsStatus = document.getElementById("status-fps");
    this.dom.footerMessage = document.getElementById("footer-message");

    this.dom.sceneStage = document.getElementById("scene-stage");
    this.dom.sceneStatus = document.getElementById("scene-status");

    this.dom.targetSearch = document.getElementById("target-search");
    this.dom.targetList = document.getElementById("target-list");
    this.dom.targetCount = document.getElementById("target-count");
    this.dom.activeTargetLabel = document.getElementById("active-target-label");

    this.dom.metricDepthPercent = document.getElementById("metric-depth-percent");
    this.dom.metricDepthSecondary = document.getElementById("metric-depth-secondary");
    this.dom.metricRpRsProxy = document.getElementById("metric-rprs-proxy");
    this.dom.metricResidual = document.getElementById("metric-residual-rms");
    this.dom.metricOot = document.getElementById("metric-oot-rms");
    this.dom.metricSnr = document.getElementById("metric-snr");
    this.dom.metricMoon = document.getElementById("metric-moon");
    this.dom.metricSpot = document.getElementById("metric-spot");

    this.dom.planetProperties = document.getElementById("planet-properties");
    this.dom.starProperties = document.getElementById("star-properties");
    this.dom.catalogueProperties = document.getElementById("catalogue-properties");
    this.dom.assumptionStrip = document.getElementById("assumption-strip");

    this.dom.plotStatus = document.getElementById("plot-status");
    this.dom.canvas = document.getElementById("curve-canvas");
    this.dom.ctx = this.dom.canvas.getContext("2d");

    this.dom.themeButton = document.getElementById("button-theme");
    this.dom.resetButton = document.getElementById("button-reset");
    this.dom.highFidelityButton = document.getElementById("button-high-fidelity");

    const inputs = Array.from(document.querySelectorAll("[data-param]"));
    for (const input of inputs) this.controlMap.set(input.dataset.param, input);

    this.resizeObserver = new ResizeObserver(() => this.draw());
    this.resizeObserver.observe(this.dom.canvas);
  }

  bindUi() {
    for (const [key, input] of this.controlMap) {
      const eventName = input.type === "checkbox" || input.tagName === "SELECT" ? "change" : "input";

      input.addEventListener(eventName, () => {
        this.syncParamsFromControls();
        this.syncControlOutputs();
        this.updateScene();
        this.issueParameterRevision(`control:${key}`);
      });
    }

    this.dom.themeButton.addEventListener("change", () => this.toggleTheme());

    this.dom.resetButton.addEventListener("click", () => {
      const previousQuality = this.latestParams.visualQuality || "balanced";
      this.latestParams = { ...DEFAULT_PARAMS, visualQuality: previousQuality };
      this.syncControlsFromParams();
      this.syncControlOutputs();
      this.updateSciencePanels();
      this.updateScene();
      this.issueParameterRevision("reset");
      this.setFriendlyStatus("Model controls reset to default theoretical parameters.");
    });

    this.dom.highFidelityButton.addEventListener("click", () => {
      this.latestParams = { ...this.latestParams, fidelity: "full", modelResolution: 1440 };
      this.setFriendlyStatus("High-accuracy model requested. The interface remains responsive while the physics engine recalculates.");
      this.issueParameterRevision("high-accuracy");
    });

    this.dom.targetSearch.addEventListener("input", () => this.renderTargetList(this.dom.targetSearch.value));
  }

  toggleTheme() {
    const wantsDark = Boolean(this.dom.themeButton.checked);
    this.theme = wantsDark ? "dark" : "light";
    localStorage.setItem(THEME_STORAGE_KEY, this.theme);

    this.root.classList.toggle("theme-dark", this.theme === "dark");
    this.root.classList.toggle("theme-light", this.theme === "light");

    const label = document.getElementById("theme-switch-label");
    if (label) label.textContent = this.theme === "dark" ? "Night mode" : "Light mode";

    this.draw();
    this.setFriendlyStatus(`${this.theme === "dark" ? "Night" : "Light"} mode enabled.`);
  }

  initWorker() {
    try {
      this.worker = new Worker(WORKER_URL, { type: "module", name: "ExoIntelTransitWorker" });
    } catch (error) {
      this.setWorkerFailed(`Physics engine could not be constructed: ${error.message}`);
      return;
    }

    this.worker.addEventListener("message", event => this.handleWorkerMessage(event.data));
    this.worker.addEventListener("error", event => this.setWorkerFailed(`Physics engine error: ${event.message || "unknown error"}`));
    this.worker.addEventListener("messageerror", () => this.setWorkerFailed("Physics engine message could not be read."));

    this.postToWorker({ type: "configure", appName: APP_NAME, protocol: "latest-state-mailbox-v2" });
    this.setText(this.dom.workerStatus, "starting");
  }

  initScene() {
    this.scene = new ExoSceneRenderer({
      container: this.dom.sceneStage,
      onStatus: message => this.setText(this.dom.sceneStatus, message),
      onWarning: message => this.setText(this.dom.sceneStatus, message)
    });

    this.scene.mount();
    this.updateScene();
  }

  updateScene() {
    if (!this.scene) return;

    this.scene.updateState({
      params: this.latestParams,
      target: this.latestTarget,
      model: this.latestModel
    });
  }

  handleWorkerMessage(message) {
    if (!message || typeof message !== "object") return;

    if (message.type === "ready") {
      this.workerReady = true;
      this.setText(this.dom.workerStatus, "ready");
      this.setFriendlyStatus("Physics engine ready. Parameter changes update the theoretical model off the main thread.");
      this.sendWorkerDataContext();
      this.issueParameterRevision("engine-ready");
      return;
    }

    if (message.type === "data-ready") {
      this.setFriendlyStatus(`Archival light curve loaded into the physics engine: ${Number(message.points || 0).toLocaleString("en-GB")} samples.`);
      return;
    }

    if (message.type === "accepted") {
      this.setText(this.dom.solverStatus, `calculating model ${message.revision}`);
      return;
    }

    if (message.type === "obsolete") {
      if (message.revision >= this.lastSentRevision) this.setText(this.dom.solverStatus, "updating latest model");
      return;
    }

    if (message.type === "progress") {
      if (message.revision === this.currentRevision) {
        this.setText(this.dom.solverStatus, `calculating ${Math.round(message.progress * 100)}%`);
      }
      return;
    }

    if (message.type === "result") {
      this.handleWorkerResult(message);
      return;
    }

    if (message.type === "warning") {
      this.setFriendlyStatus(message.message || "Physics engine warning.");
      return;
    }

    if (message.type === "error") {
      this.setText(this.dom.solverStatus, "engine error");
      this.setFriendlyStatus(message.message || "Physics engine reported an error.");
    }
  }

  handleWorkerResult(message) {
    if (!Number.isFinite(message.revision)) return;
    if (message.revision < this.currentRevision) return;

    const phase = message.phaseBuffer instanceof ArrayBuffer ? new Float32Array(message.phaseBuffer) : new Float32Array(0);
    const flux = message.fluxBuffer instanceof ArrayBuffer ? new Float32Array(message.fluxBuffer) : new Float32Array(0);

    this.latestModel = { phase, flux, revision: message.revision };

    this.metrics = {
      residualRmsPpm: finiteOrNull(message.metrics?.residualRmsPpm),
      ootRmsPpm: finiteOrNull(message.metrics?.ootRmsPpm),
      snr: finiteOrNull(message.metrics?.snr),
      phaseShift: finiteOrNull(message.metrics?.phaseShift),
      modelDepthPpm: finiteOrNull(message.metrics?.modelDepthPpm),
      maxPlanetDepthPpm: finiteOrNull(message.metrics?.maxPlanetDepthPpm),
      maxMoonDepthPpm: finiteOrNull(message.metrics?.maxMoonDepthPpm),
      maxSpotBoostPpm: finiteOrNull(message.metrics?.maxSpotBoostPpm),
      morphologyFlags: Array.isArray(message.metrics?.morphologyFlags) ? message.metrics.morphologyFlags : []
    };

    this.timings = {
      elapsedMs: finiteOrNull(message.timings?.elapsedMs),
      samples: finiteOrNull(message.timings?.samples),
      rings: finiteOrNull(message.timings?.rings),
      azimuth: finiteOrNull(message.timings?.azimuth),
      surfaceSamples: finiteOrNull(message.timings?.surfaceSamples)
    };

    this.setText(this.dom.solverStatus, "model ready");
    this.setText(this.dom.revisionStatus, String(message.revision));

    this.setText(
      this.dom.plotStatus,
      `${message.mode || "theoretical model"} · ${phase.length.toLocaleString("en-GB")} phase samples`
    );

    this.setFriendlyStatus("Theoretical model updated. Archival data remain fixed; only the model curve changed.");

    this.renderMetrics();
    this.updateSciencePanels();
    this.updateAssumptionStrip();
    this.updateScene();
    this.draw();
  }

  postToWorker(payload, transfer = []) {
    if (!this.worker) return;

    try {
      this.worker.postMessage(payload, transfer);
    } catch (error) {
      this.setWorkerFailed(`Message to physics engine failed: ${error.message}`);
    }
  }

  sendWorkerDataContext() {
    if (!this.workerReady) return;

    const phaseBuffer = this.archivalCurve.phase.slice().buffer;
    const fluxBuffer = this.archivalCurve.flux.slice().buffer;
    const errorBuffer = this.archivalCurve.error.slice().buffer;

    this.postToWorker(
      {
        type: "data",
        target: serialiseTarget(this.latestTarget),
        archival: {
          phaseBuffer,
          fluxBuffer,
          errorBuffer,
          points: this.archivalCurve.points,
          source: this.archivalCurve.source
        }
      },
      [phaseBuffer, fluxBuffer, errorBuffer]
    );
  }

  issueParameterRevision(reason) {
    this.currentRevision += 1;
    this.latestParams = { ...this.latestParams, reason, issuedAt: performance.now() };
    this.setText(this.dom.revisionStatus, String(this.currentRevision));

    if (!this.pendingFrame) {
      this.pendingFrame = true;

      requestAnimationFrame(() => {
        this.pendingFrame = false;
        this.flushLatestSnapshotToWorker();
      });
    }
  }

  flushLatestSnapshotToWorker() {
    if (!this.workerReady) {
      this.setText(this.dom.solverStatus, "waiting for engine");
      return;
    }

    const revision = this.currentRevision;
    const snapshot = {
      ...this.latestParams,
      fidelity: this.latestParams.fidelity === "full" ? "full" : "preview"
    };

    this.lastSentRevision = revision;
    this.setText(this.dom.solverStatus, `queued model ${revision}`);

    this.postToWorker({
      type: "solve",
      revision,
      target: serialiseTarget(this.latestTarget),
      params: snapshot
    });
  }

  syncParamsFromControls() {
    const next = { ...this.latestParams };

    for (const [key, input] of this.controlMap) {
      if (input.type === "checkbox") next[key] = input.checked;
      else if (input.tagName === "SELECT") next[key] = input.value;
      else next[key] = Number(input.value);
    }

    next.fidelity = "preview";
    next.modelResolution = 720;
    next.eccentricity = clamp(numberValue(this.latestTarget.pl_orbeccen, 0), 0, 0.95);
    next.omegaDeg = normaliseDegrees(numberValue(this.latestTarget.pl_orblper, 90));

    this.latestParams = next;
  }

  syncControlsFromParams() {
    for (const [key, input] of this.controlMap) {
      const value = this.latestParams[key];

      if (input.type === "checkbox") input.checked = Boolean(value);
      else if (input.tagName === "SELECT") input.value = String(value);
      else if (value !== undefined) input.value = String(value);
    }
  }

  syncControlOutputs() {
    const p = this.latestParams;

    this.output("rpRs", p.rpRs, 3);
    this.output("aRs", p.aRs, 1);
    this.output("inclinationDeg", `${formatNumber(p.inclinationDeg, 2)}°`);
    this.output("u1", p.u1, 2);
    this.output("u2", p.u2, 2);
    this.output("spotEnabled", p.spotEnabled ? "on" : "off");
    this.output("spotX", p.spotX, 2);
    this.output("spotY", p.spotY, 2);
    this.output("spotRadius", p.spotRadius, 3);
    this.output("spotContrast", p.spotContrast, 2);
    this.output("moonEnabled", p.moonEnabled ? "on" : "off");
    this.output("moonRadius", p.moonRadius, 3);
    this.output("moonDistance", p.moonDistance, 2);
    this.output("moonPhaseDeg", `${Math.round(p.moonPhaseDeg)}°`);
    this.output("phaseShift", p.phaseShift, 4);

    const eccNode = document.getElementById("eccentricity-display-value");
    if (eccNode) eccNode.textContent = formatMaybe(this.latestTarget.pl_orbeccen, 3);
  }

  output(key, value, digits = null) {
    const node = document.getElementById(`out-${key}`);
    if (!node) return;

    if (typeof value === "number" && digits !== null) node.textContent = formatNumber(value, digits);
    else node.textContent = String(value);
  }

  async loadTargetCache() {
    try {
      const response = await fetch(`${TARGET_CACHE_URL}?v=${Date.now()}`, {
        cache: "no-store",
        headers: { Accept: "application/json" }
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = await response.json();
      const rows = Array.isArray(payload) ? payload : Array.isArray(payload.targets) ? payload.targets : [];

      this.targets = rows.map(normaliseTarget).filter(Boolean);
      if (!this.targets.length) this.targets = [normaliseTarget(DEFAULT_TARGET)];

      this.renderTargetList("");
    } catch (error) {
      this.targets = [normaliseTarget(DEFAULT_TARGET)];
      this.renderTargetList("");
      this.setFriendlyStatus(`Target cache fallback active: ${error.message}`);
    }
  }

  renderTargetList(query) {
    const clean = String(query || "").trim().toLowerCase();

    const filtered = this.targets.filter(target => {
      if (!clean) return true;

      const haystack = [
        target.pl_name,
        target.hostname,
        target.discoverymethod,
        target.lightcurve_available ? "observed photometry real lightcurve lc data" : "model only",
        target.lightcurve_file
      ].join(" ").toLowerCase();

      return clean.split(/\s+/).every(token => haystack.includes(token));
    }).slice(0, 120);

    this.setText(this.dom.targetCount, `${filtered.length}/${this.targets.length}`);

    const fragment = document.createDocumentFragment();

    for (const target of filtered) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "target-row";
      button.dataset.id = target.id;

      if (this.activeTarget?.id === target.id) button.classList.add("active");

      const textWrap = document.createElement("div");
      const title = document.createElement("strong");
      const meta = document.createElement("span");
      const badge = document.createElement("i");

      title.textContent = target.pl_name;
      meta.textContent = `${target.hostname} · ${formatMaybe(target.pl_orbper, 3)} d · ${formatMaybe(target.pl_trandep, 0)} ppm`;
      badge.className = target.lightcurve_available ? "pill ok" : "pill warn";
      badge.textContent = target.lightcurve_available ? "observed" : "model";

      textWrap.append(title, meta);
      button.append(textWrap, badge);
      button.addEventListener("click", () => this.selectTarget(target));
      fragment.appendChild(button);
    }

    this.dom.targetList.replaceChildren(fragment);
  }

  async selectInitialTarget() {
    const preferred =
      this.targets.find(target => target.lightcurve_available) ||
      this.targets[0] ||
      normaliseTarget(DEFAULT_TARGET);

    await this.selectTarget(preferred);
  }

  async selectTarget(target) {
    this.activeTarget = target;
    this.latestTarget = target;

    this.setText(this.dom.activeTargetLabel, `${target.pl_name} · ${target.hostname}`);
    this.renderTargetList(this.dom.targetSearch.value);

    const previousQuality = this.latestParams.visualQuality || "balanced";
    this.latestParams = {
      ...targetToParams(target, this.latestParams),
      visualQuality: previousQuality
    };

    this.syncControlsFromParams();
    this.syncControlOutputs();
    this.updateSciencePanels();
    this.updateScene();

    await this.loadArchivalLightCurve(target);
    this.sendWorkerDataContext();

    this.issueParameterRevision("target-change");
    this.draw();

    this.setFriendlyStatus(`Target locked: ${target.pl_name} around ${target.hostname}.`);
  }

  async loadArchivalLightCurve(target) {
    if (!target.lightcurve_available || !target.lightcurve_file) {
      this.archivalCurve = generateSyntheticArchive(target, this.latestParams);
      return;
    }

    try {
      const safeFile = encodeURIComponent(target.lightcurve_file).replace(/%2F/g, "/");
      const response = await fetch(`${LIGHTCURVE_BASE_URL}${safeFile}?v=${Date.now()}`, {
        cache: "no-store",
        headers: { Accept: "application/json" }
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = await response.json();
      this.archivalCurve = normaliseLightCurvePayload(payload);

      if (this.archivalCurve.points < 10) {
        this.archivalCurve = generateSyntheticArchive(target, this.latestParams);
      }
    } catch (error) {
      this.archivalCurve = generateSyntheticArchive(target, this.latestParams);
      this.setFriendlyStatus(`Observed curve unavailable for ${target.pl_name}; synthetic demonstration data shown.`);
    }
  }

  renderMetrics() {
    const depthPpm = this.metrics.modelDepthPpm;
    const depthPercent = Number.isFinite(depthPpm) ? depthPpm / 10000 : null;
    const rprsProxy = Number.isFinite(depthPpm) ? Math.sqrt(depthPpm / 1e6) : null;

    this.setText(this.dom.metricDepthPercent, depthPercent === null ? "—" : `${formatNumber(depthPercent, 3)} %`);
    this.setText(this.dom.metricDepthSecondary, depthPpm === null ? "model depth" : `${formatPpm(depthPpm)} · flux loss`);
    this.setText(this.dom.metricRpRsProxy, rprsProxy === null ? "—" : formatNumber(rprsProxy, 4));

    this.setText(this.dom.metricResidual, formatPpm(this.metrics.residualRmsPpm));
    this.setText(this.dom.metricOot, formatPpm(this.metrics.ootRmsPpm));
    this.setText(this.dom.metricSnr, this.metrics.snr === null ? "—" : formatNumber(this.metrics.snr, 2));
    this.setText(this.dom.metricMoon, formatPpm(this.metrics.maxMoonDepthPpm));
    this.setText(this.dom.metricSpot, formatPpm(this.metrics.maxSpotBoostPpm));
  }

  updateSciencePanels() {
    const t = this.latestTarget;

    this.renderPropertyGrid(this.dom.planetProperties, [
      ["Period", formatUnit(t.pl_orbper, "d", 4)],
      ["Duration", formatUnit(t.pl_trandur, "h", 3)],
      ["Rp/R★", formatMaybe(t.pl_ratror, 4)],
      ["Depth", formatDepthPair(t.pl_trandep)],
      ["Radius", firstFiniteUnit([t.pl_rade, t.pl_radj], ["R⊕", "RJ"], [2, 3])],
      ["Mass", firstFiniteUnit([t.pl_bmasse, t.pl_bmassj], ["M⊕", "MJ"], [2, 3])],
      ["a", formatUnit(t.pl_orbsmax, "AU", 4)],
      ["Inclination", formatUnit(t.pl_orbincl, "°", 2)],
      ["Eccentricity", formatMaybe(t.pl_orbeccen, 3)],
      ["ω", formatUnit(t.pl_orblper, "°", 2)],
      ["Discovery", t.disc_year ? String(t.disc_year) : "—"]
    ]);

    this.renderPropertyGrid(this.dom.starProperties, [
      ["Teff", formatUnit(t.st_teff, "K", 0)],
      ["R★", formatUnit(t.st_rad, "R☉", 3)],
      ["M★", formatUnit(t.st_mass, "M☉", 3)],
      ["log g", formatMaybe(t.st_logg, 3)],
      ["[Fe/H]", formatMaybe(t.st_met, 3)],
      ["Stars", formatMaybe(t.sy_snum, 0)],
      ["Planets", formatMaybe(t.sy_pnum, 0)]
    ]);

    this.renderPropertyGrid(this.dom.catalogueProperties, [
      ["Method", t.discoverymethod || "—"],
      ["Data", t.lightcurve_available ? "local LC" : "synthetic"],
      ["LC points", this.archivalCurve.points ? this.archivalCurve.points.toLocaleString("en-GB") : "—"],
      ["File", t.lightcurve_file || "—"]
    ]);

    this.syncControlOutputs();
  }

  renderPropertyGrid(container, rows) {
    if (!container) return;

    const fragment = document.createDocumentFragment();

    for (const [label, value] of rows) {
      const node = document.createElement("div");
      node.className = "property";

      const span = document.createElement("span");
      span.textContent = label;

      const strong = document.createElement("strong");
      strong.textContent = value || "—";

      node.append(span, strong);
      fragment.appendChild(node);
    }

    container.replaceChildren(fragment);
  }

  updateAssumptionStrip() {
    if (!this.dom.assumptionStrip) return;

    const workerFlags = this.metrics.morphologyFlags.length
      ? this.metrics.morphologyFlags
      : ["baseline transit model"];

    const extraFlags = [
      this.timings.surfaceSamples
        ? `${Number(this.timings.surfaceSamples).toLocaleString("en-GB")} surface samples`
        : null,
      "ppm + percent depth"
    ];

    const flags = [
      ...workerFlags,
      ...extraFlags
    ].filter(Boolean);

    const fragment = document.createDocumentFragment();

    for (const flag of flags.slice(0, 9)) {
      const pill = document.createElement("span");
      const lower = String(flag).toLowerCase();

      pill.className = "pill";

      if (
        lower.includes("high") ||
        lower.includes("loaded") ||
        lower.includes("quadrature") ||
        lower.includes("residuals near")
      ) {
        pill.classList.add("ok");
      } else if (
        lower.includes("moon") ||
        lower.includes("spot") ||
        lower.includes("eccentric") ||
        lower.includes("circular") ||
        lower.includes("exposure")
      ) {
        pill.classList.add("warn");
      } else if (
        lower.includes("mismatch") ||
        lower.includes("low")
      ) {
        pill.classList.add("danger");
      }

      pill.textContent = flag;
      fragment.appendChild(pill);
    }

    this.dom.assumptionStrip.replaceChildren(fragment);
  }

  draw() {
    const canvas = this.dom.canvas;
    const ctx = this.dom.ctx;
    if (!canvas || !ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    const width = Math.max(2, Math.floor(rect.width * dpr));
    const height = Math.max(2, Math.floor(rect.height * dpr));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const theme = getComputedStyle(this.root);
    const plotBg = theme.getPropertyValue("--plot-bg").trim() || "#ffffff";
    const grid = theme.getPropertyValue("--grid").trim() || "#d9e0ea";
    const text = theme.getPropertyValue("--text").trim() || "#17202a";
    const muted = theme.getPropertyValue("--muted").trim() || "#637083";
    const data = theme.getPropertyValue("--data").trim() || "#176b87";
    const model = theme.getPropertyValue("--model").trim() || "#c47a00";

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = plotBg;
    ctx.fillRect(0, 0, width, height);

    const pad = {
      left: Math.max(60 * dpr, width * 0.06),
      right: Math.max(20 * dpr, width * 0.02),
      top: Math.max(26 * dpr, height * 0.12),
      bottom: Math.max(44 * dpr, height * 0.19)
    };

    const combined = collectPlotValues(this.archivalCurve, this.latestModel);
    const scale = computeScale(combined);

    const xMap = phase =>
      pad.left +
      (phase - scale.minPhase) / Math.max(1e-9, scale.maxPhase - scale.minPhase) *
      (width - pad.left - pad.right);

    const yMap = flux =>
      pad.top +
      (scale.maxFlux - flux) / Math.max(1e-9, scale.maxFlux - scale.minFlux) *
      (height - pad.top - pad.bottom);

    drawPlotGrid(ctx, width, height, pad, scale, dpr, { grid, text, muted });
    drawArchivalScatter(ctx, this.archivalCurve, xMap, yMap, dpr, data);
    drawModelCurve(ctx, this.latestModel, xMap, yMap, dpr, model);
    drawLegend(ctx, width, pad, dpr, { text, data, model });
  }

  startTelemetryLoop() {
    const tick = now => {
      this.frameCounter += 1;

      if (now - this.lastFpsTime >= 500) {
        this.fps = Math.round(this.frameCounter * 1000 / (now - this.lastFpsTime));
        this.frameCounter = 0;
        this.lastFpsTime = now;
        this.setText(this.dom.fpsStatus, `${this.fps} fps`);
      }

      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }

  setWorkerFailed(message) {
    this.workerReady = false;
    this.setText(this.dom.workerStatus, "failed");
    this.setText(this.dom.solverStatus, "offline");
    this.setFriendlyStatus(message);
  }

  setFriendlyStatus(message) {
    this.setText(this.dom.footerMessage, message);
  }

  setText(node, value) {
    if (node) node.textContent = String(value);
  }
}

/* ============================================================================
   CINEMATIC BOOT SEQUENCE
   ============================================================================ */

async function playCinematicBootSequence() {
  const bootScreen = document.querySelector(".boot-screen");
  const statusEl = document.getElementById("boot-status");
  const percentEl = document.getElementById("boot-percent");
  const barEl = document.getElementById("boot-progress-bar");

  if (!bootScreen || !statusEl || !percentEl || !barEl) {
    return;
  }

  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  const steps = [
    { target: 8, text: "Initialising observatory systems..." },
    { target: 18, text: "Loading the exoplanet target archive..." },
    { target: 30, text: "Reading stellar and planetary parameters..." },
    { target: 42, text: "Loading archived photometry..." },
    { target: 56, text: "Preparing the transit physics engine..." },
    { target: 70, text: "Rendering the stellar photosphere..." },
    { target: 82, text: "Synchronising orbit geometry and flux model..." },
    { target: 91, text: "Tighten your seatbelt — we are travelling to another star system..." },
    { target: 97, text: "Finalising the scientific interface..." },
    { target: 100, text: "ExoIntel-Prime is ready." }
  ];

  let current = 0;

  const update = (value, text) => {
    current = Math.max(current, Math.min(100, value));
    percentEl.textContent = `${Math.round(current)}%`;
    barEl.style.width = `${current}%`;
    if (text) statusEl.textContent = text;
  };

  update(0, "Initialising observatory systems...");

  if (reducedMotion) {
    update(100, "ExoIntel-Prime is ready.");
    await wait(350);
    bootScreen.classList.add("is-fading");
    await wait(250);
    bootScreen.remove();
    return;
  }

  for (const step of steps) {
    const start = current;
    const end = step.target;
    const frames = Math.max(8, Math.round((end - start) * 1.35));

    for (let i = 1; i <= frames; i++) {
      const t = i / frames;
      const eased = 1 - Math.pow(1 - t, 2);
      const value = start + (end - start) * eased;
      update(value, step.text);
      await wait(34);
    }
  }

  await wait(250);
  bootScreen.classList.add("is-fading");
  await wait(550);
  bootScreen.remove();
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ============================================================================
   TEMPLATE HELPERS
   ============================================================================ */

function transitLogoSvg() {
  return `
    <svg class="brand-logo" viewBox="0 0 100 100" role="img" aria-label="ExoIntel-Prime transit logo">
      <defs>
        <radialGradient id="exoStar" cx="45%" cy="42%" r="62%">
          <stop offset="0%" stop-color="#ffd38b"/>
          <stop offset="42%" stop-color="#ff9f2e"/>
          <stop offset="72%" stop-color="#d86f16"/>
          <stop offset="100%" stop-color="#5b2508"/>
        </radialGradient>
        <linearGradient id="exoRing" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#63a7ff"/>
          <stop offset="100%" stop-color="#50c6df"/>
        </linearGradient>
      </defs>
      <rect x="5" y="5" width="90" height="90" rx="25" fill="rgba(12,20,35,.96)" stroke="rgba(99,167,255,.34)" stroke-width="2"/>
      <circle cx="52" cy="52" r="25" fill="url(#exoStar)"/>
      <path d="M18 66 C32 28, 72 20, 86 39" fill="none" stroke="url(#exoRing)" stroke-width="3.4" stroke-linecap="round" opacity=".9"/>
      <circle cx="40" cy="52" r="8.3" fill="#06111f" stroke="#50c6df" stroke-width="1.4"/>
      <circle cx="69" cy="29" r="2.4" fill="#ffb547"/>
      <circle cx="24" cy="75" r="2.0" fill="#63a7ff"/>
    </svg>
  `;
}

function help(key) {
  const text = HELP_TEXT[key] || "Scientific term explanation unavailable.";

  return `
    <span class="help" tabindex="0" aria-label="${escapeHtml(text)}">
      ?
      <span class="help-content">${escapeHtml(text)}</span>
    </span>
  `;
}

function rangeControl(key, label, min, max, step, value, digits = 2, suffix = "") {
  const safeValue = Number.isFinite(Number(value)) ? Number(value) : Number(min);

  return `
    <div class="control-row">
      <label for="${key}">${label}</label>
      <input id="${key}" data-param="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${safeValue}" />
      <output id="out-${key}">${formatNumber(safeValue, digits)}${suffix}</output>
    </div>
  `;
}

function toggleControl(key, label, checked) {
  return `
    <div class="toggle-row">
      <label for="${key}">${label}</label>
      <input id="${key}" data-param="${key}" type="checkbox" ${checked ? "checked" : ""} />
      <output id="out-${key}">${checked ? "on" : "off"}</output>
    </div>
  `;
}

function selectControl(key, label, options, value, helpKey = null) {
  const optionMarkup = options.map(([optionValue, optionLabel]) => {
    const selected = String(optionValue) === String(value) ? "selected" : "";
    return `<option value="${escapeHtml(optionValue)}" ${selected}>${escapeHtml(optionLabel)}</option>`;
  }).join("");

  return `
    <div class="select-row">
      <label for="${key}">${label}</label>
      <select id="${key}" data-param="${key}">
        ${optionMarkup}
      </select>
      ${helpKey ? help(helpKey) : "<span></span>"}
    </div>
  `;
}

function readonlyControl(id, label, value, helpKey = null) {
  return `
    <div class="control-row">
      <label>${label}</label>
      <div></div>
      <output id="${id}-value">${value}</output>
      ${helpKey ? help(helpKey) : ""}
    </div>
  `;
}

/* ============================================================================
   DATA NORMALISATION
   ============================================================================ */

function normaliseTarget(row) {
  if (!row || typeof row !== "object") return null;

  const name = stringValue(row.pl_name || row.name || row.planet || "Unknown planet");
  const host = stringValue(row.hostname || row.host || "Unknown host");
  const rpRs = numberValue(row.pl_ratror, 0.1);
  const depth = numberValue(row.pl_trandep, rpRs * rpRs * 1e6);

  return {
    id: `${host}::${name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
    pl_name: name,
    hostname: host,
    discoverymethod: stringValue(row.discoverymethod || row.discovery_method || "Transit"),
    disc_year: numberValue(row.disc_year, null),

    pl_orbper: numberValue(row.pl_orbper, 3),
    pl_trandur: numberValue(row.pl_trandur, 2.5),
    pl_trandep: depth,
    pl_ratror: rpRs,
    pl_orbsmax: numberValue(row.pl_orbsmax, null),
    pl_orbincl: numberValue(row.pl_orbincl, 88.5),
    pl_orbeccen: numberValue(row.pl_orbeccen, 0),
    pl_orblper: numberValue(row.pl_orblper ?? row.omega, 90),
    pl_bmassj: numberValue(row.pl_bmassj, null),
    pl_bmasse: numberValue(row.pl_bmasse, null),
    pl_radj: numberValue(row.pl_radj, null),
    pl_rade: numberValue(row.pl_rade, null),

    st_teff: numberValue(row.st_teff, 5772),
    st_rad: numberValue(row.st_rad, 1),
    st_mass: numberValue(row.st_mass, 1),
    st_logg: numberValue(row.st_logg, null),
    st_met: numberValue(row.st_met, null),

    sy_snum: numberValue(row.sy_snum, null),
    sy_pnum: numberValue(row.sy_pnum, null),

    lightcurve_available: Boolean(row.lightcurve_available || row.has_lightcurve || row.has_observed_lc),
    lightcurve_file: stringValue(row.lightcurve_file || "")
  };
}

function targetToParams(target, previous) {
  return {
    ...previous,
    rpRs: clamp(numberValue(target.pl_ratror, previous.rpRs), 0.01, 0.25),
    aRs: clamp(inferARs(target, previous.aRs), 2, 60),
    inclinationDeg: clamp(numberValue(target.pl_orbincl, previous.inclinationDeg), 75, 90),
    eccentricity: clamp(numberValue(target.pl_orbeccen, 0), 0, 0.95),
    omegaDeg: normaliseDegrees(numberValue(target.pl_orblper, 90)),
    fidelity: "preview",
    modelResolution: 720
  };
}

function inferARs(target, fallback) {
  const aAu = numberValue(target.pl_orbsmax, null);
  const rStar = numberValue(target.st_rad, null);

  if (!Number.isFinite(aAu) || !Number.isFinite(rStar) || rStar <= 0) {
    return fallback;
  }

  return aAu / (rStar * 0.00465047);
}

function normaliseLightCurvePayload(payload) {
  const rows = extractLightCurveRows(payload);
  const points = [];

  for (const row of rows) {
    const phase = numberValue(row.phase ?? row.Phase ?? row.x ?? row[0], NaN);
    const flux = numberValue(row.flux ?? row.Flux ?? row.normalized_flux ?? row.y ?? row[1], NaN);
    const error = numberValue(row.error ?? row.flux_err ?? row.err ?? row[2], NaN);

    if (!Number.isFinite(phase) || !Number.isFinite(flux)) continue;
    if (phase < -1.5 || phase > 1.5 || flux < 0.2 || flux > 1.8) continue;

    points.push({
      phase,
      flux,
      error: Number.isFinite(error) ? error : 0
    });
  }

  points.sort((a, b) => a.phase - b.phase);

  return {
    phase: new Float32Array(points.map(point => point.phase)),
    flux: new Float32Array(points.map(point => point.flux)),
    error: new Float32Array(points.map(point => point.error || 0)),
    source: stringValue(payload?.source || "local light-curve JSON"),
    points: points.length
  };
}

function extractLightCurveRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.points)) return payload.points;
  if (Array.isArray(payload?.data)) return payload.data;

  if (Array.isArray(payload?.phase) && Array.isArray(payload?.flux)) {
    const n = Math.min(payload.phase.length, payload.flux.length);
    return Array.from({ length: n }, (_, i) => ({
      phase: payload.phase[i],
      flux: payload.flux[i],
      error: Array.isArray(payload.error) ? payload.error[i] : 0
    }));
  }

  return [];
}

function generateSyntheticArchive(target, params) {
  const n = 480;
  const phase = new Float32Array(n);
  const flux = new Float32Array(n);
  const error = new Float32Array(n);

  const depth = clamp(numberValue(target.pl_trandep, params.rpRs * params.rpRs * 1e6) / 1e6, 0.0001, 0.08);
  const width = clamp(
    numberValue(target.pl_trandur, 2.5) / 24 / Math.max(0.2, numberValue(target.pl_orbper, 3)),
    0.008,
    0.08
  );

  for (let i = 0; i < n; i++) {
    const x = -0.12 + 0.24 * i / (n - 1);
    const transit = Math.exp(-0.5 * (x / Math.max(0.002, width)) ** 2);
    const deterministicNoise = 0.00045 * Math.sin(i * 12.9898) + 0.00022 * Math.sin(i * 4.1414 + 1.7);

    phase[i] = x;
    flux[i] = 1 - depth * transit + deterministicNoise;
    error[i] = 0.0005;
  }

  return {
    phase,
    flux,
    error,
    source: "synthetic demonstration fallback",
    points: n
  };
}

/* ============================================================================
   PLOT UTILITIES
   ============================================================================ */

function collectPlotValues(archive, model) {
  const phaseValues = [];
  const fluxValues = [];

  for (let i = 0; i < archive.phase.length; i++) {
    phaseValues.push(archive.phase[i]);
    fluxValues.push(archive.flux[i]);
  }

  for (let i = 0; i < model.phase.length; i++) {
    phaseValues.push(model.phase[i]);
    fluxValues.push(model.flux[i]);
  }

  return { phaseValues, fluxValues };
}

function computeScale(values) {
  let minPhase = Infinity;
  let maxPhase = -Infinity;
  let minFluxRaw = Infinity;
  let maxFluxRaw = -Infinity;

  for (const value of values.phaseValues) {
    if (Number.isFinite(value)) {
      minPhase = Math.min(minPhase, value);
      maxPhase = Math.max(maxPhase, value);
    }
  }

  for (const value of values.fluxValues) {
    if (Number.isFinite(value)) {
      minFluxRaw = Math.min(minFluxRaw, value);
      maxFluxRaw = Math.max(maxFluxRaw, value);
    }
  }

  if (!Number.isFinite(minPhase) || !Number.isFinite(maxPhase) || minPhase === maxPhase) {
    minPhase = -0.12;
    maxPhase = 0.12;
  }

  if (!Number.isFinite(minFluxRaw) || !Number.isFinite(maxFluxRaw) || minFluxRaw === maxFluxRaw) {
    minFluxRaw = 0.99;
    maxFluxRaw = 1.001;
  }

  const span = Math.max(0.0005, maxFluxRaw - minFluxRaw);

  return {
    minPhase,
    maxPhase,
    minFlux: minFluxRaw - span * 0.18,
    maxFlux: maxFluxRaw + span * 0.15
  };
}

function drawPlotGrid(ctx, width, height, pad, scale, dpr, colours) {
  ctx.save();
  ctx.strokeStyle = colours.grid;
  ctx.lineWidth = 1 * dpr;

  for (let i = 0; i <= 10; i++) {
    const x = pad.left + i / 10 * (width - pad.left - pad.right);
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, height - pad.bottom);
    ctx.stroke();
  }

  for (let i = 0; i <= 6; i++) {
    const y = pad.top + i / 6 * (height - pad.top - pad.bottom);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }

  ctx.strokeStyle = colours.muted;
  ctx.strokeRect(pad.left, pad.top, width - pad.left - pad.right, height - pad.top - pad.bottom);

  ctx.fillStyle = colours.muted;
  ctx.font = `${11 * dpr}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  for (let i = 0; i <= 4; i++) {
    const phase = scale.minPhase + i / 4 * (scale.maxPhase - scale.minPhase);
    const x = pad.left + i / 4 * (width - pad.left - pad.right);
    ctx.fillText(formatNumber(phase, 3), x, height - pad.bottom + 10 * dpr);
  }

  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  for (let i = 0; i <= 4; i++) {
    const flux = scale.maxFlux - i / 4 * (scale.maxFlux - scale.minFlux);
    const y = pad.top + i / 4 * (height - pad.top - pad.bottom);
    ctx.fillText(formatNumber(flux, 5), pad.left - 10 * dpr, y);
  }

  ctx.fillStyle = colours.text;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("Orbital phase", pad.left, height - 20 * dpr);

  ctx.save();
  ctx.translate(18 * dpr, height * 0.5);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Normalised flux", 0, 0);
  ctx.restore();

  ctx.restore();
}

function drawArchivalScatter(ctx, archive, xMap, yMap, dpr, colour) {
  ctx.save();
  ctx.fillStyle = alphaColour(colour, 0.55);

  const radius = Math.max(1.2, 1.45 * dpr);

  for (let i = 0; i < archive.phase.length; i++) {
    ctx.beginPath();
    ctx.arc(xMap(archive.phase[i]), yMap(archive.flux[i]), radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawModelCurve(ctx, model, xMap, yMap, dpr, colour) {
  if (model.phase.length < 2) return;

  ctx.save();
  ctx.beginPath();

  for (let i = 0; i < model.phase.length; i++) {
    const x = xMap(model.phase[i]);
    const y = yMap(model.flux[i]);

    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  ctx.strokeStyle = colour;
  ctx.lineWidth = Math.max(2, 2.35 * dpr);
  ctx.stroke();
  ctx.restore();
}

function drawLegend(ctx, width, pad, dpr, colours) {
  ctx.save();
  ctx.font = `${12 * dpr}px Inter, system-ui, sans-serif`;
  ctx.textBaseline = "middle";

  const y = pad.top - 10 * dpr;
  const x0 = pad.left;

  ctx.fillStyle = colours.data;
  ctx.beginPath();
  ctx.arc(x0, y, 4 * dpr, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = colours.text;
  ctx.fillText("archival photometry", x0 + 10 * dpr, y);

  const x1 = x0 + 172 * dpr;

  ctx.strokeStyle = colours.model;
  ctx.lineWidth = 3 * dpr;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x1 + 22 * dpr, y);
  ctx.stroke();

  ctx.fillStyle = colours.text;
  ctx.fillText("theoretical model", x1 + 32 * dpr, y);

  ctx.restore();
}

/* ============================================================================
   GENERAL HELPERS
   ============================================================================ */

function serialiseTarget(target) {
  return {
    pl_name: target.pl_name,
    hostname: target.hostname,
    pl_orbper: numberValue(target.pl_orbper, 3),
    pl_trandur: numberValue(target.pl_trandur, 2.5),
    pl_trandep: numberValue(target.pl_trandep, 10000),
    pl_orbeccen: numberValue(target.pl_orbeccen, 0),
    pl_orblper: numberValue(target.pl_orblper, 90),
    st_teff: numberValue(target.st_teff, 5772),
    st_rad: numberValue(target.st_rad, 1),
    st_mass: numberValue(target.st_mass, 1)
  };
}

function normaliseDegrees(deg) {
  let value = Number(deg);

  if (!Number.isFinite(value)) {
    return 0;
  }

  value %= 360;

  if (value < 0) {
    value += 360;
  }

  return value;
}

function numberValue(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function stringValue(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatNumber(value, digits) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

function formatMaybe(value, digits) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

function formatPpm(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${Math.round(n).toLocaleString("en-GB")} ppm` : "—";
}

function formatUnit(value, unit, digits) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(digits)} ${unit}` : "—";
}

function formatDepthPair(ppm) {
  const n = Number(ppm);
  if (!Number.isFinite(n)) return "—";
  return `${(n / 10000).toFixed(3)}% · ${Math.round(n).toLocaleString("en-GB")} ppm`;
}

function firstFiniteUnit(values, units, digits) {
  for (let i = 0; i < values.length; i++) {
    const n = Number(values[i]);
    if (Number.isFinite(n)) return `${n.toFixed(digits[i])} ${units[i]}`;
  }

  return "—";
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function alphaColour(colour, alpha) {
  const value = String(colour || "").trim();

  if (value.startsWith("#") && (value.length === 7 || value.length === 4)) {
    let r;
    let g;
    let b;

    if (value.length === 4) {
      r = parseInt(value[1] + value[1], 16);
      g = parseInt(value[2] + value[2], 16);
      b = parseInt(value[3] + value[3], 16);
    } else {
      r = parseInt(value.slice(1, 3), 16);
      g = parseInt(value.slice(3, 5), 16);
      b = parseInt(value.slice(5, 7), 16);
    }

    return `rgba(${r},${g},${b},${alpha})`;
  }

  return value || `rgba(23,107,135,${alpha})`;
}

/* ============================================================================
   START
   ============================================================================ */

async function bootstrapApplication() {
  await playCinematicBootSequence();

  const app = new ExoIntelPrimeApp();
  await app.boot();
}

function startWhenReady() {
  bootstrapApplication().catch(error => {
    console.error("Application bootstrap failed:", error);

    const statusEl = document.getElementById("boot-status");
    const percentEl = document.getElementById("boot-percent");
    const barEl = document.getElementById("boot-progress-bar");

    if (statusEl) statusEl.textContent = "Startup failed. Please reload the page.";
    if (percentEl) percentEl.textContent = "Error";
    if (barEl) barEl.style.width = "100%";
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startWhenReady, { once: true });
} else {
  startWhenReady();
}
