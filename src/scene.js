/* ============================================================================
   ExoIntel-Prime Recovery Scene Renderer
   Stable cinematic Canvas renderer with physics-synchronised visual geometry.
   This avoids WebGL shader failures while keeping high-end visual quality.
   ============================================================================ */

const TWO_PI = Math.PI * 2;

export class ExoSceneRenderer {
  constructor({ container, onStatus = () => {}, onWarning = () => {} } = {}) {
    this.container = container;
    this.onStatus = onStatus;
    this.onWarning = onWarning;
    this.canvas = null;
    this.ctx = null;
    this.overlay = null;
    this.frameHandle = null;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
    this.phase = 0;
    this.lastTime = 0;
    this.starTexture = null;
    this.starTextureKey = "";
    this.params = {
      rpRs: 0.1,
      aRs: 12,
      inclinationDeg: 88.5,
      eccentricity: 0,
      omegaDeg: 90,
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
      visualQuality: "balanced"
    };
    this.target = { pl_name: "Synthetic Hot Jupiter", hostname: "Demonstration Host", st_teff: 5772 };
    this.model = { phase: new Float32Array(0), flux: new Float32Array(0), revision: 0 };
  }

  mount() {
    if (!this.container) {
      this.onWarning("Scene renderer could not mount because no container was supplied.");
      return;
    }
    this.container.innerHTML = "";
    this.container.style.position = "relative";
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("aria-label", "Theoretical exoplanet transit CGI model viewport");
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.display = "block";
    this.overlay = document.createElement("div");
    this.overlay.className = "scene-overlay";
    this.overlay.textContent = "Theoretical CGI model · projected orbit visualisation · photometry calculated by the worker";
    this.container.append(this.canvas, this.overlay);
    this.ctx = this.canvas.getContext("2d", { alpha: true });
    if (!this.ctx) {
      this.onWarning("Canvas renderer unavailable.");
      return;
    }
    window.addEventListener("resize", () => this.resize(), { passive: true });
    this.resize();
    this.onStatus("Cinematic scene online");
    this.frameHandle = requestAnimationFrame(t => this.loop(t));
  }

  dispose() {
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
  }

  updateState({ params = null, target = null, model = null } = {}) {
    if (params) {
      const oldKey = this.textureKey();
      this.params = { ...this.params, ...params };
      if (oldKey !== this.textureKey()) this.starTexture = null;
    }
    if (target) {
      const oldTeff = this.target?.st_teff;
      this.target = { ...this.target, ...target };
      if (oldTeff !== this.target.st_teff) this.starTexture = null;
    }
    if (model?.phase?.length && model?.flux?.length) this.model = model;
    this.updateOverlayText();
  }

  updateOverlayText() {
    if (!this.overlay) return;
    const name = this.target?.pl_name || "selected target";
    const host = this.target?.hostname || "host star";
    const e = clamp(numberOr(this.params.eccentricity, 0), 0, 0.95);
    const omega = normaliseDegrees(numberOr(this.params.omegaDeg, 90));
    const geometry = e > 1e-5 ? `eccentric e=${e.toFixed(3)}, ω=${omega.toFixed(1)}°` : "circular geometry";
    const spot = this.params.spotEnabled ? "starspot hypothesis active" : "starspot off";
    const moon = this.params.moonEnabled ? "exomoon hypothesis active" : "moon off";
    const quality = this.params.visualQuality || "balanced";
    this.overlay.textContent = `${name} around ${host} · ${geometry} · ${spot} · ${moon} · ${quality} visual quality`;
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(2, Math.floor(rect.width * this.pixelRatio));
    const height = Math.max(2, Math.floor(rect.height * this.pixelRatio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.starTexture = null;
    }
  }

  loop(time) {
    const dt = Math.min(0.05, Math.max(0, (time - this.lastTime) / 1000 || 0));
    this.lastTime = time;
    const speed = this.params.visualQuality === "low" ? 0.040 : 0.052;
    this.phase = wrap01(this.phase + dt * speed);
    this.render(time * 0.001);
    this.frameHandle = requestAnimationFrame(t => this.loop(t));
  }

  render(time) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.resize();
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    this.drawBackground(ctx, w, h, time);

    const cx = w * 0.50;
    const cy = h * 0.50;
    const starR = Math.min(w, h) * 0.245;
    const orbitScale = Math.min(w, h) * 0.42;
    const bodies = this.computeBodyPositions(orbitScale, cx, cy);

    this.drawOrbit(ctx, cx, cy, orbitScale);
    this.drawTransitChord(ctx, cx, cy, starR);

    const behind = [];
    const front = [];
    if (bodies.planet.front) front.push(bodies.planet); else behind.push(bodies.planet);
    if (bodies.moon.enabled) { if (bodies.moon.front) front.push(bodies.moon); else behind.push(bodies.moon); }

    behind.forEach(body => this.drawBody(ctx, body));
    this.drawStarGlow(ctx, cx, cy, starR, time);
    this.drawStar(ctx, cx, cy, starR, time);
    front.forEach(body => this.drawBody(ctx, body));
    if (bodies.moon.enabled) this.drawMoonOrbit(ctx, bodies.planet, bodies.moon);
  }

  drawBackground(ctx, w, h, time) {
    const grad = ctx.createRadialGradient(w * 0.52, h * 0.42, 0, w * 0.52, h * 0.42, Math.max(w, h) * 0.8);
    grad.addColorStop(0, "rgba(255,181,71,0.08)");
    grad.addColorStop(0.35, "rgba(99,167,255,0.06)");
    grad.addColorStop(1, "rgba(3,7,18,0.00)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    const count = this.params.visualQuality === "ultra" ? 240 : this.params.visualQuality === "low" ? 70 : 130;
    ctx.save();
    for (let i = 0; i < count; i++) {
      const x = seededRandom(i * 11.3) * w;
      const y = seededRandom(i * 17.1) * h;
      const tw = 0.35 + 0.65 * Math.sin(time * 0.7 + i) ** 2;
      const r = (0.45 + seededRandom(i * 23.9) * 1.3) * this.pixelRatio;
      ctx.fillStyle = `rgba(180,220,255,${0.07 + tw * 0.22})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TWO_PI); ctx.fill();
    }
    ctx.restore();
  }

  drawOrbit(ctx, cx, cy, scale) {
    const p = this.params;
    ctx.save();
    ctx.lineWidth = 1.3 * this.pixelRatio;
    ctx.strokeStyle = numberOr(p.eccentricity, 0) > 1e-5 ? "rgba(80,198,223,0.38)" : "rgba(99,167,255,0.28)";
    ctx.beginPath();
    const n = 360;
    for (let i = 0; i <= n; i++) {
      const g = projectedVisualGeometry(i / n, p);
      const x = cx + g.planet.x * scale;
      const y = cy + g.planet.y * scale;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawTransitChord(ctx, cx, cy, starR) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,181,71,0.16)";
    ctx.lineWidth = 1 * this.pixelRatio;
    ctx.beginPath();
    ctx.moveTo(cx - starR * 1.85, cy);
    ctx.lineTo(cx + starR * 1.85, cy);
    ctx.stroke();
    ctx.restore();
  }

  drawStarGlow(ctx, cx, cy, r, time) {
    const colour = stellarColour(numberOr(this.target.st_teff, 5772));
    const glow = ctx.createRadialGradient(cx, cy, r * 0.72, cx, cy, r * 1.70);
    glow.addColorStop(0, `rgba(${colour[0]},${colour[1]},${colour[2]},0.36)`);
    glow.addColorStop(0.48, `rgba(${colour[0]},${colour[1]},${colour[2]},0.10)`);
    glow.addColorStop(1, `rgba(${colour[0]},${colour[1]},${colour[2]},0)`);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(cx, cy, r * (1.68 + 0.02 * Math.sin(time * 0.7)), 0, TWO_PI); ctx.fill();
    ctx.restore();
  }

  drawStar(ctx, cx, cy, r, time) {
    const texture = this.getStarTexture(Math.max(220, Math.round(r * 2.2)));
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TWO_PI); ctx.clip();
    ctx.drawImage(texture, cx - r, cy - r, 2 * r, 2 * r);
    const limb = ctx.createRadialGradient(cx - r * 0.18, cy - r * 0.22, r * 0.05, cx, cy, r);
    limb.addColorStop(0, "rgba(255,255,255,0.18)");
    limb.addColorStop(0.55, "rgba(255,180,70,0.04)");
    limb.addColorStop(0.92, "rgba(74,24,3,0.38)");
    limb.addColorStop(1, "rgba(0,0,0,0.54)");
    ctx.fillStyle = limb; ctx.fillRect(cx-r, cy-r, 2*r, 2*r);
    if (this.params.spotEnabled) this.drawSpot(ctx, cx, cy, r);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = "rgba(255,181,71,0.25)";
    ctx.lineWidth = 1.2 * this.pixelRatio;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TWO_PI); ctx.stroke();
    ctx.restore();
  }

  drawSpot(ctx, cx, cy, r) {
    const sx = cx + clamp(numberOr(this.params.spotX, 0.2), -0.9, 0.9) * r;
    const sy = cy - clamp(numberOr(this.params.spotY, 0.1), -0.9, 0.9) * r;
    const sr = clamp(numberOr(this.params.spotRadius, 0.12), 0.02, 0.3) * r;
    const contrast = clamp(numberOr(this.params.spotContrast, 0.55), 0.05, 0.95);
    ctx.save();
    for (let i = 0; i < 18; i++) {
      const a = i / 18 * TWO_PI;
      const rr = sr * (0.82 + 0.18 * Math.sin(i * 2.1));
      if (i === 0) { ctx.beginPath(); ctx.moveTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr); }
      else ctx.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr);
    }
    ctx.closePath();
    const grad = ctx.createRadialGradient(sx, sy, sr * 0.15, sx, sy, sr * 1.15);
    grad.addColorStop(0, `rgba(20,8,3,${0.72 * contrast})`);
    grad.addColorStop(0.55, `rgba(55,18,6,${0.55 * contrast})`);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad; ctx.fill(); ctx.restore();
  }

  drawBody(ctx, body) {
    const [x, y, z] = body.position;
    const r = Math.max(2.5 * this.pixelRatio, body.radius);
    const shadowOffset = Math.max(1, r * 0.18);
    ctx.save();
    ctx.translate(x, y);
    const g = ctx.createRadialGradient(-r * 0.28, -r * 0.28, r * 0.1, 0, 0, r);
    if (body.type === "moon") {
      g.addColorStop(0, "rgba(220,214,190,0.95)");
      g.addColorStop(0.62, "rgba(110,108,100,0.85)");
      g.addColorStop(1, "rgba(5,8,14,0.96)");
    } else {
      g.addColorStop(0, "rgba(70,120,135,0.95)");
      g.addColorStop(0.52, "rgba(20,52,67,0.90)");
      g.addColorStop(1, "rgba(1,8,14,0.98)");
    }
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TWO_PI); ctx.fill();
    ctx.strokeStyle = body.front ? "rgba(80,198,223,0.28)" : "rgba(99,167,255,0.14)";
    ctx.lineWidth = 1 * this.pixelRatio;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TWO_PI); ctx.stroke();
    ctx.fillStyle = `rgba(0,0,0,${body.front ? 0.18 : 0.50})`;
    ctx.beginPath(); ctx.ellipse(shadowOffset, shadowOffset * 0.2, r * 0.72, r * 0.92, 0, 0, TWO_PI); ctx.fill();
    ctx.restore();
  }

  drawMoonOrbit(ctx, planet, moon) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,181,71,0.22)";
    ctx.lineWidth = 1 * this.pixelRatio;
    ctx.beginPath();
    ctx.ellipse(planet.position[0], planet.position[1], Math.abs(moon.position[0] - planet.position[0]), Math.max(3, Math.abs(moon.position[1] - planet.position[1]) * 1.4), 0, 0, TWO_PI);
    ctx.stroke();
    ctx.restore();
  }

  computeBodyPositions(scale, cx, cy) {
    const projected = projectedVisualGeometry(this.phase, this.params);
    const starR = Math.min(this.canvas.width, this.canvas.height) * 0.245;
    const planetR = clamp(numberOr(this.params.rpRs, 0.1), 0.01, 0.28) * starR;
    const moonR = clamp(numberOr(this.params.moonRadius, 0.025), 0.004, 0.08) * starR;
    return {
      planet: { type: "planet", position: [cx + projected.planet.x * scale, cy + projected.planet.y * scale, projected.planet.z], radius: planetR, front: projected.planet.front },
      moon: { type: "moon", enabled: Boolean(this.params.moonEnabled), position: [cx + projected.moon.x * scale, cy + projected.moon.y * scale, projected.moon.z], radius: moonR, front: projected.moon.front }
    };
  }

  getStarTexture(size) {
    const key = `${size}|${Math.round(numberOr(this.target.st_teff, 5772))}|${this.params.visualQuality}`;
    if (this.starTexture && this.starTextureKey === key) return this.starTexture;
    const c = document.createElement("canvas"); c.width = size; c.height = size;
    const ctx = c.getContext("2d");
    const colour = stellarColour(numberOr(this.target.st_teff, 5772));
    const image = ctx.createImageData(size, size);
    const q = this.params.visualQuality === "ultra" ? 1.0 : this.params.visualQuality === "low" ? 0.58 : 0.82;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = (x / (size - 1)) * 2 - 1;
        const ny = (y / (size - 1)) * 2 - 1;
        const rr = Math.hypot(nx, ny);
        const i = (y * size + x) * 4;
        if (rr > 1) { image.data[i + 3] = 0; continue; }
        const mu = Math.sqrt(Math.max(0, 1 - rr * rr));
        const gran = 0.82 + q * (0.14 * noise2(x * 0.055, y * 0.055) + 0.10 * noise2(x * 0.16 + 20, y * 0.16 - 7));
        const limb = 0.38 + 0.62 * Math.pow(mu, 0.72);
        image.data[i] = clamp255(colour[0] * gran * limb);
        image.data[i + 1] = clamp255(colour[1] * gran * limb);
        image.data[i + 2] = clamp255(colour[2] * gran * limb);
        image.data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    this.starTexture = c;
    this.starTextureKey = key;
    return c;
  }

  textureKey() { return `${this.params.visualQuality}|${this.params.u1}|${this.params.u2}|${this.params.spotEnabled}`; }
}

function projectedVisualGeometry(phase01, params) {
  const p = params || {};
  const aRs = clamp(numberOr(p.aRs, 12), 2, 100);
  const inc = degToRad(clamp(numberOr(p.inclinationDeg, 88.5), 0, 90));
  const e = clamp(numberOr(p.eccentricity, 0), 0, 0.95);
  const omega = degToRad(normaliseDegrees(numberOr(p.omegaDeg, 90)));
  const phase = wrap01(phase01);
  let xPhysical, yPhysical, zPhysical, rPhysical;
  if (e > 1e-5) {
    const f0 = wrapRadians(Math.PI / 2 - omega);
    const e0 = trueAnomalyToEccentricAnomaly(f0, e);
    const m0 = eccentricAnomalyToMeanAnomaly(e0, e);
    const E = solveKepler(m0 + TWO_PI * phase, e);
    const f = eccentricAnomalyToTrueAnomaly(E, e);
    rPhysical = aRs * (1 - e * e) / Math.max(1e-8, 1 + e * Math.cos(f));
    const u = omega + f;
    xPhysical = -rPhysical * Math.cos(u);
    yPhysical = rPhysical * Math.sin(u) * Math.cos(inc);
    zPhysical = rPhysical * Math.sin(u) * Math.sin(inc);
  } else {
    const theta = TWO_PI * phase;
    rPhysical = aRs;
    xPhysical = -aRs * Math.sin(theta);
    yPhysical = aRs * Math.cos(inc) * Math.cos(theta);
    zPhysical = aRs * Math.sin(inc) * Math.cos(theta);
  }
  const normalisation = Math.max(aRs, 1e-6);
  const visualOrbitScale = 1.76;
  const x = xPhysical / normalisation * visualOrbitScale;
  const y = yPhysical / normalisation * visualOrbitScale;
  const z = zPhysical / normalisation * visualOrbitScale * 1.08;
  const moonPhase = degToRad(normaliseDegrees(numberOr(p.moonPhaseDeg, 45))) + phase * TWO_PI * 5;
  const moonDistance = clamp(numberOr(p.moonDistance, 0.55), 0.02, 3.0) * 0.22;
  return { planet: { x, y, z, front: z >= 0 }, moon: { x: x + moonDistance * Math.cos(moonPhase), y: y + moonDistance * 0.58 * Math.sin(moonPhase), z: z + moonDistance * 0.42 * Math.sin(moonPhase), front: z + moonDistance * 0.42 * Math.sin(moonPhase) >= 0 } };
}

function solveKepler(M, e) { e = clamp(e, 0, 0.95); const m = wrapRadians(M); if (e < 1e-8) return m; let E = e < 0.8 ? m : Math.PI; for (let i = 0; i < 30; i++) { const f = E - e * Math.sin(E) - m; const fp = 1 - e * Math.cos(E); const dE = -f / Math.max(fp, 1e-12); E += dE; if (Math.abs(dE) < 1e-12) break; } return E; }
function trueAnomalyToEccentricAnomaly(f, e) { if (e < 1e-8) return wrapRadians(f); const factor = Math.sqrt((1 - e) / (1 + e)); return wrapRadians(2 * Math.atan2(factor * Math.sin(f / 2), Math.cos(f / 2))); }
function eccentricAnomalyToTrueAnomaly(E, e) { if (e < 1e-8) return wrapRadians(E); const factor = Math.sqrt((1 + e) / (1 - e)); return wrapRadians(2 * Math.atan2(factor * Math.sin(E / 2), Math.cos(E / 2))); }
function eccentricAnomalyToMeanAnomaly(E, e) { return wrapRadians(E - e * Math.sin(E)); }
function stellarColour(teff) { if (teff < 3600) return [255, 70, 26]; if (teff < 5200) return [255, 116, 35]; if (teff < 6500) return [255, 168, 64]; if (teff < 8500) return [190, 218, 255]; return [130, 170, 255]; }
function noise2(x, y) { return Math.sin(x * 12.9898 + y * 78.233) * 0.5 + Math.sin(x * 39.346 + y * 11.135) * 0.25 + 0.25; }
function seededRandom(seed) { const x = Math.sin(seed * 12.9898) * 43758.5453123; return x - Math.floor(x); }
function numberOr(value, fallback) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function clamp255(value) { return Math.max(0, Math.min(255, Math.round(value))); }
function degToRad(deg) { return deg * Math.PI / 180; }
function normaliseDegrees(deg) { let value = Number(deg); if (!Number.isFinite(value)) return 0; value %= 360; if (value < 0) value += 360; return value; }
function wrap01(value) { let result = value % 1; if (result < 0) result += 1; return result; }
function wrapRadians(angle) { let value = Number(angle); if (!Number.isFinite(value)) return 0; value %= TWO_PI; if (value < 0) value += TWO_PI; return value; }
