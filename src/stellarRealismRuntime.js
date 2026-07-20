/* ============================================================================
   ExoLight Phase III - Realistic stellar photosphere overlay
   ---------------------------------------------------------------------------
   Replaces the visible decorative magnetic-loop render with a lighter, more
   physically plausible canvas view: limb darkening, temperature colour,
   granular texture, facula-like contrast, optional starspot, and transit
   silhouettes. The original WebGL renderer remains as a fallback underneath.
   ============================================================================ */

const TARGET_SEPARATOR = " · ";
const TWO_PI = Math.PI * 2;
const STORAGE_KEY = "exolight-realistic-photosphere-overlay-v01";

let mounted = false;
let canvas = null;
let ctx = null;
let stage = null;
let raf = 0;
let granules = [];
let lastSignature = "";
let state = readState();

function byId(id) {
  return document.getElementById(id);
}

function numeric(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function controlValue(param, fallback = null) {
  const input = document.querySelector(`[data-param="${param}"]`);
  if (!input) return fallback;
  if (input.type === "checkbox") return input.checked;
  return numeric(input.value, fallback);
}

function numberFromText(text, fallback = null) {
  const clean = String(text ?? "").replace(/,/g, "");
  const match = clean.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/i);
  return match ? Number(match[0]) : fallback;
}

function readTargetLabel() {
  const label = byId("active-target-label")?.textContent?.trim() || "";
  if (!label || label === "no target") return { pl_name: "Synthetic Hot Jupiter", hostname: "Demonstration Host" };
  const [planet, host] = label.split(TARGET_SEPARATOR);
  return {
    pl_name: planet?.trim() || label,
    hostname: host?.trim() || "Unknown host"
  };
}

function readState() {
  return {
    target: readTargetLabel(),
    teff: numberFromText(document.querySelector("#star-properties .property strong")?.textContent, 5772),
    rpRs: controlValue("rpRs", 0.1),
    aRs: controlValue("aRs", 12),
    inclinationDeg: controlValue("inclinationDeg", 88.5),
    spotEnabled: Boolean(controlValue("spotEnabled", false)),
    spotX: controlValue("spotX", 0.2),
    spotY: controlValue("spotY", 0.1),
    spotRadius: controlValue("spotRadius", 0.12),
    spotContrast: controlValue("spotContrast", 0.55),
    moonEnabled: Boolean(controlValue("moonEnabled", false)),
    moonRadius: controlValue("moonRadius", 0.025),
    moonDistance: controlValue("moonDistance", 0.55),
    moonPhaseDeg: controlValue("moonPhaseDeg", 45),
    quality: String(document.querySelector('[data-param="visualQuality"]')?.value || "balanced")
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hash(seed) {
  let x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function stellarRgb(teff) {
  const t = clamp((numeric(teff, 5772) - 3200) / 5200, 0, 1);
  const cool = [255, 118, 39];
  const solar = [255, 182, 73];
  const hot = [226, 238, 255];
  const a = t < 0.52 ? t / 0.52 : (t - 0.52) / 0.48;
  const from = t < 0.52 ? cool : solar;
  const to = t < 0.52 ? solar : hot;
  return from.map((v, i) => Math.round(v + (to[i] - v) * a));
}

function rgb(colour, alpha = 1) {
  return `rgba(${colour[0]}, ${colour[1]}, ${colour[2]}, ${alpha})`;
}

function rebuildGranules(width, height) {
  const count = Math.round(clamp((width * height) / 6400, 90, state.quality === "ultra" ? 460 : 280));
  granules = Array.from({ length: count }, (_, i) => {
    const r = Math.sqrt(hash(i + 3.1));
    const a = hash(i + 7.7) * TWO_PI;
    return {
      x: Math.cos(a) * r,
      y: Math.sin(a) * r,
      radius: 0.008 + hash(i + 11.2) * 0.022,
      phase: hash(i + 19.5) * TWO_PI,
      warm: hash(i + 31.1) > 0.56
    };
  });
}

function resize() {
  if (!canvas || !stage) return;
  const rect = stage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
  const width = Math.max(2, Math.floor(rect.width * dpr));
  const height = Math.max(2, Math.floor(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    rebuildGranules(width, height);
  }
}

function drawStar(cx, cy, radius, time) {
  const base = stellarRgb(state.teff);
  const limb = ctx.createRadialGradient(cx - radius * 0.18, cy - radius * 0.22, radius * 0.10, cx, cy, radius);
  limb.addColorStop(0.00, rgb(base.map(v => Math.min(255, v + 46)), 1));
  limb.addColorStop(0.42, rgb(base, 1));
  limb.addColorStop(0.76, rgb(base.map(v => Math.max(0, v * 0.72)), 1));
  limb.addColorStop(1.00, rgb(base.map(v => Math.max(0, v * 0.33)), 1));

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TWO_PI);
  ctx.clip();
  ctx.fillStyle = limb;
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < granules.length; i += 1) {
    const g = granules[i];
    const spin = time * 0.015;
    const x0 = g.x * Math.cos(spin) - g.y * Math.sin(spin);
    const y0 = g.x * Math.sin(spin) + g.y * Math.cos(spin);
    const mu = Math.sqrt(Math.max(0, 1 - x0 * x0 - y0 * y0));
    const flicker = 0.65 + 0.35 * Math.sin(time * 0.7 + g.phase);
    const alpha = (g.warm ? 0.055 : 0.032) * mu * flicker;
    const gr = ctx.createRadialGradient(cx + x0 * radius, cy + y0 * radius, 0, cx + x0 * radius, cy + y0 * radius, g.radius * radius * 6.0);
    gr.addColorStop(0, g.warm ? `rgba(255,235,176,${alpha})` : `rgba(160,65,18,${alpha})`);
    gr.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gr;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }

  ctx.globalCompositeOperation = "multiply";
  for (let i = 0; i < 38; i += 1) {
    const a = hash(i + 4.4) * TWO_PI + time * 0.004;
    const r = Math.sqrt(hash(i + 9.9)) * radius * 0.96;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    const size = radius * (0.015 + hash(i + 1.2) * 0.038);
    ctx.fillStyle = `rgba(80,28,10,${0.020 + hash(i + 2.5) * 0.030})`;
    ctx.beginPath();
    ctx.ellipse(x, y, size * 1.35, size, a, 0, TWO_PI);
    ctx.fill();
  }

  ctx.restore();

  const corona = ctx.createRadialGradient(cx, cy, radius * 0.86, cx, cy, radius * 1.26);
  corona.addColorStop(0, "rgba(255,190,85,0.00)");
  corona.addColorStop(0.55, "rgba(255,175,70,0.055)");
  corona.addColorStop(1, "rgba(255,175,70,0.00)");
  ctx.fillStyle = corona;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 1.28, 0, TWO_PI);
  ctx.fill();
}

function drawSpot(cx, cy, radius) {
  if (!state.spotEnabled) return;
  const x = cx + clamp(state.spotX, -0.9, 0.9) * radius;
  const y = cy - clamp(state.spotY, -0.9, 0.9) * radius;
  const r = clamp(state.spotRadius, 0.02, 0.35) * radius;
  const grad = ctx.createRadialGradient(x, y, 0, x, y, r * 1.4);
  grad.addColorStop(0, `rgba(18,10,7,${0.62 + state.spotContrast * 0.24})`);
  grad.addColorStop(0.45, `rgba(54,22,10,${0.42 + state.spotContrast * 0.20})`);
  grad.addColorStop(1, "rgba(54,22,10,0)");
  ctx.save();
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(x, y, r * 1.18, r * 0.86, 0.25, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

function projectedBody(time, starRadius) {
  const inc = clamp(numeric(state.inclinationDeg, 88.5), 75, 90) * Math.PI / 180;
  const impact = clamp(Math.cos(inc) * numeric(state.aRs, 12), -1.15, 1.15);
  const phase = ((time * 0.018) % 1 + 1) % 1;
  const x = (phase - 0.5) * 3.2;
  return { x: x * starRadius, y: impact * starRadius, phase };
}

function drawPlanet(cx, cy, starRadius, time) {
  const p = projectedBody(time, starRadius);
  const pr = clamp(numeric(state.rpRs, 0.1), 0.01, 0.28) * starRadius;
  const x = cx + p.x;
  const y = cy + p.y;

  ctx.save();
  ctx.fillStyle = "rgba(0,5,10,0.98)";
  ctx.beginPath();
  ctx.arc(x, y, pr, 0, TWO_PI);
  ctx.fill();

  const rim = ctx.createRadialGradient(x - pr * 0.3, y - pr * 0.3, pr * 0.05, x, y, pr);
  rim.addColorStop(0, "rgba(45,130,155,0.06)");
  rim.addColorStop(0.78, "rgba(0,0,0,0.04)");
  rim.addColorStop(1, "rgba(89,208,229,0.22)");
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.arc(x, y, pr, 0, TWO_PI);
  ctx.fill();

  if (state.moonEnabled) {
    const ma = numeric(state.moonPhaseDeg, 45) * Math.PI / 180 + time * 0.12;
    const md = numeric(state.moonDistance, 0.55) * starRadius * 0.32;
    const mr = clamp(numeric(state.moonRadius, 0.025), 0.004, 0.08) * starRadius;
    ctx.fillStyle = "rgba(3,7,12,0.94)";
    ctx.beginPath();
    ctx.arc(x + Math.cos(ma) * md, y + Math.sin(ma) * md, mr, 0, TWO_PI);
    ctx.fill();
  }

  ctx.restore();
}

function drawLabels(width, height, cx, cy, radius) {
  ctx.save();
  ctx.font = `${Math.max(10, width * 0.009)}px ui-monospace, SFMono-Regular, Consolas, monospace`;
  ctx.fillStyle = "rgba(220,235,255,0.76)";
  ctx.textAlign = "left";
  ctx.fillText("limb-darkened stellar photosphere", 18, 24);
  ctx.fillStyle = "rgba(160,180,205,0.66)";
  ctx.fillText("granulation texture · transit silhouette · no illustrative field loops", 18, 42);

  ctx.strokeStyle = "rgba(120,190,255,0.22)";
  ctx.setLineDash([7, 7]);
  ctx.beginPath();
  ctx.moveTo(cx - radius * 1.45, cy);
  ctx.lineTo(cx + radius * 1.45, cy);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function draw(time = 0) {
  if (!canvas || !ctx || !stage) return;
  resize();
  state = readState();
  const width = canvas.width;
  const height = canvas.height;
  const cx = width * 0.5;
  const cy = height * 0.52;
  const radius = Math.min(width, height) * 0.31;

  ctx.clearRect(0, 0, width, height);

  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, "rgba(5,13,25,0.98)");
  bg.addColorStop(1, "rgba(2,6,13,0.98)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < 220; i += 1) {
    const x = hash(i + 100.1) * width;
    const y = hash(i + 200.3) * height;
    const a = 0.04 + hash(i + 400.8) * 0.11;
    ctx.fillStyle = `rgba(180,210,255,${a})`;
    ctx.fillRect(x, y, 1.2, 1.2);
  }

  drawStar(cx, cy, radius, time * 0.001);
  drawSpot(cx, cy, radius);
  drawPlanet(cx, cy, radius, time * 0.001);
  drawLabels(width, height, cx, cy, radius);

  raf = requestAnimationFrame(draw);
}

function hideOriginalWebgl() {
  const original = stage?.querySelector("canvas:not(.stellar-realism-canvas)");
  if (original) {
    original.style.opacity = "0";
    original.style.pointerEvents = "none";
  }
}

function ensureOverlay() {
  stage = byId("scene-stage");
  if (!stage) return false;

  stage.classList.add("stellar-realism-stage");
  hideOriginalWebgl();

  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.className = "stellar-realism-canvas";
    canvas.setAttribute("aria-label", "Realistic stellar photosphere and transit scene");
    Object.assign(canvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      zIndex: "4",
      display: "block",
      pointerEvents: "none"
    });
    stage.appendChild(canvas);
    ctx = canvas.getContext("2d", { alpha: true });
  }

  return Boolean(ctx);
}

function watchState() {
  const observer = new MutationObserver(() => {
    const next = JSON.stringify(readState());
    if (next !== lastSignature) {
      lastSignature = next;
      hideOriginalWebgl();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });

  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("exolight:tab-change", event => {
    if (event.detail?.tab === "model") {
      hideOriginalWebgl();
      if (!raf) raf = requestAnimationFrame(draw);
    }
  });
}

function boot() {
  if (mounted) return;
  mounted = true;

  const attempt = () => {
    if (!ensureOverlay()) {
      requestAnimationFrame(attempt);
      return;
    }

    watchState();
    if (!raf) raf = requestAnimationFrame(draw);
    localStorage?.setItem(STORAGE_KEY, "enabled");
    const status = byId("scene-status");
    if (status) status.textContent = "realistic photosphere renderer online";
  };

  attempt();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
