/**
 * ============================================================================
 * ExoIntel-Prime
 * src/scene.js
 * ----------------------------------------------------------------------------
 * Research-grade cinematic star / planet / exomoon scene renderer
 * Pure Canvas 2D renderer with pseudo-3D physically motivated shading.
 *
 * Goals of this rewrite:
 * - Animated star photosphere with evolving granulation
 * - Stronger 3D appearance through limb darkening + directional lighting
 * - Stellar colour tied to effective temperature
 * - No ugly orbit rings / circular diagram overlays
 * - Planet and moon rendered as shaded spheres, not flat discs
 * - Exomoon motion faster and more natural
 * - Irregular starspot morphology rather than cartoon circles
 * - Compatible with the existing app / worker recovery architecture
 * ============================================================================
 */

const TWO_PI = Math.PI * 2;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function fract(x) {
  return x - Math.floor(x);
}

function degToRad(deg) {
  return deg * Math.PI / 180;
}

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return fract(s);
}

function valueNoise2D(x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;

  const sx = x - x0;
  const sy = y - y0;

  const n00 = hash2(x0, y0);
  const n10 = hash2(x1, y0);
  const n01 = hash2(x0, y1);
  const n11 = hash2(x1, y1);

  const ix0 = lerp(n00, n10, sx);
  const ix1 = lerp(n01, n11, sx);

  return lerp(ix0, ix1, sy);
}

function fbm(x, y, octaves = 4) {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1.0;
  let totalAmp = 0;

  for (let i = 0; i < octaves; i += 1) {
    value += amplitude * valueNoise2D(x * frequency, y * frequency);
    totalAmp += amplitude;
    amplitude *= 0.5;
    frequency *= 2.0;
  }

  return totalAmp > 0 ? value / totalAmp : 0;
}

function kelvinToRgb(kelvin) {
  const temp = clamp(kelvin, 2000, 12000) / 100;
  let red;
  let green;
  let blue;

  if (temp <= 66) {
    red = 255;
    green = 99.4708025861 * Math.log(temp) - 161.1195681661;
    if (temp <= 19) {
      blue = 0;
    } else {
      blue = 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
    }
  } else {
    red = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
    green = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
    blue = 255;
  }

  return {
    r: Math.round(clamp(red, 0, 255)),
    g: Math.round(clamp(green, 0, 255)),
    b: Math.round(clamp(blue, 0, 255))
  };
}

function rgbToCss({ r, g, b }, a = 1) {
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function mixColor(a, b, t) {
  return {
    r: Math.round(lerp(a.r, b.r, t)),
    g: Math.round(lerp(a.g, b.g, t)),
    b: Math.round(lerp(a.b, b.b, t))
  };
}

function darken(color, factor) {
  return {
    r: Math.round(color.r * factor),
    g: Math.round(color.g * factor),
    b: Math.round(color.b * factor)
  };
}

function brighten(color, factor) {
  return {
    r: Math.round(clamp(color.r * factor, 0, 255)),
    g: Math.round(clamp(color.g * factor, 0, 255)),
    b: Math.round(clamp(color.b * factor, 0, 255))
  };
}

function readableTheme(theme) {
  return theme === "light" ? "light" : "dark";
}

function normalisePhase(phase) {
  let p = Number.isFinite(phase) ? phase : 0;
  while (p < -0.5) p += 1;
  while (p > 0.5) p -= 1;
  return p;
}

function fallbackValue(value, alt) {
  return Number.isFinite(value) ? value : alt;
}

export class ExoSceneRenderer {
  constructor(containerOrCanvas, options = {}) {
    this.options = { ...options };
    this.theme = readableTheme(options.theme || "dark");
    this.quality = (options.quality || "balanced").toLowerCase();

    this.root = null;
    this.canvas = null;
    this.ctx = null;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.width = 0;
    this.height = 0;

    this.frame = 0;
    this.lastTime = performance.now();
    this.animationHandle = null;

    this.target = null;
    this.controls = this.getDefaultControls();
    this.workerState = {};
    this.sceneState = {};
    this.cachedModel = null;

    this.starTexture = null;
    this.starTextureSize = 0;
    this.starTextureDirty = true;
    this.starTextureClock = 0;

    this.starSpotTexture = null;
    this.starSpotDirty = true;

    this.backgroundStars = [];
    this.needsResize = true;

    this.mount(containerOrCanvas);

    this.handleResize = this.handleResize.bind(this);
    window.addEventListener("resize", this.handleResize, { passive: true });

    this.start();
  }

  getDefaultControls() {
    return {
      radiusRatio: 0.1,
      scaledDistance: 8.0,
      inclination: 89.0,
      eccentricity: 0.0,
      period: 3.0,

      limbU1: 0.32,
      limbU2: 0.28,

      enableStarspot: false,
      spotX: 0.2,
      spotY: 0.1,
      spotRadius: 0.12,
      spotContrast: 0.55,

      enableExomoon: false,
      moonRadius: 0.03,
      moonDistance: 1.6,
      moonPhase: 45,

      phaseShift: 0.0
    };
  }

  mount(containerOrCanvas) {
    if (containerOrCanvas instanceof HTMLCanvasElement) {
      this.canvas = containerOrCanvas;
      this.root = containerOrCanvas.parentElement || containerOrCanvas;
    } else if (containerOrCanvas instanceof HTMLElement) {
      this.root = containerOrCanvas;
      this.canvas = document.createElement("canvas");
      this.canvas.className = "exo-scene-canvas";
      this.canvas.setAttribute("aria-label", "Exoplanet transit theoretical scene");
      this.canvas.style.width = "100%";
      this.canvas.style.height = "100%";
      this.canvas.style.display = "block";
      this.root.innerHTML = "";
      this.root.appendChild(this.canvas);
    } else {
      throw new Error("ExoSceneRenderer requires a canvas or an HTML element.");
    }

    this.ctx = this.canvas.getContext("2d", { alpha: true, desynchronized: true });
    if (!this.ctx) {
      throw new Error("2D canvas context could not be created.");
    }

    this.regenerateBackgroundStars();
    this.resize();
  }

  handleResize() {
    this.needsResize = true;
  }

  resize() {
    if (!this.canvas) return;

    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(100, Math.round(rect.width || this.canvas.clientWidth || 900));
    const height = Math.max(100, Math.round(rect.height || this.canvas.clientHeight || 540));

    this.width = width;
    this.height = height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);

    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.starTextureDirty = true;
    this.starSpotDirty = true;
    this.needsResize = false;
  }

  regenerateBackgroundStars() {
    const stars = [];
    const count = 180;

    for (let i = 0; i < count; i += 1) {
      stars.push({
        x: Math.random(),
        y: Math.random(),
        r: lerp(0.35, 1.4, Math.random()),
        a: lerp(0.1, 0.75, Math.random()),
        twinkle: lerp(0.5, 2.8, Math.random())
      });
    }

    this.backgroundStars = stars;
  }

  setTheme(theme) {
    this.theme = readableTheme(theme);
  }

  setVisualQuality(quality) {
    const next = (quality || "balanced").toLowerCase();
    if (next !== this.quality) {
      this.quality = next;
      this.starTextureDirty = true;
      this.starSpotDirty = true;
    }
  }

  setTarget(target) {
    this.target = target || null;
    this.starTextureDirty = true;
    this.starSpotDirty = true;
  }

  setControls(controls = {}) {
    this.controls = {
      ...this.controls,
      ...this.translateControlAliases(controls)
    };

    this.starTextureDirty = true;
    this.starSpotDirty = true;
  }

  setWorkerState(workerState = {}) {
    this.workerState = { ...this.workerState, ...workerState };
  }

  update(payload = {}) {
    if (payload.theme) this.setTheme(payload.theme);
    if (payload.quality) this.setVisualQuality(payload.quality);
    if (payload.target) this.setTarget(payload.target);
    if (payload.controls) this.setControls(payload.controls);
    if (payload.workerState) this.setWorkerState(payload.workerState);

    if (payload.phase !== undefined) {
      this.workerState.phase = payload.phase;
    }

    if (payload.sceneState) {
      this.sceneState = { ...this.sceneState, ...payload.sceneState };
    }

    if (payload.cachedModel) {
      this.cachedModel = payload.cachedModel;
    }
  }

  applyState(payload = {}) {
    this.update(payload);
  }

  setState(payload = {}) {
    this.update(payload);
  }

  updateFromAppState(payload = {}) {
    this.update(payload);
  }

  translateControlAliases(input) {
    const out = { ...input };

    if (out.rpRs !== undefined && out.radiusRatio === undefined) {
      out.radiusRatio = out.rpRs;
    }
    if (out.aRs !== undefined && out.scaledDistance === undefined) {
      out.scaledDistance = out.aRs;
    }
    if (out.u1 !== undefined && out.limbU1 === undefined) {
      out.limbU1 = out.u1;
    }
    if (out.u2 !== undefined && out.limbU2 === undefined) {
      out.limbU2 = out.u2;
    }

    return out;
  }

  start() {
    if (this.animationHandle !== null) return;

    const loop = (time) => {
      const dt = Math.min(0.05, Math.max(0.001, (time - this.lastTime) / 1000));
      this.lastTime = time;
      this.frame += 1;

      if (this.needsResize) {
        this.resize();
      }

      this.render(time / 1000, dt);
      this.animationHandle = requestAnimationFrame(loop);
    };

    this.animationHandle = requestAnimationFrame(loop);
  }

  stop() {
    if (this.animationHandle !== null) {
      cancelAnimationFrame(this.animationHandle);
      this.animationHandle = null;
    }
  }

  destroy() {
    this.stop();
    window.removeEventListener("resize", this.handleResize);
  }

  getQualityProfile() {
    switch (this.quality) {
      case "ultra":
        return {
          starTex: 360,
          starUpdateEvery: 2,
          backgroundAlpha: 1.0,
          haloStrength: 1.2,
          granulationOctaves: 5
        };
      case "low":
        return {
          starTex: 180,
          starUpdateEvery: 7,
          backgroundAlpha: 0.65,
          haloStrength: 0.85,
          granulationOctaves: 3
        };
      case "balanced":
      default:
        return {
          starTex: 260,
          starUpdateEvery: 4,
          backgroundAlpha: 0.85,
          haloStrength: 1.0,
          granulationOctaves: 4
        };
    }
  }

  resolveEffectiveTemperature() {
    if (this.target && Number.isFinite(this.target.st_teff)) {
      return this.target.st_teff;
    }
    if (Number.isFinite(this.controls.stellarTemperature)) {
      return this.controls.stellarTemperature;
    }
    return 5772;
  }

  resolvePhase(seconds) {
    if (Number.isFinite(this.workerState.phase)) {
      return normalisePhase(this.workerState.phase);
    }

    const period = clamp(fallbackValue(this.controls.period, 3), 0.2, 1000);
    const phaseShift = fallbackValue(this.controls.phaseShift, 0);
    const autoPhase = ((seconds / (period * 1.8)) + phaseShift);
    return normalisePhase(autoPhase);
  }

  computeGeometry(seconds) {
    const controls = this.controls;
    const phase = this.resolvePhase(seconds);

    const starRadius = Math.min(this.width, this.height) * 0.235;
    const orbitRadius = clamp(starRadius * (1.45 + controls.scaledDistance * 0.055), starRadius * 1.45, starRadius * 2.6);

    const inclinationDeg = clamp(fallbackValue(controls.inclination, 89), 70, 90);
    const inclinationRad = degToRad(inclinationDeg);
    const impact = clamp(Math.cos(inclinationRad) * fallbackValue(controls.scaledDistance, 8), -1.2, 1.2);
    const projectedImpactY = impact * starRadius * 0.18;

    const theta = phase * TWO_PI;
    const xOrbit = orbitRadius * Math.sin(theta);
    const zOrbit = orbitRadius * Math.cos(theta);
    const yOrbit = projectedImpactY;

    const planetR = clamp(starRadius * fallbackValue(controls.radiusRatio, 0.1), 5, starRadius * 0.42);

    const moonEnabled = !!controls.enableExomoon;
    const moonOrbitScale = clamp(fallbackValue(controls.moonDistance, 1.6), 0.35, 4.5);
    const moonR = clamp(starRadius * fallbackValue(controls.moonRadius, 0.03), 2, starRadius * 0.18);

    const moonBaseOffset = degToRad(fallbackValue(controls.moonPhase, 0));
    const moonAngularRate = 8.0 + (2.6 / clamp(moonOrbitScale, 0.45, 4.5));
    const moonTheta = theta * moonAngularRate + moonBaseOffset;

    const moonOrbitRx = planetR * (1.9 + 1.5 * moonOrbitScale);
    const moonOrbitRy = planetR * (0.9 + 0.6 * moonOrbitScale);
    const moonX = xOrbit + moonOrbitRx * Math.cos(moonTheta);
    const moonY = yOrbit + moonOrbitRy * Math.sin(moonTheta) * 0.55;
    const moonZ = zOrbit + moonOrbitRx * 0.25 * Math.sin(moonTheta + 0.8);

    return {
      phase,
      theta,
      starRadius,
      orbitRadius,
      starX: this.width * 0.5,
      starY: this.height * 0.5,
      planetX: this.width * 0.5 + xOrbit,
      planetY: this.height * 0.5 + yOrbit,
      planetZ: zOrbit,
      planetR,
      moonEnabled,
      moonX: this.width * 0.5 + moonX,
      moonY: this.height * 0.5 + moonY,
      moonZ,
      moonR
    };
  }

  getStarBaseColor() {
    const teff = this.resolveEffectiveTemperature();
    const raw = kelvinToRgb(teff);

    if (teff < 3500) {
      return mixColor(raw, { r: 255, g: 145, b: 90 }, 0.28);
    }
    if (teff < 5200) {
      return mixColor(raw, { r: 255, g: 175, b: 95 }, 0.18);
    }
    if (teff < 6500) {
      return mixColor(raw, { r: 255, g: 210, b: 130 }, 0.10);
    }
    return raw;
  }

  rebuildStarTexture(timeSeconds) {
    const profile = this.getQualityProfile();
    const texSize = profile.starTex;

    if (!this.starTexture || this.starTextureSize !== texSize) {
      this.starTexture = document.createElement("canvas");
      this.starTexture.width = texSize;
      this.starTexture.height = texSize;
      this.starTextureSize = texSize;
      this.starTextureDirty = true;
    }

    const shouldUpdate = this.starTextureDirty || (this.frame % profile.starUpdateEvery === 0);

    if (!shouldUpdate) return;

    const ctx = this.starTexture.getContext("2d");
    const image = ctx.createImageData(texSize, texSize);
    const data = image.data;

    const base = this.getStarBaseColor();
    const innerHot = brighten(base, 1.18);
    const limbDark = darken(base, 0.58);
    const teff = this.resolveEffectiveTemperature();

    const u1 = clamp(fallbackValue(this.controls.limbU1, 0.32), 0, 1);
    const u2 = clamp(fallbackValue(this.controls.limbU2, 0.28), 0, 1);

    const octaves = profile.granulationOctaves;
    const rot = timeSeconds * 0.06;
    const flow = timeSeconds * 0.18;

    for (let y = 0; y < texSize; y += 1) {
      for (let x = 0; x < texSize; x += 1) {
        const nx = (x + 0.5) / texSize * 2 - 1;
        const ny = (y + 0.5) / texSize * 2 - 1;
        const rr = nx * nx + ny * ny;

        const idx = (y * texSize + x) * 4;

        if (rr > 1) {
          data[idx + 0] = 0;
          data[idx + 1] = 0;
          data[idx + 2] = 0;
          data[idx + 3] = 0;
          continue;
        }

        const mu = Math.sqrt(1 - rr);
        const limb = clamp(1 - u1 * (1 - mu) - u2 * (1 - mu) * (1 - mu), 0.05, 1);

        const rx = nx * Math.cos(rot) - ny * Math.sin(rot);
        const ry = nx * Math.sin(rot) + ny * Math.cos(rot);

        const largeGran = fbm(rx * 3.0 + flow * 0.6, ry * 3.2 - flow * 0.4, octaves);
        const midGran = fbm(rx * 8.8 - flow * 1.0, ry * 8.4 + flow * 0.8, octaves - 1);
        const fineGran = fbm(rx * 18.0 + flow * 1.6, ry * 17.0 - flow * 1.1, 2);

        let gran = 0.56 * largeGran + 0.30 * midGran + 0.14 * fineGran;
        gran = clamp(gran, 0, 1);

        const cellContrast = teff < 4500 ? 0.14 : teff > 7000 ? 0.08 : 0.11;
        const cell = 1 + (gran - 0.5) * (cellContrast * 2.0);

        const centerBias = 0.88 + 0.22 * Math.pow(mu, 0.7);
        const brightPatch = fbm(rx * 1.8 - flow * 0.15, ry * 1.8 + flow * 0.17, 3);
        const activeBoost = 1 + (brightPatch - 0.5) * 0.07;

        const brightness = clamp(limb * cell * centerBias * activeBoost, 0, 1.25);

        const hotMix = clamp(Math.pow(mu, 1.4) * 0.65 + gran * 0.18, 0, 1);
        const c1 = mixColor(limbDark, base, 0.55 + 0.45 * brightness);
        const c2 = mixColor(c1, innerHot, hotMix * 0.45);

        data[idx + 0] = Math.round(clamp(c2.r * brightness, 0, 255));
        data[idx + 1] = Math.round(clamp(c2.g * brightness, 0, 255));
        data[idx + 2] = Math.round(clamp(c2.b * brightness, 0, 255));
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(image, 0, 0);
    this.starTextureDirty = false;
  }

  rebuildStarspotTexture() {
    const tex = document.createElement("canvas");
    tex.width = 256;
    tex.height = 256;
    const ctx = tex.getContext("2d");

    ctx.clearRect(0, 0, 256, 256);

    const controls = this.controls;
    if (!controls.enableStarspot) {
      this.starSpotTexture = tex;
      this.starSpotDirty = false;
      return;
    }

    const x = 128 + clamp(controls.spotX, -0.8, 0.8) * 90;
    const y = 128 - clamp(controls.spotY, -0.8, 0.8) * 90;
    const r = clamp(controls.spotRadius, 0.03, 0.35) * 220;
    const contrast = clamp(controls.spotContrast, 0.05, 0.95);

    ctx.save();
    ctx.translate(x, y);

    const blobs = [
      { dx: 0, dy: 0, rr: 1.00 },
      { dx: -0.35 * r, dy: -0.08 * r, rr: 0.58 },
      { dx: 0.26 * r, dy: 0.10 * r, rr: 0.42 },
      { dx: 0.10 * r, dy: -0.26 * r, rr: 0.34 }
    ];

    blobs.forEach((b, i) => {
      const pen = ctx.createRadialGradient(
        b.dx,
        b.dy,
        b.rr * r * 0.20,
        b.dx,
        b.dy,
        b.rr * r
      );

      pen.addColorStop(0, `rgba(50, 25, 10, ${0.28 + contrast * 0.30})`);
      pen.addColorStop(0.58, `rgba(35, 18, 8, ${0.18 + contrast * 0.22})`);
      pen.addColorStop(1, "rgba(0,0,0,0)");

      ctx.fillStyle = pen;
      ctx.beginPath();
      ctx.ellipse(
        b.dx,
        b.dy,
        b.rr * r * (1.0 + 0.08 * i),
        b.rr * r * (0.82 + 0.06 * i),
        i * 0.7,
        0,
        TWO_PI
      );
      ctx.fill();
    });

    blobs.forEach((b, i) => {
      const umb = ctx.createRadialGradient(
        b.dx,
        b.dy,
        b.rr * r * 0.05,
        b.dx,
        b.dy,
        b.rr * r * 0.45
      );

      umb.addColorStop(0, `rgba(24, 12, 5, ${0.48 + contrast * 0.35})`);
      umb.addColorStop(1, "rgba(10,6,3,0)");

      ctx.fillStyle = umb;
      ctx.beginPath();
      ctx.ellipse(
        b.dx,
        b.dy,
        b.rr * r * 0.52,
        b.rr * r * 0.36,
        i * 0.9 + 0.3,
        0,
        TWO_PI
      );
      ctx.fill();
    });

    ctx.restore();

    this.starSpotTexture = tex;
    this.starSpotDirty = false;
  }

  drawBackground(timeSeconds) {
    const ctx = this.ctx;
    const isLight = this.theme === "light";

    if (isLight) {
      const g = ctx.createLinearGradient(0, 0, 0, this.height);
      g.addColorStop(0, "#f4f7fb");
      g.addColorStop(1, "#edf2f8");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.width, this.height);
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, this.height);
      g.addColorStop(0, "#061120");
      g.addColorStop(0.55, "#08172a");
      g.addColorStop(1, "#091423");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.width, this.height);
    }

    const profile = this.getQualityProfile();
    const alphaScale = profile.backgroundAlpha;

    for (let i = 0; i < this.backgroundStars.length; i += 1) {
      const star = this.backgroundStars[i];
      const tw = 0.85 + 0.15 * Math.sin(timeSeconds * star.twinkle + i * 1.7);

      this.ctx.fillStyle = isLight
        ? `rgba(120,140,170,${0.22 * star.a * tw})`
        : `rgba(220,235,255,${0.55 * alphaScale * star.a * tw})`;

      this.ctx.beginPath();
      this.ctx.arc(
        star.x * this.width,
        star.y * this.height,
        star.r,
        0,
        TWO_PI
      );
      this.ctx.fill();
    }
  }

  drawHalo(geom, baseColor) {
    const ctx = this.ctx;
    const profile = this.getQualityProfile();
    const haloR = geom.starRadius * (1.65 + 0.12 * profile.haloStrength);

    const outer = ctx.createRadialGradient(
      geom.starX,
      geom.starY,
      geom.starRadius * 0.84,
      geom.starX,
      geom.starY,
      haloR
    );

    const hot = brighten(baseColor, 1.15);
    const warm = mixColor(baseColor, { r: 255, g: 160, b: 70 }, 0.45);

    if (this.theme === "light") {
      outer.addColorStop(0, rgbToCss(hot, 0.10));
      outer.addColorStop(0.35, rgbToCss(warm, 0.08));
      outer.addColorStop(1, "rgba(255,255,255,0)");
    } else {
      outer.addColorStop(0, rgbToCss(hot, 0.22));
      outer.addColorStop(0.45, rgbToCss(warm, 0.14));
      outer.addColorStop(1, "rgba(0,0,0,0)");
    }

    ctx.fillStyle = outer;
    ctx.beginPath();
    ctx.arc(geom.starX, geom.starY, haloR, 0, TWO_PI);
    ctx.fill();
  }

  drawStar(geom, timeSeconds) {
    const ctx = this.ctx;
    const baseColor = this.getStarBaseColor();

    this.rebuildStarTexture(timeSeconds);
    if (this.starSpotDirty) {
      this.rebuildStarspotTexture();
    }

    this.drawHalo(geom, baseColor);

    ctx.save();
    ctx.beginPath();
    ctx.arc(geom.starX, geom.starY, geom.starRadius, 0, TWO_PI);
    ctx.clip();

    if (this.starTexture) {
      ctx.drawImage(
        this.starTexture,
        geom.starX - geom.starRadius,
        geom.starY - geom.starRadius,
        geom.starRadius * 2,
        geom.starRadius * 2
      );
    }

    if (this.controls.enableStarspot && this.starSpotTexture) {
      ctx.globalCompositeOperation = "multiply";
      ctx.drawImage(
        this.starSpotTexture,
        geom.starX - geom.starRadius,
        geom.starY - geom.starRadius,
        geom.starRadius * 2,
        geom.starRadius * 2
      );
      ctx.globalCompositeOperation = "source-over";
    }

    const glare = ctx.createRadialGradient(
      geom.starX - geom.starRadius * 0.22,
      geom.starY - geom.starRadius * 0.20,
      geom.starRadius * 0.10,
      geom.starX - geom.starRadius * 0.22,
      geom.starY - geom.starRadius * 0.20,
      geom.starRadius * 1.1
    );

    const hotColor = brighten(baseColor, 1.22);
    glare.addColorStop(0, rgbToCss(hotColor, 0.28));
    glare.addColorStop(0.38, rgbToCss(hotColor, 0.09));
    glare.addColorStop(1, "rgba(255,255,255,0)");

    ctx.fillStyle = glare;
    ctx.beginPath();
    ctx.arc(geom.starX, geom.starY, geom.starRadius, 0, TWO_PI);
    ctx.fill();

    ctx.restore();

    const rim = ctx.createRadialGradient(
      geom.starX,
      geom.starY,
      geom.starRadius * 0.72,
      geom.starX,
      geom.starY,
      geom.starRadius
    );

    rim.addColorStop(0, "rgba(0,0,0,0)");
    rim.addColorStop(1, this.theme === "light" ? "rgba(80,40,15,0.35)" : "rgba(0,0,0,0.42)");

    ctx.strokeStyle = this.theme === "light"
      ? "rgba(135,92,48,0.35)"
      : "rgba(255,188,120,0.22)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(geom.starX, geom.starY, geom.starRadius, 0, TWO_PI);
    ctx.stroke();

    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(geom.starX, geom.starY, geom.starRadius, 0, TWO_PI);
    ctx.fill();
  }

  drawSphereBody(x, y, r, options = {}) {
    const ctx = this.ctx;

    const base = options.baseColor || { r: 30, g: 60, b: 90 };
    const isMoon = !!options.isMoon;
    const lightX = options.lightX ?? -0.65;
    const lightY = options.lightY ?? -0.35;
    const glow = options.glow ?? false;

    const dark = darken(base, isMoon ? 0.38 : 0.26);
    const mid = darken(base, isMoon ? 0.72 : 0.58);
    const bright = brighten(base, isMoon ? 1.05 : 1.14);

    if (glow) {
      const outer = ctx.createRadialGradient(x, y, r * 0.1, x, y, r * 1.45);
      outer.addColorStop(0, "rgba(255,255,255,0)");
      outer.addColorStop(0.7, "rgba(80,180,255,0.05)");
      outer.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = outer;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.45, 0, TWO_PI);
      ctx.fill();
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TWO_PI);
    ctx.clip();

    const grad = ctx.createRadialGradient(
      x + lightX * r * 0.45,
      y + lightY * r * 0.45,
      r * 0.12,
      x,
      y,
      r
    );

    grad.addColorStop(0, rgbToCss(bright, 1));
    grad.addColorStop(0.34, rgbToCss(mid, 1));
    grad.addColorStop(1, rgbToCss(dark, 1));

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TWO_PI);
    ctx.fill();

    if (!isMoon) {
      ctx.globalAlpha = 0.18;
      ctx.strokeStyle = "rgba(255,215,145,0.35)";
      ctx.lineWidth = Math.max(0.7, r * 0.06);

      for (let i = -2; i <= 2; i += 1) {
        ctx.beginPath();
        ctx.ellipse(
          x,
          y + i * r * 0.18,
          r * (0.82 - Math.abs(i) * 0.08),
          r * 0.18,
          0.08 * i,
          0,
          TWO_PI
        );
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    const edgeShade = ctx.createRadialGradient(x, y, r * 0.65, x, y, r);
    edgeShade.addColorStop(0, "rgba(0,0,0,0)");
    edgeShade.addColorStop(1, "rgba(0,0,0,0.32)");

    ctx.fillStyle = edgeShade;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TWO_PI);
    ctx.fill();

    ctx.restore();

    ctx.strokeStyle = this.theme === "light"
      ? "rgba(40,50,60,0.28)"
      : "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TWO_PI);
    ctx.stroke();
  }

  drawPlanetShadowOnStar(geom) {
    if (geom.planetZ <= 0) return;

    const dx = geom.planetX - geom.starX;
    const dy = geom.planetY - geom.starY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > geom.starRadius + geom.planetR) return;

    const ctx = this.ctx;
    const shadowR = geom.planetR * 1.05;

    const g = ctx.createRadialGradient(
      geom.planetX - geom.planetR * 0.12,
      geom.planetY - geom.planetR * 0.10,
      geom.planetR * 0.15,
      geom.planetX,
      geom.planetY,
      shadowR
    );

    g.addColorStop(0, "rgba(0,0,0,0.58)");
    g.addColorStop(0.75, "rgba(0,0,0,0.42)");
    g.addColorStop(1, "rgba(0,0,0,0)");

    ctx.save();
    ctx.beginPath();
    ctx.arc(geom.starX, geom.starY, geom.starRadius, 0, TWO_PI);
    ctx.clip();
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(geom.planetX, geom.planetY, shadowR, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }

  drawMoonShadowOnStar(geom) {
    if (!geom.moonEnabled || geom.moonZ <= 0) return;

    const dx = geom.moonX - geom.starX;
    const dy = geom.moonY - geom.starY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > geom.starRadius + geom.moonR) return;

    const ctx = this.ctx;
    const shadowR = geom.moonR * 1.04;
    const g = ctx.createRadialGradient(
      geom.moonX,
      geom.moonY,
      geom.moonR * 0.10,
      geom.moonX,
      geom.moonY,
      shadowR
    );

    g.addColorStop(0, "rgba(0,0,0,0.42)");
    g.addColorStop(1, "rgba(0,0,0,0)");

    ctx.save();
    ctx.beginPath();
    ctx.arc(geom.starX, geom.starY, geom.starRadius, 0, TWO_PI);
    ctx.clip();
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(geom.moonX, geom.moonY, shadowR, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }

  render(seconds) {
    if (!this.ctx || !this.canvas) return;

    this.drawBackground(seconds);

    const geom = this.computeGeometry(seconds);

    // Remove fake orbit rings: only a very subtle orbital baseline
    this.drawSubtleOrbitalGuide(geom);

    // Draw back bodies first
    if (geom.moonEnabled && geom.moonZ < 0) {
      this.drawMoon(geom);
    }
    if (geom.planetZ < 0) {
      this.drawPlanet(geom);
    }

    // Draw star
    this.drawStar(geom, seconds);

    // Draw shadows / occultations on star if bodies are in front
    this.drawPlanetShadowOnStar(geom);
    this.drawMoonShadowOnStar(geom);

    // Draw front bodies
    if (geom.planetZ >= 0) {
      this.drawPlanet(geom);
    }
    if (geom.moonEnabled && geom.moonZ >= 0) {
      this.drawMoon(geom);
    }
  }

  drawSubtleOrbitalGuide(geom) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = this.theme === "light"
      ? "rgba(110,130,160,0.12)"
      : "rgba(140,180,255,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(geom.starX - geom.orbitRadius, geom.starY);
    ctx.lineTo(geom.starX + geom.orbitRadius, geom.starY);
    ctx.stroke();
    ctx.restore();
  }

  drawPlanet(geom) {
    const basePlanetColor = { r: 20, g: 58, b: 84 };
    this.drawSphereBody(geom.planetX, geom.planetY, geom.planetR, {
      baseColor: basePlanetColor,
      isMoon: false,
      glow: false,
      lightX: -0.9,
      lightY: -0.35
    });
  }

  drawMoon(geom) {
    const moonColor = { r: 165, g: 146, b: 118 };
    this.drawSphereBody(geom.moonX, geom.moonY, geom.moonR, {
      baseColor: moonColor,
      isMoon: true,
      glow: false,
      lightX: -0.9,
      lightY: -0.35
    });
  }
}
