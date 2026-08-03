/* ============================================================================
   ExoIntel-Prime — Scientific Transit Viewport
   Author: Biswajit Jana

   A restrained, dependency-free Canvas renderer for the public dashboard.
   The scene prioritises scientific readability over cinematic effects:
   - temperature-based stellar colour
   - quadratic limb darkening
   - subtle fine-scale granulation
   - minimal chromospheric glow
   - foreground/background orbital ordering
   - clean occulting planet silhouette during transit
   ============================================================================ */

const TWO_PI = Math.PI * 2;
const DEG = Math.PI / 180;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function wrap01(value) {
  return ((value % 1) + 1) % 1;
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function hashString(text) {
  let hash = 2166136261;
  for (const char of String(text || "ExoIntel-Prime")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function kelvinToRgb(kelvin) {
  const temperature = clamp(finite(kelvin, 5772), 2400, 12000) / 100;
  let red;
  let green;
  let blue;

  if (temperature <= 66) {
    red = 255;
    green = 99.4708025861 * Math.log(temperature) - 161.1195681661;
    blue = temperature <= 19 ? 0 : 138.5177312231 * Math.log(temperature - 10) - 305.0447927307;
  } else {
    red = 329.698727446 * Math.pow(temperature - 60, -0.1332047592);
    green = 288.1221695283 * Math.pow(temperature - 60, -0.0755148492);
    blue = 255;
  }

  return {
    r: clamp(red, 0, 255),
    g: clamp(green, 0, 255),
    b: clamp(blue, 0, 255)
  };
}

function colourCss(colour, alpha = 1) {
  return `rgba(${Math.round(colour.r)}, ${Math.round(colour.g)}, ${Math.round(colour.b)}, ${alpha})`;
}

function spectralType(teff) {
  const t = finite(teff, 5772);
  if (t >= 10000) return "B/A-type photosphere";
  if (t >= 7500) return "A-type photosphere";
  if (t >= 6000) return "F-type photosphere";
  if (t >= 5200) return "G-type photosphere";
  if (t >= 3900) return "K-type photosphere";
  return "M-type photosphere";
}

function buildGranulationMap(width = 1024, height = 512, seed = 1) {
  const values = new Float32Array(width * height);
  const random = seededRandom(seed);
  const phaseA = random() * TWO_PI;
  const phaseB = random() * TWO_PI;
  const phaseC = random() * TWO_PI;

  for (let y = 0; y < height; y += 1) {
    const latitude = (y / height - 0.5) * Math.PI;
    const latWave = Math.sin(latitude * 17.0 + phaseA) * 0.16;

    for (let x = 0; x < width; x += 1) {
      const longitude = (x / width) * TWO_PI;
      const cellular =
        Math.sin(longitude * 83.0 + Math.sin(latitude * 29.0 + phaseB) * 2.3) * 0.34 +
        Math.sin(longitude * 131.0 - latitude * 67.0 + phaseC) * 0.22 +
        Math.sin(longitude * 211.0 + latitude * 103.0 + phaseA) * 0.12 +
        latWave;
      const grain = (random() - 0.5) * 0.22;
      values[y * width + x] = clamp(0.5 + cellular * 0.22 + grain, 0, 1);
    }
  }

  return { values, width, height };
}

function sampleGranulation(map, u, v) {
  const x = ((Math.floor(u * map.width) % map.width) + map.width) % map.width;
  const y = clamp(Math.floor(v * map.height), 0, map.height - 1);
  return map.values[y * map.width + x];
}

export class ExoSceneRenderer {
  constructor({ container, onStatus = () => {}, onWarning = () => {} } = {}) {
    this.container = container;
    this.onStatus = onStatus;
    this.onWarning = onWarning;
    this.canvas = null;
    this.ctx = null;
    this.ready = false;
    this.frameHandle = null;
    this.lastFrame = 0;
    this.lastPhotosphereBuild = 0;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.resizeObserver = null;
    this.reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || false;

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
      phaseShift: 0,
      visualQuality: "balanced"
    };

    this.target = {
      pl_name: "Synthetic Hot Jupiter",
      hostname: "Demonstration Host",
      st_teff: 5772
    };

    this.model = null;
    this.orbitPhase = 0.58;
    this.rotation = 0;
    this.photosphereCanvas = document.createElement("canvas");
    this.photosphereContext = this.photosphereCanvas.getContext("2d", { alpha: true });
    this.granulation = buildGranulationMap(1024, 512, 1999);
    this.starfield = [];
    this.starfieldSeed = null;
    this.photosphereSignature = "";
  }

  mount() {
    if (!this.container) {
      this.onWarning("Scientific viewport could not mount because no container was supplied.");
      return;
    }

    this.container.innerHTML = "";
    this.container.style.position = "relative";
    this.container.style.overflow = "hidden";

    this.canvas = document.createElement("canvas");
    this.canvas.className = "scientific-scene-canvas";
    this.canvas.setAttribute("aria-label", "Scientific stellar photosphere and exoplanet transit animation");
    this.container.appendChild(this.canvas);

    this.ctx = this.canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!this.ctx) {
      this.onWarning("Canvas rendering is unavailable in this browser.");
      return;
    }

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.ready = true;
    this.onStatus("Scientific photosphere · limb darkening + fine granulation");
    this.frameHandle = requestAnimationFrame(time => this.loop(time));
  }

  dispose() {
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.resizeObserver?.disconnect();
    this.frameHandle = null;
    this.ready = false;
  }

  updateState({ params = null, target = null, model = null } = {}) {
    if (params) this.params = { ...this.params, ...params };
    if (target) {
      const nextName = target.pl_name || target.hostname || "target";
      if (nextName !== this.target.pl_name) {
        const seed = hashString(nextName);
        this.granulation = buildGranulationMap(1024, 512, seed);
        this.starfieldSeed = null;
      }
      this.target = { ...this.target, ...target };
    }
    if (model) this.model = model;
    this.photosphereSignature = "";
  }

  qualitySettings() {
    const quality = String(this.params.visualQuality || "balanced").toLowerCase();
    if (quality === "ultra") return { texture: 440, fps: 45, stars: 620, granulation: 0.055 };
    if (quality === "high") return { texture: 380, fps: 40, stars: 480, granulation: 0.050 };
    if (quality === "low") return { texture: 240, fps: 24, stars: 180, granulation: 0.032 };
    return { texture: 320, fps: 32, stars: 320, granulation: 0.042 };
  }

  resize() {
    if (!this.canvas || !this.ctx) return;
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(2, Math.round(rect.width * this.pixelRatio));
    const height = Math.max(2, Math.round(rect.height * this.pixelRatio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.canvas.style.width = `${rect.width}px`;
      this.canvas.style.height = `${rect.height}px`;
      this.ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
      this.photosphereSignature = "";
      this.starfieldSeed = null;
    }
  }

  loop(time) {
    if (!this.ready) return;
    const settings = this.qualitySettings();
    const interval = 1000 / settings.fps;
    const elapsed = time - this.lastFrame;

    if (elapsed >= interval) {
      const dt = Math.min(0.08, Math.max(0, elapsed / 1000));
      this.lastFrame = time;
      if (!this.reducedMotion) {
        this.orbitPhase = wrap01(this.orbitPhase + dt * 0.042);
        this.rotation = wrap01(this.rotation + dt * 0.0065);
      }
      this.render(time * 0.001, settings);
    }

    this.frameHandle = requestAnimationFrame(next => this.loop(next));
  }

  ensureStarfield(width, height, count) {
    const seed = `${Math.round(width)}:${Math.round(height)}:${count}:${this.target.pl_name}`;
    if (seed === this.starfieldSeed) return;
    this.starfieldSeed = seed;
    const random = seededRandom(hashString(seed));
    this.starfield = Array.from({ length: count }, () => ({
      x: random() * width,
      y: random() * height,
      radius: mix(0.25, 1.05, Math.pow(random(), 2.2)),
      alpha: mix(0.12, 0.70, Math.pow(random(), 2.1)),
      phase: random() * TWO_PI
    }));
  }

  render(time, settings) {
    if (!this.ctx || !this.canvas) return;
    const width = this.canvas.width / this.pixelRatio;
    const height = this.canvas.height / this.pixelRatio;
    const ctx = this.ctx;

    ctx.save();
    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const background = ctx.createLinearGradient(0, 0, 0, height);
    background.addColorStop(0, "#010308");
    background.addColorStop(1, "#030811");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    this.ensureStarfield(width, height, settings.stars);
    this.drawStarfield(ctx, time);

    const radius = Math.min(height * 0.39, width * 0.205);
    const centreX = width * 0.53;
    const centreY = height * 0.52;
    const geometry = this.computeGeometry(centreX, centreY, radius);

    if (!geometry.planet.front) this.drawPlanet(ctx, geometry.planet, false);
    if (geometry.moon.enabled && !geometry.moon.front) this.drawPlanet(ctx, geometry.moon, false, true);

    this.drawStar(ctx, centreX, centreY, radius, time, settings);

    if (geometry.planet.front) this.drawPlanet(ctx, geometry.planet, geometry.planet.transiting);
    if (geometry.moon.enabled && geometry.moon.front) this.drawPlanet(ctx, geometry.moon, geometry.moon.transiting, true);

    this.drawLabels(ctx, width, height);
    ctx.restore();
  }

  drawStarfield(ctx, time) {
    ctx.save();
    for (const point of this.starfield) {
      const twinkle = 0.80 + 0.20 * Math.sin(time * 0.45 + point.phase);
      ctx.globalAlpha = point.alpha * twinkle;
      ctx.fillStyle = "#d9e8ff";
      ctx.beginPath();
      ctx.arc(point.x, point.y, point.radius, 0, TWO_PI);
      ctx.fill();
    }
    ctx.restore();
  }

  buildPhotosphere(radius, settings, time) {
    const size = settings.texture;
    const teff = finite(this.target.st_teff, 5772);
    const u1 = clamp(finite(this.params.u1, 0.32), 0, 1);
    const u2 = clamp(finite(this.params.u2, 0.28), 0, 1);
    const rotationBucket = Math.floor(this.rotation * 720) / 720;
    const signature = `${size}:${Math.round(teff)}:${u1.toFixed(3)}:${u2.toFixed(3)}:${rotationBucket}`;
    if (signature === this.photosphereSignature && time - this.lastPhotosphereBuild < 0.20) return;

    this.photosphereSignature = signature;
    this.lastPhotosphereBuild = time;
    this.photosphereCanvas.width = size;
    this.photosphereCanvas.height = size;
    const image = this.photosphereContext.createImageData(size, size);
    const data = image.data;
    const base = kelvinToRgb(teff);
    const cool = {
      r: base.r * 0.78,
      g: base.g * 0.76,
      b: base.b * 0.72
    };
    const warm = {
      r: mix(base.r, 255, 0.30),
      g: mix(base.g, 248, 0.22),
      b: mix(base.b, 226, 0.14)
    };

    for (let py = 0; py < size; py += 1) {
      const ny = (py + 0.5 - size / 2) / (size / 2);
      for (let px = 0; px < size; px += 1) {
        const nx = (px + 0.5 - size / 2) / (size / 2);
        const r2 = nx * nx + ny * ny;
        const index = (py * size + px) * 4;

        if (r2 > 1) {
          data[index + 3] = 0;
          continue;
        }

        const mu = Math.sqrt(Math.max(0, 1 - r2));
        const oneMinusMu = 1 - mu;
        const limb = clamp(1 - u1 * oneMinusMu - u2 * oneMinusMu * oneMinusMu, 0.05, 1);
        const longitude = Math.atan2(nx, Math.max(0.0001, mu)) / TWO_PI + 0.5 + this.rotation;
        const latitude = Math.asin(clamp(ny, -1, 1)) / Math.PI + 0.5;
        const granule = sampleGranulation(this.granulation, longitude, latitude);
        const signedGranule = (granule - 0.5) * 2;
        const centreWarmth = Math.pow(mu, 0.65);
        const texture = 1 + signedGranule * settings.granulation * (0.72 + 0.28 * mu);
        const intensity = clamp(limb * texture * (0.91 + 0.09 * centreWarmth), 0, 1.12);
        const colourMix = clamp(0.18 + centreWarmth * 0.55 + signedGranule * 0.035, 0, 1);

        data[index] = clamp(mix(cool.r, warm.r, colourMix) * intensity, 0, 255);
        data[index + 1] = clamp(mix(cool.g, warm.g, colourMix) * intensity, 0, 255);
        data[index + 2] = clamp(mix(cool.b, warm.b, colourMix) * intensity, 0, 255);
        data[index + 3] = 255;
      }
    }

    this.photosphereContext.putImageData(image, 0, 0);
  }

  drawStar(ctx, x, y, radius, time, settings) {
    this.buildPhotosphere(radius, settings, time);
    const teff = finite(this.target.st_teff, 5772);
    const base = kelvinToRgb(teff);

    const outerGlow = ctx.createRadialGradient(x, y, radius * 0.84, x, y, radius * 1.18);
    outerGlow.addColorStop(0, colourCss(base, 0.08));
    outerGlow.addColorStop(0.74, colourCss(base, 0.035));
    outerGlow.addColorStop(1, colourCss(base, 0));
    ctx.fillStyle = outerGlow;
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.18, 0, TWO_PI);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TWO_PI);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(this.photosphereCanvas, x - radius, y - radius, radius * 2, radius * 2);

    if (this.params.spotEnabled) this.drawStarspot(ctx, x, y, radius);
    ctx.restore();

    const rim = ctx.createRadialGradient(x, y, radius * 0.91, x, y, radius * 1.015);
    rim.addColorStop(0, "rgba(255,255,255,0)");
    rim.addColorStop(0.90, colourCss(base, 0.025));
    rim.addColorStop(1, colourCss(base, 0));
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.015, 0, TWO_PI);
    ctx.fill();
  }

  drawStarspot(ctx, x, y, radius) {
    const sx = x + clamp(finite(this.params.spotX, 0.2), -0.9, 0.9) * radius;
    const sy = y - clamp(finite(this.params.spotY, 0.1), -0.9, 0.9) * radius;
    const spotRadius = clamp(finite(this.params.spotRadius, 0.12), 0.02, 0.3) * radius;
    const contrast = clamp(finite(this.params.spotContrast, 0.55), 0.05, 0.95);
    const spot = ctx.createRadialGradient(sx - spotRadius * 0.10, sy - spotRadius * 0.08, spotRadius * 0.08, sx, sy, spotRadius);
    spot.addColorStop(0, `rgba(20, 14, 12, ${0.70 * contrast})`);
    spot.addColorStop(0.52, `rgba(48, 31, 23, ${0.56 * contrast})`);
    spot.addColorStop(0.82, `rgba(82, 54, 38, ${0.24 * contrast})`);
    spot.addColorStop(1, "rgba(88, 61, 43, 0)");
    ctx.fillStyle = spot;
    ctx.beginPath();
    ctx.ellipse(sx, sy, spotRadius * 1.10, spotRadius * 0.82, -0.18, 0, TWO_PI);
    ctx.fill();
  }

  computeGeometry(cx, cy, radius) {
    const angle = this.orbitPhase * TWO_PI;
    const inclination = clamp(finite(this.params.inclinationDeg, 88.5), 75, 90) * DEG;
    const aRs = clamp(finite(this.params.aRs, 12), 2, 60);
    const impact = clamp(aRs * Math.cos(inclination), -0.88, 0.88);
    const orbitX = radius * 1.54;
    const orbitY = radius * 0.18;
    const depth = Math.sin(angle);
    const planetRadius = clamp(finite(this.params.rpRs, 0.1) * radius, radius * 0.018, radius * 0.26);
    const planet = {
      x: cx + Math.cos(angle) * orbitX,
      y: cy + impact * radius * 0.72 + Math.sin(angle) * orbitY,
      radius: planetRadius,
      front: depth > 0,
      transiting: depth > 0 && Math.abs(Math.cos(angle)) < 0.74
    };

    const moonAngle = angle * 2.2 + finite(this.params.moonPhaseDeg, 45) * DEG;
    const moonDistance = clamp(finite(this.params.moonDistance, 0.55), 0.05, 2.5) * radius * 0.42;
    const moonRadius = clamp(finite(this.params.moonRadius, 0.025) * radius, radius * 0.008, radius * 0.09);
    const moon = {
      enabled: Boolean(this.params.moonEnabled),
      x: planet.x + Math.cos(moonAngle) * moonDistance,
      y: planet.y + Math.sin(moonAngle) * moonDistance * 0.40,
      radius: moonRadius,
      front: depth + Math.sin(moonAngle) * 0.08 > 0,
      transiting: depth > 0 && Math.abs(Math.cos(angle)) < 0.74
    };

    return { planet, moon };
  }

  drawPlanet(ctx, body, silhouette, isMoon = false) {
    ctx.save();
    if (silhouette) {
      const edge = ctx.createRadialGradient(
        body.x - body.radius * 0.18,
        body.y - body.radius * 0.18,
        body.radius * 0.08,
        body.x,
        body.y,
        body.radius
      );
      edge.addColorStop(0, "#000205");
      edge.addColorStop(0.82, "#01050a");
      edge.addColorStop(1, isMoon ? "#071018" : "#06111a");
      ctx.fillStyle = edge;
    } else {
      const bodyGradient = ctx.createRadialGradient(
        body.x - body.radius * 0.34,
        body.y - body.radius * 0.34,
        body.radius * 0.10,
        body.x,
        body.y,
        body.radius
      );
      bodyGradient.addColorStop(0, isMoon ? "#637381" : "#3a8295");
      bodyGradient.addColorStop(0.56, isMoon ? "#263542" : "#174052");
      bodyGradient.addColorStop(1, "#02070c");
      ctx.fillStyle = bodyGradient;
    }

    ctx.beginPath();
    ctx.arc(body.x, body.y, body.radius, 0, TWO_PI);
    ctx.fill();

    if (silhouette) {
      ctx.strokeStyle = isMoon ? "rgba(120,170,190,.22)" : "rgba(100,180,210,.24)";
      ctx.lineWidth = Math.max(0.6, body.radius * 0.035);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawLabels(ctx, width, height) {
    const teff = finite(this.target.st_teff, 5772);
    ctx.save();
    ctx.fillStyle = "rgba(239,246,255,.90)";
    ctx.font = "600 12px Inter, system-ui, sans-serif";
    ctx.fillText(String(this.target.pl_name || "Selected target"), 16, height - 28);
    ctx.fillStyle = "rgba(166,183,205,.72)";
    ctx.font = "500 10px Inter, system-ui, sans-serif";
    ctx.fillText(`${spectralType(teff)} · ${Math.round(teff).toLocaleString("en-GB")} K`, 16, height - 13);
    ctx.restore();
  }
}
