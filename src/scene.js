/* ============================================================================
   ExoIntel-Prime Scene Renderer — Stabilised Cinematic v2
   ---------------------------------------------------------------------------
   This renderer is deliberately stable: it uses Canvas 2D instead of fragile
   browser-dependent WebGL shaders, but it is drawn with layered lighting,
   limb darkening, pseudo-granulation, realistic spot blending, and slow moon
   motion. It keeps the same projected geometry convention as the worker.
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

    this.target = {
      pl_name: "Synthetic Hot Jupiter",
      hostname: "Demonstration Host",
      st_teff: 5772
    };

    this.model = {
      phase: new Float32Array(0),
      flux: new Float32Array(0),
      revision: 0
    };
  }

  mount() {
    if (!this.container) {
      this.onWarning("Scene renderer could not mount because no container was supplied.");
      return;
    }

    this.container.innerHTML = "";
    this.container.style.position = "relative";
    this.container.style.overflow = "hidden";

    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("aria-label", "Theoretical exoplanet transit CGI model viewport");
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.display = "block";

    this.overlay = document.createElement("div");
    this.overlay.className = "scene-overlay";
    this.overlay.style.position = "absolute";
    this.overlay.style.left = "16px";
    this.overlay.style.bottom = "16px";
    this.overlay.style.maxWidth = "760px";
    this.overlay.style.padding = "9px 12px";
    this.overlay.style.border = "1px solid rgba(120,145,180,.38)";
    this.overlay.style.borderRadius = "14px";
    this.overlay.style.background = "rgba(5,10,18,.46)";
    this.overlay.style.color = "#dbeafe";
    this.overlay.style.font = "12px Inter, system-ui, sans-serif";
    this.overlay.style.backdropFilter = "blur(12px)";
    this.overlay.style.boxShadow = "0 14px 34px rgba(0,0,0,.24)";
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
    this.frameHandle = requestAnimationFrame(time => this.loop(time));
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

    if (model?.phase?.length && model?.flux?.length) {
      this.model = model;
    }

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

    /* Slower full-orbit presentation. The previous recovery file was visually
       too fast, especially with the moon enabled. */
    const speed = this.params.visualQuality === "low" ? 0.024 : 0.030;
    this.phase = wrap01(this.phase + dt * speed);

    this.render(time * 0.001);
    this.frameHandle = requestAnimationFrame(next => this.loop(next));
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

    if (bodies.planet.front) front.push(bodies.planet);
    else behind.push(bodies.planet);

    if (bodies.moon.enabled) {
      if (bodies.moon.front) front.push(bodies.moon);
      else behind.push(bodies.moon);
    }

    behind.forEach(body => this.drawBody(ctx, body));

    this.drawStarGlow(ctx, cx, cy, starR, time);
    this.drawStar(ctx, cx, cy, starR, time);

    if (bodies.moon.enabled) this.drawMoonOrbit(ctx, bodies.planet, bodies.moon);
    front.forEach(body => this.drawBody(ctx, body));
  }

  drawBackground(ctx, w, h, time) {
    const grad = ctx.createRadialGradient(w * 0.52, h * 0.42, 0, w * 0.52, h * 0.42, Math.max(w, h) * 0.82);
    grad.addColorStop(0, "rgba(255,181,71,0.09)");
    grad.addColorStop(0.35, "rgba(99,167,255,0.065)");
    grad.addColorStop(1, "rgba(3,7,18,0.00)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const count = this.params.visualQuality === "ultra" ? 300 : this.params.visualQuality === "low" ? 80 : 160;

    ctx.save();
    for (let i = 0; i < count; i++) {
      const x = seededRandom(i * 11.3) * w;
      const y = seededRandom(i * 17.1) * h;
      const tw = 0.35 + 0.65 * Math.sin(time * 0.55 + i) ** 2;
      const r = (0.45 + seededRandom(i * 23.9) * 1.25) * this.pixelRatio;
      ctx.fillStyle = `rgba(180,220,255,${0.06 + tw * 0.20})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TWO_PI);
      ctx.fill();
    }
    ctx.restore();
  }

  drawOrbit(ctx, cx, cy, scale) {
    const p = this.params;
    const e = numberOr(p.eccentricity, 0);

    ctx.save();
    ctx.lineWidth = 1.15 * this.pixelRatio;
    ctx.strokeStyle = e > 1e-5 ? "rgba(80,198,223,0.30)" : "rgba(99,167,255,0.24)";
    ctx.beginPath();

    const n = 400;
    for (let i = 0; i <= n; i++) {
      const g = projectedVisualGeometry(i / n, p);
      const x = cx + g.planet.x * scale;
      const y = cy + g.planet.y * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.stroke();
    ctx.restore();
  }

  drawTransitChord(ctx, cx, cy, starR) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,181,71,0.12)";
    ctx.lineWidth = 0.9 * this.pixelRatio;
    ctx.beginPath();
    ctx.moveTo(cx - starR * 1.85, cy);
    ctx.lineTo(cx + starR * 1.85, cy);
    ctx.stroke();
    ctx.restore();
  }

  drawStarGlow(ctx, cx, cy, r, time) {
    const colour = stellarColour(numberOr(this.target.st_teff, 5772));
    const glow = ctx.createRadialGradient(cx, cy, r * 0.68, cx, cy, r * 1.92);
    glow.addColorStop(0, `rgba(${colour[0]},${colour[1]},${colour[2]},0.34)`);
    glow.addColorStop(0.38, `rgba(${colour[0]},${colour[1]},${colour[2]},0.13)`);
    glow.addColorStop(1, `rgba(${colour[0]},${colour[1]},${colour[2]},0)`);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, r * (1.72 + 0.012 * Math.sin(time * 0.45)), 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }

  drawStar(ctx, cx, cy, r, time) {
    const texture = this.getStarTexture(Math.max(260, Math.round(r * 2.45)));

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TWO_PI);
    ctx.clip();

    ctx.drawImage(texture, cx - r, cy - r, 2 * r, 2 * r);

    /* Pseudo-3D limb darkening and directional illumination. */
    const limb = ctx.createRadialGradient(cx - r * 0.33, cy - r * 0.30, r * 0.08, cx, cy, r * 1.05);
    limb.addColorStop(0, "rgba(255,244,204,0.24)");
    limb.addColorStop(0.36, "rgba(255,190,78,0.055)");
    limb.addColorStop(0.72, "rgba(109,45,8,0.15)");
    limb.addColorStop(1, "rgba(0,0,0,0.58)");
    ctx.fillStyle = limb;
    ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);

    const terminator = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    terminator.addColorStop(0, "rgba(255,255,255,0.07)");
    terminator.addColorStop(0.48, "rgba(255,255,255,0.00)");
    terminator.addColorStop(1, "rgba(0,0,0,0.20)");
    ctx.fillStyle = terminator;
    ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);

    if (this.params.spotEnabled) this.drawSpot(ctx, cx, cy, r, time);

    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(255,181,71,0.22)";
    ctx.lineWidth = 1.15 * this.pixelRatio;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TWO_PI);
    ctx.stroke();
    ctx.restore();
  }

  drawSpot(ctx, cx, cy, r, time) {
    const rawX = clamp(numberOr(this.params.spotX, 0.2), -0.88, 0.88);
    const rawY = clamp(numberOr(this.params.spotY, 0.1), -0.88, 0.88);
    const sx = cx + rawX * r;
    const sy = cy - rawY * r;
    const sr = clamp(numberOr(this.params.spotRadius, 0.12), 0.02, 0.30) * r;
    const contrast = clamp(numberOr(this.params.spotContrast, 0.55), 0.05, 0.95);

    const limbDistance = Math.hypot(rawX, rawY);
    const foreshortening = clamp(Math.sqrt(Math.max(0.05, 1 - limbDistance * limbDistance)), 0.24, 1);
    const angleTilt = rawX * 0.38;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(angleTilt);
    ctx.scale(1.0, foreshortening);

    /* Penumbra: large, soft, low-contrast, irregular. */
    const penPath = irregularClosedPath(sr, 34, 0.17, 11.7, time * 0.04);
    ctx.beginPath();
    for (let i = 0; i < penPath.length; i++) {
      const p = penPath[i];
      if (i === 0) ctx.moveTo(p[0], p[1]);
      else ctx.lineTo(p[0], p[1]);
    }
    ctx.closePath();

    const penGrad = ctx.createRadialGradient(-sr * 0.12, -sr * 0.10, sr * 0.05, 0, 0, sr * 1.25);
    penGrad.addColorStop(0, `rgba(34,16,8,${0.55 * contrast})`);
    penGrad.addColorStop(0.52, `rgba(75,34,12,${0.32 * contrast})`);
    penGrad.addColorStop(1, `rgba(0,0,0,0)`);
    ctx.fillStyle = penGrad;
    ctx.fill();

    /* Umbra: smaller, offset, not a cartoon circle. */
    const umbPath = irregularClosedPath(sr * 0.47, 26, 0.24, 5.3, time * 0.02);
    ctx.beginPath();
    for (let i = 0; i < umbPath.length; i++) {
      const p = umbPath[i];
      if (i === 0) ctx.moveTo(p[0] - sr * 0.08, p[1] - sr * 0.05);
      else ctx.lineTo(p[0] - sr * 0.08, p[1] - sr * 0.05);
    }
    ctx.closePath();

    const umbGrad = ctx.createRadialGradient(-sr * 0.15, -sr * 0.12, sr * 0.02, 0, 0, sr * 0.65);
    umbGrad.addColorStop(0, `rgba(6,3,2,${0.82 * contrast})`);
    umbGrad.addColorStop(0.78, `rgba(28,11,4,${0.62 * contrast})`);
    umbGrad.addColorStop(1, `rgba(0,0,0,0)`);
    ctx.fillStyle = umbGrad;
    ctx.fill();

    ctx.restore();
  }

  drawBody(ctx, body) {
    const [x, y, z] = body.position;
    const r = Math.max(2.5 * this.pixelRatio, body.radius);

    ctx.save();
    ctx.translate(x, y);

    /* A subtle projected shadow under the body helps depth ordering. */
    ctx.save();
    ctx.globalAlpha = body.front ? 0.16 : 0.08;
    ctx.fillStyle = "black";
    ctx.beginPath();
    ctx.ellipse(r * 0.16, r * 0.10, r * 0.92, r * 0.55, 0, 0, TWO_PI);
    ctx.fill();
    ctx.restore();

    const lightX = -0.45;
    const lightY = -0.42;
    const g = ctx.createRadialGradient(lightX * r, lightY * r, r * 0.08, 0, 0, r * 1.08);

    if (body.type === "moon") {
      g.addColorStop(0, "rgba(210,205,184,0.98)");
      g.addColorStop(0.52, "rgba(115,112,102,0.92)");
      g.addColorStop(1, "rgba(4,7,12,0.98)");
    } else {
      g.addColorStop(0, "rgba(66,116,128,0.98)");
      g.addColorStop(0.45, "rgba(18,53,66,0.95)");
      g.addColorStop(1, "rgba(1,7,13,0.99)");
    }

    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TWO_PI);
    ctx.fill();

    const rim = ctx.createRadialGradient(r * 0.18, r * 0.05, r * 0.15, 0, 0, r);
    rim.addColorStop(0, "rgba(255,255,255,0)");
    rim.addColorStop(0.78, body.type === "moon" ? "rgba(255,232,190,0.05)" : "rgba(80,198,223,0.04)");
    rim.addColorStop(1, body.front ? "rgba(80,198,223,0.30)" : "rgba(99,167,255,0.10)");
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TWO_PI);
    ctx.fill();

    if (body.type === "planet") this.drawPlanetBands(ctx, r);
    if (body.type === "moon") this.drawMoonCraters(ctx, r);

    ctx.strokeStyle = body.front ? "rgba(80,198,223,0.24)" : "rgba(99,167,255,0.10)";
    ctx.lineWidth = 1 * this.pixelRatio;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TWO_PI);
    ctx.stroke();

    ctx.restore();
  }

  drawPlanetBands(ctx, r) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TWO_PI);
    ctx.clip();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = "rgba(156,220,230,0.55)";
    ctx.lineWidth = Math.max(0.6, r * 0.035);
    for (let y = -0.45; y <= 0.45; y += 0.23) {
      ctx.beginPath();
      ctx.ellipse(0, y * r, r * 0.92, r * 0.16, 0, 0, TWO_PI);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawMoonCraters(ctx, r) {
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "rgba(20,20,18,0.9)";
    for (let i = 0; i < 5; i++) {
      const x = (seededRandom(i * 4.7) - 0.5) * r * 0.9;
      const y = (seededRandom(i * 6.1) - 0.5) * r * 0.75;
      const rr = r * (0.045 + seededRandom(i * 2.3) * 0.060);
      if (Math.hypot(x, y) < r * 0.78) {
        ctx.beginPath();
        ctx.arc(x, y, rr, 0, TWO_PI);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawMoonOrbit(ctx, planet, moon) {
    const dx = Math.abs(moon.position[0] - planet.position[0]);
    const dy = Math.abs(moon.position[1] - planet.position[1]);
    const rx = clamp(dx, 8 * this.pixelRatio, 95 * this.pixelRatio);
    const ry = clamp(Math.max(4 * this.pixelRatio, dy * 1.25), 4 * this.pixelRatio, 52 * this.pixelRatio);

    ctx.save();
    ctx.strokeStyle = "rgba(255,181,71,0.16)";
    ctx.lineWidth = 0.85 * this.pixelRatio;
    ctx.setLineDash([4 * this.pixelRatio, 5 * this.pixelRatio]);
    ctx.beginPath();
    ctx.ellipse(planet.position[0], planet.position[1], rx, ry, 0, 0, TWO_PI);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  computeBodyPositions(scale, cx, cy) {
    const projected = projectedVisualGeometry(this.phase, this.params);
    const starR = Math.min(this.canvas.width, this.canvas.height) * 0.245;
    const planetR = clamp(numberOr(this.params.rpRs, 0.1), 0.01, 0.28) * starR;
    const moonR = clamp(numberOr(this.params.moonRadius, 0.025), 0.004, 0.08) * starR;

    return {
      planet: {
        type: "planet",
        position: [cx + projected.planet.x * scale, cy + projected.planet.y * scale, projected.planet.z],
        radius: planetR,
        front: projected.planet.front
      },
      moon: {
        type: "moon",
        enabled: Boolean(this.params.moonEnabled),
        position: [cx + projected.moon.x * scale, cy + projected.moon.y * scale, projected.moon.z],
        radius: moonR,
        front: projected.moon.front
      }
    };
  }

  getStarTexture(size) {
    const key = `${size}|${Math.round(numberOr(this.target.st_teff, 5772))}|${this.params.visualQuality}|${numberOr(this.params.u1,0.32).toFixed(2)}|${numberOr(this.params.u2,0.28).toFixed(2)}`;
    if (this.starTexture && this.starTextureKey === key) return this.starTexture;

    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;

    const ctx = c.getContext("2d");
    const colour = stellarColour(numberOr(this.target.st_teff, 5772));
    const image = ctx.createImageData(size, size);
    const quality = this.params.visualQuality === "ultra" ? 1.0 : this.params.visualQuality === "low" ? 0.54 : 0.78;
    const u1 = clamp(numberOr(this.params.u1, 0.32), 0, 1);
    const u2 = clamp(numberOr(this.params.u2, 0.28), 0, 1);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = (x / (size - 1)) * 2 - 1;
        const ny = (y / (size - 1)) * 2 - 1;
        const rr = Math.hypot(nx, ny);
        const i = (y * size + x) * 4;

        if (rr > 1) {
          image.data[i + 3] = 0;
          continue;
        }

        const mu = Math.sqrt(Math.max(0, 1 - rr * rr));
        const q = 1 - mu;
        const limb = clamp(1 - u1 * q - u2 * q * q, 0.12, 1.18);

        const cellA = valueNoise(x * 0.036, y * 0.036);
        const cellB = valueNoise(x * 0.092 + 31.2, y * 0.092 - 14.7);
        const cellC = valueNoise(x * 0.205 - 11.4, y * 0.205 + 8.9);
        const lane = smoothstep(0.42, 0.70, 1 - cellB);
        const gran = 0.88 + quality * (0.13 * cellA + 0.08 * cellC - 0.12 * lane);

        const sphereLight = 0.78 + 0.22 * clamp((-0.35 * nx - 0.45 * ny + 0.72 * mu), 0, 1);
        const edgeWarm = smoothstep(0.70, 0.98, rr);

        let red = colour[0] * gran * limb * sphereLight;
        let green = colour[1] * gran * limb * sphereLight;
        let blue = colour[2] * gran * limb * sphereLight;

        red = red * (1 + edgeWarm * 0.08);
        green = green * (1 - edgeWarm * 0.03);
        blue = blue * (1 - edgeWarm * 0.16);

        image.data[i] = clamp255(red);
        image.data[i + 1] = clamp255(green);
        image.data[i + 2] = clamp255(blue);
        image.data[i + 3] = 255;
      }
    }

    ctx.putImageData(image, 0, 0);
    this.starTexture = c;
    this.starTextureKey = key;
    return c;
  }

  textureKey() {
    return [
      this.params.visualQuality,
      this.params.u1,
      this.params.u2,
      this.params.spotEnabled,
      this.params.spotX,
      this.params.spotY,
      this.params.spotRadius,
      this.params.spotContrast
    ].join("|");
  }
}

function projectedVisualGeometry(phase01, params) {
  const p = params || {};
  const aRs = clamp(numberOr(p.aRs, 12), 2, 100);
  const inc = degToRad(clamp(numberOr(p.inclinationDeg, 88.5), 0, 90));
  const e = clamp(numberOr(p.eccentricity, 0), 0, 0.95);
  const omega = degToRad(normaliseDegrees(numberOr(p.omegaDeg, 90)));
  const phase = wrap01(phase01);

  let xPhysical;
  let yPhysical;
  let zPhysical;
  let rPhysical;

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

  /* Slow moon motion. Earlier value was 5x orbital phase and looked chaotic. */
  const moonPhase = degToRad(normaliseDegrees(numberOr(p.moonPhaseDeg, 45))) + phase * TWO_PI * 0.28;
  const moonDistance = clamp(numberOr(p.moonDistance, 0.55), 0.02, 3.0) * 0.22;
  const mx = x + moonDistance * Math.cos(moonPhase);
  const my = y + moonDistance * 0.58 * Math.sin(moonPhase);
  const mz = z + moonDistance * 0.42 * Math.sin(moonPhase);

  return {
    planet: { x, y, z, front: z >= 0 },
    moon: { x: mx, y: my, z: mz, front: mz >= 0 }
  };
}

function irregularClosedPath(radius, points, roughness, seed, time) {
  const out = [];
  for (let i = 0; i < points; i++) {
    const a = i / points * TWO_PI;
    const wobble =
      1 +
      roughness * 0.62 * Math.sin(a * 3.0 + seed + time) +
      roughness * 0.38 * Math.sin(a * 7.0 - seed * 0.7) +
      roughness * 0.20 * Math.sin(a * 11.0 + seed * 1.3);
    out.push([Math.cos(a) * radius * wobble, Math.sin(a) * radius * wobble]);
  }
  return out;
}

function solveKepler(M, e) {
  e = clamp(e, 0, 0.95);
  const m = wrapRadians(M);
  if (e < 1e-8) return m;
  let E = e < 0.8 ? m : Math.PI;
  for (let i = 0; i < 30; i++) {
    const f = E - e * Math.sin(E) - m;
    const fp = 1 - e * Math.cos(E);
    const dE = -f / Math.max(fp, 1e-12);
    E += dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

function trueAnomalyToEccentricAnomaly(f, e) {
  if (e < 1e-8) return wrapRadians(f);
  const factor = Math.sqrt((1 - e) / (1 + e));
  return wrapRadians(2 * Math.atan2(factor * Math.sin(f / 2), Math.cos(f / 2)));
}

function eccentricAnomalyToTrueAnomaly(E, e) {
  if (e < 1e-8) return wrapRadians(E);
  const factor = Math.sqrt((1 + e) / (1 - e));
  return wrapRadians(2 * Math.atan2(factor * Math.sin(E / 2), Math.cos(E / 2)));
}

function eccentricAnomalyToMeanAnomaly(E, e) {
  return wrapRadians(E - e * Math.sin(E));
}

function stellarColour(teff) {
  if (teff < 3600) return [255, 78, 30];
  if (teff < 5200) return [255, 126, 38];
  if (teff < 6500) return [255, 174, 70];
  if (teff < 8500) return [198, 224, 255];
  return [138, 178, 255];
}

function valueNoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = seededRandom(ix * 127.1 + iy * 311.7);
  const b = seededRandom((ix + 1) * 127.1 + iy * 311.7);
  const c = seededRandom(ix * 127.1 + (iy + 1) * 311.7);
  const d = seededRandom((ix + 1) * 127.1 + (iy + 1) * 311.7);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(edge0, edge1, x) { const t = clamp((x - edge0) / Math.max(1e-12, edge1 - edge0), 0, 1); return t * t * (3 - 2 * t); }
function seededRandom(seed) { const x = Math.sin(seed * 12.9898) * 43758.5453123; return x - Math.floor(x); }
function numberOr(value, fallback) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function clamp255(value) { return Math.max(0, Math.min(255, Math.round(value))); }
function degToRad(deg) { return deg * Math.PI / 180; }
function normaliseDegrees(deg) { let value = Number(deg); if (!Number.isFinite(value)) return 0; value %= 360; if (value < 0) value += 360; return value; }
function wrap01(value) { let result = value % 1; if (result < 0) result += 1; return result; }
function wrapRadians(angle) { let value = Number(angle); if (!Number.isFinite(value)) return 0; value %= TWO_PI; if (value < 0) value += TWO_PI; return value; }
