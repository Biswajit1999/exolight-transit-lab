import { ExoSceneRenderer } from "./scene.js";

/* ============================================================================
   ExoIntel-Prime
   Main Thread Orchestrator
   ---------------------------------------------------------------------------
   Responsibilities:
   - Build a clean scientific interface.
   - Keep slider interaction responsive.
   - Send only the latest parameter snapshot to the worker.
   - Discard stale worker replies by revision number.
   - Render static archival data + latest theoretical model.
   - Mount and update the lightweight WebGL CGI scene.
   ============================================================================ */

const APP_NAME = "ExoIntel-Prime";
const WORKER_URL = new URL("./transitWorker.js", import.meta.url);
const TARGET_CACHE_URL = "./data/exoplanets.json";
const LIGHTCURVE_BASE_URL = "./data/lightcurves/";

const DEFAULT_PARAMS = Object.freeze({
  rpRs: 0.1,
  aRs: 12.0,
  inclinationDeg: 88.5,
  eccentricity: 0.0,
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
  modelResolution: 720,
  fidelity: "preview"
});

const DEFAULT_TARGET = Object.freeze({
  pl_name: "Synthetic Hot Jupiter",
  hostname: "Demonstration Host",
  pl_orbper: 3.0,
  pl_trandur: 2.4,
  pl_trandep: 10000,
  st_teff: 5772,
  st_rad: 1.0,
  st_mass: 1.0,
  lightcurve_available: false,
  lightcurve_file: ""
});

class ExoIntelPrimeApp {
  constructor() {
    this.root = document.getElementById("app") || document.body;
    this.worker = null;
    this.scene = null;

    this.currentRevision = 0;
    this.lastSentRevision = 0;
    this.latestParams = { ...DEFAULT_PARAMS };
    this.latestTarget = { ...DEFAULT_TARGET };

    this.pendingFrame = false;
    this.workerReady = false;
    this.workerBusy = false;

    this.targets = [];
    this.activeTarget = null;

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
      morphologyFlags: ["waiting for worker"]
    };

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
    this.initWorker();
    this.initScene();
    this.startTelemetryLoop();

    await this.loadTargetCache();
    await this.selectInitialTarget();

    this.issueParameterRevision("initial boot");
    this.draw();
  }

  installDocumentShell() {
    document.documentElement.lang = "en";
    document.title = `${APP_NAME} | Transit Photometry Laboratory`;

    const style = document.createElement("style");
    style.textContent = `
      :root{
        --bg:#f5f7fb;
        --surface:#ffffff;
        --surface-2:#f0f3f8;
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
        --font:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
        --mono:"SFMono-Regular","Cascadia Mono","Roboto Mono",Consolas,monospace;
      }

      *{ box-sizing:border-box; }

      html,
      body{
        width:100%;
        height:100%;
        margin:0;
        overflow:hidden;
        background:var(--bg);
        color:var(--text);
        font-family:var(--font);
        font-size:14px;
        line-height:1.35;
      }

      button,
      input,
      select,
      textarea{
        font:inherit;
      }

      button{
        cursor:pointer;
      }

      .exointel-app{
        width:100vw;
        height:100vh;
        display:grid;
        grid-template-rows:56px minmax(0,1fr) 28px;
        background:
          radial-gradient(circle at 20% 0%,rgba(27,100,216,.07),transparent 32%),
          linear-gradient(180deg,#fbfcfe 0%,#eef3f9 100%);
      }

      .app-header{
        display:grid;
        grid-template-columns:minmax(260px,1fr) minmax(420px,1.4fr) minmax(280px,1fr);
        align-items:center;
        gap:16px;
        padding:10px 16px;
        border-bottom:1px solid var(--line);
        background:rgba(255,255,255,.86);
        backdrop-filter:blur(18px);
      }

      .brand{
        display:flex;
        align-items:center;
        gap:12px;
        min-width:0;
      }

      .brand-mark{
        width:34px;
        height:34px;
        border-radius:10px;
        border:1px solid var(--line-strong);
        background:
          radial-gradient(circle at 50% 50%,rgba(27,100,216,.35),transparent 34%),
          linear-gradient(135deg,#fff,#dbe6f6);
        box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 8px 22px rgba(27,100,216,.12);
      }

      .brand h1{
        margin:0;
        font-size:15px;
        font-weight:800;
        letter-spacing:.02em;
      }

      .brand p{
        margin:1px 0 0;
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
        padding:6px 9px;
        border:1px solid var(--line);
        border-radius:10px;
        background:rgba(255,255,255,.70);
      }

      .status-tile span{
        display:block;
        color:var(--muted);
        font-size:10px;
        font-weight:700;
        text-transform:uppercase;
        letter-spacing:.08em;
      }

      .status-tile strong{
        display:block;
        margin-top:2px;
        overflow:hidden;
        color:var(--text);
        font-size:12px;
        font-weight:800;
        white-space:nowrap;
        text-overflow:ellipsis;
      }

      .header-actions{
        display:flex;
        justify-content:flex-end;
        align-items:center;
        gap:8px;
      }

      .button{
        min-height:34px;
        padding:0 12px;
        border:1px solid var(--line-strong);
        border-radius:10px;
        background:#fff;
        color:var(--text);
        font-weight:750;
        font-size:12px;
        transition:background .15s ease,border-color .15s ease,transform .15s ease;
      }

      .button:hover{
        background:#f7f9fc;
        border-color:#9eacbd;
      }

      .button:active{
        transform:translateY(1px);
      }

      .button.primary{
        color:#fff;
        border-color:var(--accent);
        background:var(--accent);
      }

      .button.primary:hover{
        background:var(--accent-2);
      }

      .workspace{
        min-height:0;
        display:grid;
        grid-template-columns:340px minmax(0,1fr);
        gap:14px;
        padding:14px;
        overflow:hidden;
      }

      .left-panel{
        min-height:0;
        display:grid;
        grid-template-rows:auto auto minmax(0,1fr);
        gap:12px;
        overflow:hidden;
      }

      .main-panel{
        min-height:0;
        display:grid;
        grid-template-rows:minmax(320px,1fr) 220px;
        gap:12px;
        overflow:hidden;
      }

      .card{
        min-height:0;
        border:1px solid var(--line);
        border-radius:18px;
        background:rgba(255,255,255,.86);
        box-shadow:var(--shadow);
        overflow:hidden;
      }

      .card-header{
        min-height:42px;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        padding:10px 14px;
        border-bottom:1px solid var(--line);
        background:rgba(255,255,255,.72);
      }

      .card-header h2{
        margin:0;
        font-size:13px;
        font-weight:850;
        letter-spacing:.01em;
      }

      .card-header span{
        color:var(--muted);
        font-size:11px;
        font-weight:650;
      }

      .card-body{
        min-height:0;
        padding:14px;
      }

      .target-search{
        width:100%;
        min-height:36px;
        padding:0 12px;
        border:1px solid var(--line);
        border-radius:12px;
        background:#fff;
        outline:none;
      }

      .target-search:focus{
        border-color:var(--accent);
        box-shadow:0 0 0 3px rgba(27,100,216,.10);
      }

      .target-list{
        max-height:170px;
        overflow:auto;
        margin-top:10px;
        display:flex;
        flex-direction:column;
        gap:6px;
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
        background:#fff;
        text-align:left;
      }

      .target-row.active{
        border-color:var(--accent);
        background:#f1f6ff;
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
        background:#fff;
        font-size:10px;
        font-weight:800;
        letter-spacing:.03em;
        text-transform:uppercase;
      }

      .pill.ok{
        color:var(--ok);
        background:#eefaf4;
        border-color:#bfebd5;
      }

      .pill.warn{
        color:var(--warn);
        background:#fff8e5;
        border-color:#f3d28a;
      }

      .readout-grid{
        display:grid;
        grid-template-columns:repeat(2,minmax(0,1fr));
        gap:10px;
      }

      .readout{
        min-height:72px;
        padding:11px;
        border:1px solid var(--line);
        border-radius:14px;
        background:#fff;
      }

      .readout span{
        display:block;
        color:var(--muted);
        font-size:10px;
        font-weight:800;
        letter-spacing:.08em;
        text-transform:uppercase;
      }

      .readout strong{
        display:block;
        margin-top:8px;
        font-family:var(--mono);
        font-size:18px;
        font-weight:850;
      }

      .readout small{
        display:block;
        margin-top:3px;
        color:var(--muted-2);
        font-size:11px;
      }

      .flag-list{
        display:flex;
        flex-wrap:wrap;
        gap:6px;
        margin-top:10px;
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
        background:#fff;
      }

      .control-group h3{
        margin:0 0 10px;
        font-size:12px;
        font-weight:850;
      }

      .control-row{
        display:grid;
        grid-template-columns:120px minmax(0,1fr) 64px;
        gap:10px;
        align-items:center;
        min-height:34px;
      }

      .control-row + .control-row{
        margin-top:8px;
      }

      .control-row label{
        color:var(--muted);
        font-size:12px;
      }

      .control-row output{
        color:var(--text);
        font-family:var(--mono);
        font-size:12px;
        text-align:right;
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

      .plot-card{
        position:relative;
        display:grid;
        grid-template-rows:42px minmax(0,1fr);
      }

      .plot-wrap{
        position:relative;
        min-height:0;
        padding:0;
        background:#fff;
      }

      .plot-canvas{
        width:100%;
        height:100%;
        display:block;
      }

      .scene-panel{
        min-height:0;
        display:grid;
        grid-template-rows:42px minmax(0,1fr);
      }

      .scene-stage{
        min-height:0;
        position:relative;
        background:
          radial-gradient(circle at 52% 44%,rgba(196,122,0,.14),transparent 32%),
          linear-gradient(180deg,#f9fbfe,#edf2f8);
      }

      .app-footer{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
        padding:0 16px;
        border-top:1px solid var(--line);
        background:rgba(255,255,255,.84);
        color:var(--muted);
        font-size:11px;
      }

      @media (max-width:1100px){
        html,
        body{
          overflow:auto;
        }

        .exointel-app{
          height:auto;
          min-height:100vh;
          grid-template-rows:auto auto auto;
        }

        .app-header,
        .workspace{
          grid-template-columns:1fr;
        }

        .main-panel{
          grid-template-rows:420px 260px;
        }

        .status-strip{
          grid-template-columns:repeat(2,minmax(0,1fr));
        }
      }
    `;

    document.head.appendChild(style);

    this.root.className = "exointel-app";
    this.root.innerHTML = `
      <header class="app-header">
        <section class="brand">
          <div class="brand-mark" aria-hidden="true"></div>
          <div>
            <h1>ExoIntel-Prime</h1>
            <p>Publication-grade transit photometry laboratory · worker-backed theoretical modelling</p>
          </div>
        </section>

        <section class="status-strip" aria-label="Application state">
          <div class="status-tile">
            <span>Worker</span>
            <strong id="status-worker">initialising</strong>
          </div>
          <div class="status-tile">
            <span>Revision</span>
            <strong id="status-revision">0</strong>
          </div>
          <div class="status-tile">
            <span>Solver</span>
            <strong id="status-solver">idle</strong>
          </div>
          <div class="status-tile">
            <span>Frame Rate</span>
            <strong id="status-fps">-- fps</strong>
          </div>
        </section>

        <section class="header-actions">
          <button class="button" id="button-reset" type="button">Reset model</button>
          <button class="button primary" id="button-high-fidelity" type="button">Full fidelity solve</button>
        </section>
      </header>

      <section class="workspace">
        <aside class="left-panel">
          <section class="card">
            <div class="card-header">
              <h2>Target archive</h2>
              <span id="target-count">loading</span>
            </div>
            <div class="card-body">
              <input id="target-search" class="target-search" type="search" placeholder="Search planet, host star, observed data..." />
              <div id="target-list" class="target-list"></div>
            </div>
          </section>

          <section class="card">
            <div class="card-header">
              <h2>Scientific readout</h2>
              <span id="active-target-label">no target</span>
            </div>
            <div class="card-body">
              <div class="readout-grid">
                <div class="readout">
                  <span>Residual RMS</span>
                  <strong id="metric-residual-rms">—</strong>
                  <small>data minus model</small>
                </div>
                <div class="readout">
                  <span>OOT RMS</span>
                  <strong id="metric-oot-rms">—</strong>
                  <small>out-of-transit scatter</small>
                </div>
                <div class="readout">
                  <span>Signal / Noise</span>
                  <strong id="metric-snr">—</strong>
                  <small>model depth over OOT RMS</small>
                </div>
                <div class="readout">
                  <span>Model Depth</span>
                  <strong id="metric-depth">—</strong>
                  <small>theoretical transit depth</small>
                </div>
              </div>
              <div id="metric-flags" class="flag-list"></div>
            </div>
          </section>

          <section class="card">
            <div class="card-header">
              <h2>Model parameters</h2>
              <span>latest-state mailbox</span>
            </div>
            <div class="control-list" id="control-list">
              <div class="control-group">
                <h3>Orbital geometry</h3>
                <div class="control-row">
                  <label for="rpRs">Rp/R★</label>
                  <input id="rpRs" data-param="rpRs" type="range" min="0.01" max="0.25" step="0.001" value="0.1" />
                  <output id="out-rpRs">0.100</output>
                </div>
                <div class="control-row">
                  <label for="aRs">a/R★</label>
                  <input id="aRs" data-param="aRs" type="range" min="2" max="60" step="0.1" value="12" />
                  <output id="out-aRs">12.0</output>
                </div>
                <div class="control-row">
                  <label for="inclinationDeg">Inclination</label>
                  <input id="inclinationDeg" data-param="inclinationDeg" type="range" min="75" max="90" step="0.01" value="88.5" />
                  <output id="out-inclinationDeg">88.50°</output>
                </div>
                <div class="control-row">
                  <label for="eccentricity">Eccentricity</label>
                  <input id="eccentricity" data-param="eccentricity" type="range" min="0" max="0.8" step="0.01" value="0" />
                  <output id="out-eccentricity">0.00</output>
                </div>
              </div>

              <div class="control-group">
                <h3>Limb darkening</h3>
                <div class="control-row">
                  <label for="u1">Quadratic u1</label>
                  <input id="u1" data-param="u1" type="range" min="0" max="1" step="0.01" value="0.32" />
                  <output id="out-u1">0.32</output>
                </div>
                <div class="control-row">
                  <label for="u2">Quadratic u2</label>
                  <input id="u2" data-param="u2" type="range" min="0" max="1" step="0.01" value="0.28" />
                  <output id="out-u2">0.28</output>
                </div>
              </div>

              <div class="control-group">
                <h3>Starspot hypothesis</h3>
                <div class="control-row">
                  <label for="spotEnabled">Enabled</label>
                  <input id="spotEnabled" data-param="spotEnabled" type="checkbox" />
                  <output id="out-spotEnabled">off</output>
                </div>
                <div class="control-row">
                  <label for="spotX">Spot x</label>
                  <input id="spotX" data-param="spotX" type="range" min="-0.9" max="0.9" step="0.01" value="0.2" />
                  <output id="out-spotX">0.20</output>
                </div>
                <div class="control-row">
                  <label for="spotY">Spot y</label>
                  <input id="spotY" data-param="spotY" type="range" min="-0.9" max="0.9" step="0.01" value="0.1" />
                  <output id="out-spotY">0.10</output>
                </div>
                <div class="control-row">
                  <label for="spotRadius">Radius</label>
                  <input id="spotRadius" data-param="spotRadius" type="range" min="0.02" max="0.3" step="0.005" value="0.12" />
                  <output id="out-spotRadius">0.120</output>
                </div>
                <div class="control-row">
                  <label for="spotContrast">Contrast</label>
                  <input id="spotContrast" data-param="spotContrast" type="range" min="0.05" max="0.95" step="0.01" value="0.55" />
                  <output id="out-spotContrast">0.55</output>
                </div>
              </div>

              <div class="control-group">
                <h3>Exomoon hypothesis</h3>
                <div class="control-row">
                  <label for="moonEnabled">Enabled</label>
                  <input id="moonEnabled" data-param="moonEnabled" type="checkbox" />
                  <output id="out-moonEnabled">off</output>
                </div>
                <div class="control-row">
                  <label for="moonRadius">Moon radius</label>
                  <input id="moonRadius" data-param="moonRadius" type="range" min="0.004" max="0.08" step="0.001" value="0.025" />
                  <output id="out-moonRadius">0.025</output>
                </div>
                <div class="control-row">
                  <label for="moonDistance">Distance</label>
                  <input id="moonDistance" data-param="moonDistance" type="range" min="0.05" max="2.5" step="0.01" value="0.55" />
                  <output id="out-moonDistance">0.55</output>
                </div>
                <div class="control-row">
                  <label for="moonPhaseDeg">Phase</label>
                  <input id="moonPhaseDeg" data-param="moonPhaseDeg" type="range" min="0" max="360" step="1" value="45" />
                  <output id="out-moonPhaseDeg">45°</output>
                </div>
              </div>

              <div class="control-group">
                <h3>Model alignment</h3>
                <div class="control-row">
                  <label for="phaseShift">Phase shift</label>
                  <input id="phaseShift" data-param="phaseShift" type="range" min="-0.05" max="0.05" step="0.0005" value="0" />
                  <output id="out-phaseShift">0.0000</output>
                </div>
              </div>
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
          </section>
        </main>
      </section>

      <footer class="app-footer">
        <span>Raw archival data are static; the amber model is recomputed off-main-thread.</span>
        <span id="footer-message">Initialising worker-backed solver...</span>
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

    this.dom.metricResidual = document.getElementById("metric-residual-rms");
    this.dom.metricOot = document.getElementById("metric-oot-rms");
    this.dom.metricSnr = document.getElementById("metric-snr");
    this.dom.metricDepth = document.getElementById("metric-depth");
    this.dom.metricFlags = document.getElementById("metric-flags");

    this.dom.plotStatus = document.getElementById("plot-status");
    this.dom.canvas = document.getElementById("curve-canvas");
    this.dom.ctx = this.dom.canvas.getContext("2d");

    this.dom.resetButton = document.getElementById("button-reset");
    this.dom.highFidelityButton = document.getElementById("button-high-fidelity");

    const inputs = Array.from(document.querySelectorAll("[data-param]"));

    for (const input of inputs) {
      this.controlMap.set(input.dataset.param, input);
    }

    this.resizeObserver = new ResizeObserver(() => this.draw());
    this.resizeObserver.observe(this.dom.canvas);
  }

  bindUi() {
    for (const [key, input] of this.controlMap) {
      const eventName = input.type === "checkbox" ? "change" : "input";

      input.addEventListener(eventName, () => {
        this.syncParamsFromControls();
        this.syncControlOutputs();
        this.updateScene();
        this.issueParameterRevision(`control:${key}`);
      });
    }

    this.dom.resetButton.addEventListener("click", () => {
      this.latestParams = { ...DEFAULT_PARAMS };
      this.syncControlsFromParams();
      this.syncControlOutputs();
      this.updateScene();
      this.issueParameterRevision("reset");
    });

    this.dom.highFidelityButton.addEventListener("click", () => {
      this.latestParams = {
        ...this.latestParams,
        fidelity: "full",
        modelResolution: 1440
      };

      this.issueParameterRevision("full-fidelity");
    });

    this.dom.targetSearch.addEventListener("input", () => {
      this.renderTargetList(this.dom.targetSearch.value);
    });
  }

  initWorker() {
    try {
      this.worker = new Worker(WORKER_URL, {
        type: "module",
        name: "ExoIntelTransitWorker"
      });
    } catch (error) {
      this.setWorkerFailed(`Worker could not be constructed: ${error.message}`);
      return;
    }

    this.worker.addEventListener("message", event => this.handleWorkerMessage(event.data));
    this.worker.addEventListener("error", event => {
      this.setWorkerFailed(`Worker error: ${event.message || "unknown error"}`);
    });

    this.worker.addEventListener("messageerror", () => {
      this.setWorkerFailed("Worker message could not be deserialised.");
    });

    this.postToWorker({
      type: "configure",
      appName: APP_NAME,
      protocol: "latest-state-mailbox-v1"
    });

    this.setText(this.dom.workerStatus, "starting");
  }

  initScene() {
    this.scene = new ExoSceneRenderer({
      container: this.dom.sceneStage,
      onStatus: message => {
        this.setText(this.dom.sceneStatus, message);
      },
      onWarning: message => {
        this.setText(this.dom.sceneStatus, message);
      }
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
      this.setText(this.dom.footerMessage, "Worker ready. Slider updates are coalesced by animation frame.");
      this.sendWorkerDataContext();
      return;
    }

    if (message.type === "accepted") {
      this.workerBusy = true;
      this.setText(this.dom.solverStatus, `accepted r${message.revision}`);
      return;
    }

    if (message.type === "obsolete") {
      if (message.revision >= this.lastSentRevision) {
        this.setText(this.dom.solverStatus, `superseded r${message.revision}`);
      }
      return;
    }

    if (message.type === "progress") {
      if (message.revision === this.currentRevision) {
        this.setText(this.dom.solverStatus, `solving ${Math.round(message.progress * 100)}%`);
      }
      return;
    }

    if (message.type === "result") {
      this.handleWorkerResult(message);
      return;
    }

    if (message.type === "warning") {
      this.setText(this.dom.footerMessage, message.message || "Worker warning");
      return;
    }

    if (message.type === "error") {
      this.setText(this.dom.solverStatus, "worker error");
      this.setText(this.dom.footerMessage, message.message || "Worker reported an error");
    }
  }

  handleWorkerResult(message) {
    if (!Number.isFinite(message.revision)) return;

    if (message.revision < this.currentRevision) {
      return;
    }

    const phase = message.phaseBuffer instanceof ArrayBuffer
      ? new Float32Array(message.phaseBuffer)
      : new Float32Array(0);

    const flux = message.fluxBuffer instanceof ArrayBuffer
      ? new Float32Array(message.fluxBuffer)
      : new Float32Array(0);

    this.latestModel = {
      phase,
      flux,
      revision: message.revision
    };

    this.metrics = {
      residualRmsPpm: finiteOrNull(message.metrics?.residualRmsPpm),
      ootRmsPpm: finiteOrNull(message.metrics?.ootRmsPpm),
      snr: finiteOrNull(message.metrics?.snr),
      phaseShift: finiteOrNull(message.metrics?.phaseShift),
      modelDepthPpm: finiteOrNull(message.metrics?.modelDepthPpm),
      morphologyFlags: Array.isArray(message.metrics?.morphologyFlags)
        ? message.metrics.morphologyFlags
        : []
    };

    this.workerBusy = false;
    this.setText(this.dom.solverStatus, `complete r${message.revision}`);
    this.setText(this.dom.revisionStatus, String(message.revision));
    this.setText(this.dom.plotStatus, `${message.mode || "preview"} model · ${phase.length.toLocaleString("en-GB")} samples`);
    this.setText(this.dom.footerMessage, `Latest accepted model revision ${message.revision}; stale worker replies are discarded.`);

    this.renderMetrics();
    this.updateScene();
    this.draw();
  }

  postToWorker(payload, transfer = []) {
    if (!this.worker) return;

    try {
      this.worker.postMessage(payload, transfer);
    } catch (error) {
      this.setWorkerFailed(`postMessage failed: ${error.message}`);
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

    this.latestParams = {
      ...this.latestParams,
      reason,
      issuedAt: performance.now()
    };

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
      this.setText(this.dom.solverStatus, "waiting for worker");
      return;
    }

    const revision = this.currentRevision;
    const snapshot = {
      ...this.latestParams,
      fidelity: this.latestParams.fidelity === "full" ? "full" : "preview"
    };

    this.lastSentRevision = revision;
    this.workerBusy = true;

    this.setText(this.dom.solverStatus, `queued r${revision}`);

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
      if (input.type === "checkbox") {
        next[key] = input.checked;
      } else {
        next[key] = Number(input.value);
      }
    }

    next.fidelity = "preview";
    next.modelResolution = 720;

    this.latestParams = next;
  }

  syncControlsFromParams() {
    for (const [key, input] of this.controlMap) {
      const value = this.latestParams[key];

      if (input.type === "checkbox") {
        input.checked = Boolean(value);
      } else if (value !== undefined) {
        input.value = String(value);
      }
    }
  }

  syncControlOutputs() {
    const p = this.latestParams;

    this.output("rpRs", p.rpRs, 3);
    this.output("aRs", p.aRs, 1);
    this.output("inclinationDeg", `${formatNumber(p.inclinationDeg, 2)}°`);
    this.output("eccentricity", p.eccentricity, 2);
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
  }

  output(key, value, digits = null) {
    const node = document.getElementById(`out-${key}`);
    if (!node) return;

    if (typeof value === "number" && digits !== null) {
      node.textContent = formatNumber(value, digits);
    } else {
      node.textContent = String(value);
    }
  }

  async loadTargetCache() {
    try {
      const response = await fetch(`${TARGET_CACHE_URL}?v=${Date.now()}`, {
        cache: "no-store",
        headers: { Accept: "application/json" }
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = await response.json();
      const rows = Array.isArray(payload)
        ? payload
        : Array.isArray(payload.targets)
          ? payload.targets
          : [];

      this.targets = rows.map(normaliseTarget).filter(Boolean);

      if (!this.targets.length) {
        this.targets = [normaliseTarget(DEFAULT_TARGET)];
      }

      this.renderTargetList("");
    } catch (error) {
      this.targets = [normaliseTarget(DEFAULT_TARGET)];
      this.renderTargetList("");
      this.setText(this.dom.footerMessage, `Target cache fallback active: ${error.message}`);
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
        target.lightcurve_available ? "observed photometry real lightcurve" : "model only",
        target.lightcurve_file
      ].join(" ").toLowerCase();

      return clean.split(/\s+/).every(token => haystack.includes(token));
    }).slice(0, 80);

    this.setText(this.dom.targetCount, `${filtered.length}/${this.targets.length}`);

    const fragment = document.createDocumentFragment();

    for (const target of filtered) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "target-row";
      button.dataset.id = target.id;

      if (this.activeTarget?.id === target.id) {
        button.classList.add("active");
      }

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
    const preferred = this.targets.find(target => target.lightcurve_available) || this.targets[0] || normaliseTarget(DEFAULT_TARGET);
    await this.selectTarget(preferred);
  }

  async selectTarget(target) {
    this.activeTarget = target;
    this.latestTarget = target;

    this.setText(this.dom.activeTargetLabel, `${target.pl_name} · ${target.hostname}`);
    this.renderTargetList(this.dom.targetSearch.value);

    this.latestParams = targetToParams(target, this.latestParams);
    this.syncControlsFromParams();
    this.syncControlOutputs();
    this.updateScene();

    await this.loadArchivalLightCurve(target);
    this.sendWorkerDataContext();

    this.issueParameterRevision("target-change");
    this.draw();
  }

  async loadArchivalLightCurve(target) {
    if (!target.lightcurve_available || !target.lightcurve_file) {
      this.archivalCurve = generateSyntheticArchive(target, this.latestParams);
      return;
    }

    try {
      const response = await fetch(`${LIGHTCURVE_BASE_URL}${encodeURIComponent(target.lightcurve_file)}?v=${Date.now()}`, {
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
      this.setText(this.dom.footerMessage, `Observed curve unavailable for ${target.pl_name}; synthetic demonstration data shown.`);
    }
  }

  renderMetrics() {
    this.setText(this.dom.metricResidual, formatPpm(this.metrics.residualRmsPpm));
    this.setText(this.dom.metricOot, formatPpm(this.metrics.ootRmsPpm));
    this.setText(this.dom.metricSnr, this.metrics.snr === null ? "—" : formatNumber(this.metrics.snr, 2));
    this.setText(this.dom.metricDepth, formatPpm(this.metrics.modelDepthPpm));

    const flags = this.metrics.morphologyFlags.length
      ? this.metrics.morphologyFlags
      : ["no morphology flags"];

    const fragment = document.createDocumentFragment();

    for (const flag of flags) {
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = flag;
      fragment.appendChild(pill);
    }

    this.dom.metricFlags.replaceChildren(fragment);
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

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    const pad = {
      left: Math.max(58 * dpr, width * 0.06),
      right: Math.max(18 * dpr, width * 0.02),
      top: Math.max(22 * dpr, height * 0.10),
      bottom: Math.max(40 * dpr, height * 0.18)
    };

    const combined = collectPlotValues(this.archivalCurve, this.latestModel);
    const scale = computeScale(combined);

    const xMap = phase => pad.left + (phase - scale.minPhase) / Math.max(1e-9, scale.maxPhase - scale.minPhase) * (width - pad.left - pad.right);
    const yMap = flux => pad.top + (scale.maxFlux - flux) / Math.max(1e-9, scale.maxFlux - scale.minFlux) * (height - pad.top - pad.bottom);

    drawPlotGrid(ctx, width, height, pad, scale, dpr);
    drawArchivalScatter(ctx, this.archivalCurve, xMap, yMap, dpr);
    drawModelCurve(ctx, this.latestModel, xMap, yMap, dpr);
    drawLegend(ctx, width, pad, dpr);
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
    this.setText(this.dom.footerMessage, message);
  }

  setText(node, value) {
    if (node) node.textContent = String(value);
  }
}

function normaliseTarget(row) {
  if (!row || typeof row !== "object") return null;

  const name = stringValue(row.pl_name || row.name || row.planet || "Unknown planet");
  const host = stringValue(row.hostname || row.host || "Unknown host");

  return {
    id: `${host}::${name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
    pl_name: name,
    hostname: host,
    discoverymethod: stringValue(row.discoverymethod || row.discovery_method || "Transit"),
    pl_orbper: numberValue(row.pl_orbper, 3),
    pl_trandur: numberValue(row.pl_trandur, 2.5),
    pl_trandep: numberValue(row.pl_trandep, numberValue(row.pl_ratror, 0.1) ** 2 * 1e6),
    pl_ratror: numberValue(row.pl_ratror, 0.1),
    pl_orbsmax: numberValue(row.pl_orbsmax, null),
    pl_orbincl: numberValue(row.pl_orbincl, 88.5),
    pl_orbeccen: numberValue(row.pl_orbeccen, 0),
    st_teff: numberValue(row.st_teff, 5772),
    st_rad: numberValue(row.st_rad, 1),
    st_mass: numberValue(row.st_mass, 1),
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
    eccentricity: clamp(numberValue(target.pl_orbeccen, previous.eccentricity), 0, 0.8),
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
  const width = clamp(numberValue(target.pl_trandur, 2.5) / 24 / Math.max(0.2, numberValue(target.pl_orbper, 3)), 0.008, 0.08);

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
  const minPhase = values.phaseValues.length ? Math.min(...values.phaseValues) : -0.12;
  const maxPhase = values.phaseValues.length ? Math.max(...values.phaseValues) : 0.12;
  const minFluxRaw = values.fluxValues.length ? Math.min(...values.fluxValues) : 0.99;
  const maxFluxRaw = values.fluxValues.length ? Math.max(...values.fluxValues) : 1.001;
  const span = Math.max(0.0005, maxFluxRaw - minFluxRaw);

  return {
    minPhase,
    maxPhase,
    minFlux: minFluxRaw - span * 0.18,
    maxFlux: maxFluxRaw + span * 0.15
  };
}

function drawPlotGrid(ctx, width, height, pad, scale, dpr) {
  ctx.save();
  ctx.strokeStyle = "#d9e0ea";
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

  ctx.strokeStyle = "#9eaabc";
  ctx.strokeRect(pad.left, pad.top, width - pad.left - pad.right, height - pad.top - pad.bottom);

  ctx.fillStyle = "#637083";
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

  ctx.fillStyle = "#17202a";
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

function drawArchivalScatter(ctx, archive, xMap, yMap, dpr) {
  ctx.save();
  ctx.fillStyle = "rgba(23,107,135,.50)";

  const radius = Math.max(1.2, 1.45 * dpr);

  for (let i = 0; i < archive.phase.length; i++) {
    ctx.beginPath();
    ctx.arc(xMap(archive.phase[i]), yMap(archive.flux[i]), radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawModelCurve(ctx, model, xMap, yMap, dpr) {
  if (model.phase.length < 2) return;

  ctx.save();
  ctx.beginPath();

  for (let i = 0; i < model.phase.length; i++) {
    const x = xMap(model.phase[i]);
    const y = yMap(model.flux[i]);

    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  ctx.strokeStyle = "#c47a00";
  ctx.lineWidth = Math.max(2, 2.2 * dpr);
  ctx.stroke();
  ctx.restore();
}

function drawLegend(ctx, width, pad, dpr) {
  ctx.save();
  ctx.font = `${12 * dpr}px Inter, system-ui, sans-serif`;
  ctx.textBaseline = "middle";

  const y = pad.top - 10 * dpr;
  const x0 = pad.left;

  ctx.fillStyle = "#176b87";
  ctx.beginPath();
  ctx.arc(x0, y, 4 * dpr, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#17202a";
  ctx.fillText("archival photometry", x0 + 10 * dpr, y);

  const x1 = x0 + 170 * dpr;

  ctx.strokeStyle = "#c47a00";
  ctx.lineWidth = 3 * dpr;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x1 + 22 * dpr, y);
  ctx.stroke();

  ctx.fillStyle = "#17202a";
  ctx.fillText("theoretical worker model", x1 + 32 * dpr, y);

  ctx.restore();
}

function serialiseTarget(target) {
  return {
    pl_name: target.pl_name,
    hostname: target.hostname,
    pl_orbper: numberValue(target.pl_orbper, 3),
    pl_trandur: numberValue(target.pl_trandur, 2.5),
    pl_trandep: numberValue(target.pl_trandep, 10000),
    st_teff: numberValue(target.st_teff, 5772),
    st_rad: numberValue(target.st_rad, 1),
    st_mass: numberValue(target.st_mass, 1)
  };
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

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

const app = new ExoIntelPrimeApp();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => app.boot(), { once: true });
} else {
  app.boot();
}
