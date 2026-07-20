/* ============================================================================
   ExoLight Transit Lab - realistic lightweight stellar scene renderer
   ---------------------------------------------------------------------------
   Drop-in replacement for the previous decorative WebGL scene. It keeps the
   same ExoSceneRenderer public API used by src/app.js while rendering a cleaner
   scientific view: limb darkening, temperature-dependent colour, granulation,
   facula-like texture, optional starspots, and dark transit silhouettes.
   ============================================================================ */

const TWO_PI = Math.PI * 2;

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function numeric(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function hash(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453123;
  return x - Math.floor(x);
}

function rgb(values, alpha = 1) {
  return `rgba(${values[0]}, ${values[1]}, ${values[2]}, ${alpha})`;
}

function mixColour(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

function stellarColour(teff) {
  const t = clamp((numeric(teff, 5772) - 3200) / 6200, 0, 1);
  const cool = [255, 103, 35];
  const solar = [255, 181, 74];
  const hot = [226, 237, 255];
  if (t < 0.55) return mixColour(cool, solar, t / 0.55);
  return mixColour(solar, hot, (t - 0.55) / 0.45);
}

function darker(colour, factor) {
  return colour.map(v => Math.max(0, Math.round(v * factor)));
}

function lighter(colour, amount) {
  return colour.map(v => Math.min(255, Math.round(v + amount)));
}

function buildGranules(count) {
  return Array.from({ length: count }, (_, i) => {
    const r = Math.sqrt(hash(i + 1.41));
    const a = hash(i + 4.73) * TWO_PI;
    return {
      x: Math.cos(a) * r,
      y: Math.sin(a) * r,
      radius: 0.010 + hash(i + 8.32) * 0.030,
      phase: hash(i + 15.07) * TWO_PI,
      warm: hash(i + 21.8) > 0.50
    };
  });
}

export class ExoSceneRenderer {
  constructor({ container, onStatus = () => {}, onWarning = () => {} } = {}) {
    this.container = container;
    this.onStatus = onStatus;
    this.onWarning = onWarning;
    this.canvas = null;
    this.ctx = null;
    this.frameHandle = null;
    this.ready = false;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
    this.lastSizeKey = "";
    this.granules = buildGranules(220);
    this.orbitPhase = 0.42;
    this.lastFrame = 0;

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
    this.canvas.setAttribute("aria-label", "Realistic limb-darkened star and exoplanet transit scene");
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.display = "block";
    this.container.appendChild(this.canvas);

    this.ctx = this.canvas.getContext("2d", { alpha: false });
    if (!this.ctx) {
      this.onWarning("Canvas scene renderer unavailable.");
      return;
    }

    window.addEventListener("resize", () => this.resize(), { passive: true });
    this.resize();
    this.ready = true;
    this.onStatus("Realistic stellar photosphere renderer online");
    this.frameHandle = requestAnimationFrame(time => this.loop(time));
  }

  dispose() {
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
    this.ready = false;
  }

  updateState({ params = null, target = null } = {}) {
    if (params) {
      const previousQuality = this.params.visualQuality;
      this.params = { ...this.params, ...params };
      if (previousQuality !== this.params.visualQuality) this.rebuildForQuality();
    }
    if (target) this.target = { ...this.target, ...target };
  }

  rebuildForQuality() {
    const quality = String(this.params.visualQuality || "balanced").toLowerCase();
    const count = quality === "ultra" ? 360 : quality === "high" ? 300 : quality === "low" ? 140 : 220;
    this.granules = buildGranules(count);
  }

  resize() {
    if (!this.canvas || !this.container) return;
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(2, Math.floor(rect.width * this.pixelRatio));
    const height = Math.max(2, Math.floor(rect.height * this.pixelRatio));
    const sizeKey = `${width}x${height}`;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    if (sizeKey !== this.lastSizeKey) {
      this.lastSizeKey = sizeKey;
      this.rebuildForQuality();
    }
  }

  loop(time) {
    if (!this.ready) return;
    const dt = Math.min(0.05, Math.max(0, (time - this.lastFrame) / 1000 || 0));
    this.lastFrame = time;
    this.orbitPhase = (this.orbitPhase + dt * 0.020) % 1;
    this.render(time * 0.001);
    this.frameHandle = requestAnimationFrame(next => this.loop(next));
  }

  render(time) {
    if (!this.ctx || !this.canvas) return;
    this.resize();

    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const cx = width * 0.50;
    const cy = height * 0.52;
    const radius = Math.min(width, height) * 0.34;

    this.drawBackground(ctx, width, height, time);
    this.drawPhotosphere(ctx, cx, cy, radius, time);
    this.drawStarspot(ctx, cx, cy, radius);
    this.drawTransitBodies(ctx, cx, cy, radius, time);
    this.drawScientificOverlay(ctx, width, height, cx, cy, radius);
  }

  drawBackground(ctx, width, height, time) {
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, "#07111f");
    bg.addColorStop(1, "#020711");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const starCount = String(this.params.visualQuality).toLowerCase() === "low" ? 80 : 190;
    ctx.save();
    for (let i = 0; i < starCount; i += 1) {
      const x = hash(i + 100.1) * width;
      const y = hash(i + 200.2) * height;
      const alpha = (0.035 + hash(i + 300.3) * 0.12) * (0.82 + 0.18 * Math.sin(time * 0.2 + i));
      ctx.fillStyle = `rgba(185, 214, 255, ${alpha})`;
      ctx.fillRect(x, y, this.pixelRatio, this.pixelRatio);
    }
    ctx.restore();
  }

  drawPhotosphere(ctx, cx, cy, radius, time) {
    const base = stellarColour(this.target.st_teff);
    const u1 = clamp(this.params.u1, 0, 1);
    const u2 = clamp(this.params.u2, 0, 1);

    const limb = ctx.createRadialGradient(cx - radius * 0.16, cy - radius * 0.20, radius * 0.05, cx, cy, radius);
    limb.addColorStop(0.00, rgb(lighter(base, 72), 1));
    limb.addColorStop(0.34, rgb(lighter(base, 18), 1));
    limb.addColorStop(0.62, rgb(base, 1));
    limb.addColorStop(0.85, rgb(darker(base, 0.58 + 0.16 * (1 - u1)), 1));
    limb.addColorStop(0.96, rgb(darker(base, 0.30 + 0.10 * (1 - u2)), 1));
    limb.addColorStop(1.00, rgb(darker(base, 0.14), 1));

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TWO_PI);
    ctx.clip();

    ctx.fillStyle = limb;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

    // Coarse supergranulation: large soft convection cells so the disk
    // reads as an organic, non-uniform surface even at a glance.
    ctx.globalCompositeOperation = "soft-light";
    for (let i = 0; i < 26; i += 1) {
      const angle = hash(i + 5.2) * TWO_PI;
      const r = Math.sqrt(hash(i + 9.6)) * radius * 0.92;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      const mu = Math.sqrt(Math.max(0, 1 - (r / radius) ** 2));
      const size = radius * (0.16 + hash(i + 61.3) * 0.16);
      const warm = hash(i + 44.9) > 0.45;
      const alpha = (warm ? 0.22 : 0.16) * (0.55 + 0.45 * mu);
      const sg = ctx.createRadialGradient(x, y, 0, x, y, size);
      sg.addColorStop(0, warm ? `rgba(255, 214, 140, ${alpha})` : `rgba(120, 46, 16, ${alpha})`);
      sg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = sg;
      ctx.fillRect(x - size, y - size, size * 2, size * 2);
    }

    // Fine granulation: many small bright/dark cells, high enough contrast
    // to be visible without a build-quality-dependent flicker.
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < this.granules.length; i += 1) {
      const g = this.granules[i];
      const spin = time * 0.018;
      const x0 = g.x * Math.cos(spin) - g.y * Math.sin(spin);
      const y0 = g.x * Math.sin(spin) + g.y * Math.cos(spin);
      const rr = x0 * x0 + y0 * y0;
      if (rr > 1) continue;
      const mu = Math.sqrt(Math.max(0, 1 - rr));
      const flicker = 0.78 + 0.22 * Math.sin(time * 0.55 + g.phase);
      const alpha = (g.warm ? 0.20 : 0.03) * mu * flicker;
      const x = cx + x0 * radius;
      const y = cy + y0 * radius;
      const gr = ctx.createRadialGradient(x, y, 0, x, y, g.radius * radius * 5.4);
      gr.addColorStop(0, g.warm ? `rgba(255, 240, 190, ${alpha})` : `rgba(150, 56, 18, ${alpha})`);
      gr.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gr;
      ctx.fillRect(x - g.radius * radius * 6, y - g.radius * radius * 6, g.radius * radius * 12, g.radius * radius * 12);
    }

    // Dark intergranular lanes: the thin dark network between granules is
    // what actually sells "photosphere" over "smooth ball" at a glance.
    ctx.globalCompositeOperation = "multiply";
    for (let i = 0; i < 90; i += 1) {
      const angle = hash(i + 77.4) * TWO_PI + time * 0.004;
      const r = Math.sqrt(hash(i + 33.7)) * radius * 0.96;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      const size = radius * (0.012 + hash(i + 91.2) * 0.032);
      ctx.fillStyle = `rgba(70, 26, 10, ${0.05 + hash(i + 11.1) * 0.09})`;
      ctx.beginPath();
      ctx.ellipse(x, y, size * 1.35, size, angle, 0, TWO_PI);
      ctx.fill();
    }

    ctx.restore();

    // A thin, slightly brighter limb rim just inside the edge (real photosphere
    // limb photos show a subtle rim brightening before the sharp cutoff) plus
    // the outer corona bloom.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TWO_PI);
    ctx.clip();
    const rim = ctx.createRadialGradient(cx, cy, radius * 0.90, cx, cy, radius * 1.0);
    rim.addColorStop(0, "rgba(255, 214, 150, 0)");
    rim.addColorStop(0.7, "rgba(255, 214, 150, 0.05)");
    rim.addColorStop(1, "rgba(255, 214, 150, 0.12)");
    ctx.fillStyle = rim;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.restore();

    const glow = ctx.createRadialGradient(cx, cy, radius * 0.86, cx, cy, radius * 1.30);
    glow.addColorStop(0.00, "rgba(255, 190, 90, 0.00)");
    glow.addColorStop(0.45, "rgba(255, 185, 88, 0.085)");
    glow.addColorStop(0.72, "rgba(255, 178, 82, 0.035)");
    glow.addColorStop(1.00, "rgba(255, 178, 82, 0.00)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.32, 0, TWO_PI);
    ctx.fill();
  }

  drawStarspot(ctx, cx, cy, radius) {
    if (!this.params.spotEnabled) return;
    const x = cx + clamp(this.params.spotX, -0.9, 0.9) * radius;
    const y = cy - clamp(this.params.spotY, -0.9, 0.9) * radius;
    const r = clamp(this.params.spotRadius, 0.02, 0.35) * radius;
    const contrast = clamp(this.params.spotContrast, 0.05, 0.95);
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r * 1.45);
    grad.addColorStop(0, `rgba(14, 7, 5, ${0.58 + contrast * 0.26})`);
    grad.addColorStop(0.42, `rgba(54, 22, 10, ${0.38 + contrast * 0.22})`);
    grad.addColorStop(1, "rgba(54,22,10,0)");
    ctx.save();
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.22, r * 0.86, 0.24, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }

  projectedBody(starRadius) {
    const inc = clamp(this.params.inclinationDeg, 75, 90) * Math.PI / 180;
    const impact = clamp(Math.cos(inc) * numeric(this.params.aRs, 12), -1.25, 1.25);
    const phase = this.orbitPhase;
    const x = (phase - 0.5) * 3.35;
    return { x: x * starRadius, y: impact * starRadius, phase };
  }

  drawTransitBodies(ctx, cx, cy, starRadius, time) {
    const p = this.projectedBody(starRadius);
    const pr = clamp(this.params.rpRs, 0.01, 0.28) * starRadius;
    const x = cx + p.x;
    const y = cy + p.y;

    ctx.save();
    ctx.fillStyle = "rgba(0, 4, 9, 0.985)";
    ctx.beginPath();
    ctx.arc(x, y, pr, 0, TWO_PI);
    ctx.fill();

    const rim = ctx.createRadialGradient(x - pr * 0.22, y - pr * 0.22, pr * 0.05, x, y, pr);
    rim.addColorStop(0.00, "rgba(55, 150, 170, 0.040)");
    rim.addColorStop(0.80, "rgba(0, 0, 0, 0.020)");
    rim.addColorStop(1.00, "rgba(91, 207, 231, 0.20)");
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(x, y, pr, 0, TWO_PI);
    ctx.fill();

    if (this.params.moonEnabled) {
      const angle = numeric(this.params.moonPhaseDeg, 45) * Math.PI / 180 + time * 0.12;
      const distance = numeric(this.params.moonDistance, 0.55) * starRadius * 0.32;
      const mr = clamp(this.params.moonRadius, 0.004, 0.08) * starRadius;
      ctx.fillStyle = "rgba(2, 6, 12, 0.94)";
      ctx.beginPath();
      ctx.arc(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance, mr, 0, TWO_PI);
      ctx.fill();
    }

    ctx.restore();
  }

  drawScientificOverlay(ctx, width, height, cx, cy, radius) {
    ctx.save();
    ctx.font = `${Math.max(10, Math.round(width * 0.0085))}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    ctx.fillStyle = "rgba(225, 238, 255, 0.78)";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("limb-darkened stellar photosphere", 18 * this.pixelRatio, 16 * this.pixelRatio);
    ctx.fillStyle = "rgba(160, 180, 205, 0.68)";
    ctx.fillText("granulation texture · transit silhouette · no decorative magnetic loops", 18 * this.pixelRatio, 34 * this.pixelRatio);

    ctx.strokeStyle = "rgba(105, 186, 255, 0.22)";
    ctx.setLineDash([8 * this.pixelRatio, 7 * this.pixelRatio]);
    ctx.lineWidth = Math.max(1, this.pixelRatio);
    ctx.beginPath();
    ctx.moveTo(cx - radius * 1.45, cy);
    ctx.lineTo(cx + radius * 1.45, cy);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(160, 180, 205, 0.68)";
    ctx.fillText(`Teff ${Math.round(numeric(this.target.st_teff, 5772)).toLocaleString("en-GB")} K`, width - 18 * this.pixelRatio, 16 * this.pixelRatio);
    ctx.fillText(`Rp/R★ ${numeric(this.params.rpRs, 0.1).toFixed(3)}`, width - 18 * this.pixelRatio, 34 * this.pixelRatio);
    ctx.restore();
  }
}
