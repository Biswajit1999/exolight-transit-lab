/* ============================================================================
   ExoIntel-Prime
   src/scene.js

   Ultra flagship WebGL scene renderer for the ExoLight Transit Lab.

   Goals of this renderer
   ----------------------
   1. Stronger 3D stellar realism with temperature-aware appearance.
   2. Better procedural photosphere/granulation for low/balanced/high/ultra.
   3. Dark planetary silhouette during transit rather than a bright blue disc.
   4. Cleaner moon handling and slower, more physical-looking moon motion.
   5. A stable API with multiple alias methods so the main app can call it
      safely even if older integration code still exists.

   External dependency
   -------------------
   - Three.js loaded directly from CDN (no bundler/build step required).

   ========================================================================== */

import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";

/* ---------------------------------------------------------------------------
   Quality presets
--------------------------------------------------------------------------- */

const QUALITY_PRESETS = {
  low: {
    pixelRatio: 1.0,
    antialias: true,
    starSegments: 96,
    planetSegments: 48,
    moonSegments: 32,
    starfieldCount: 700,
    textureSize: 512,
    glowOpacity: 0.18,
    coronaScale: 1.14,
    bumpScale: 0.08,
    ambientIntensity: 0.42,
    pointLightIntensity: 1.45,
    starRotationSpeed: 0.018,
    textureDrift: 0.0015
  },
  balanced: {
    pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
    antialias: true,
    starSegments: 128,
    planetSegments: 64,
    moonSegments: 40,
    starfieldCount: 1200,
    textureSize: 768,
    glowOpacity: 0.22,
    coronaScale: 1.18,
    bumpScale: 0.11,
    ambientIntensity: 0.46,
    pointLightIntensity: 1.65,
    starRotationSpeed: 0.021,
    textureDrift: 0.0020
  },
  high: {
    pixelRatio: Math.min(window.devicePixelRatio || 1, 1.9),
    antialias: true,
    starSegments: 176,
    planetSegments: 88,
    moonSegments: 56,
    starfieldCount: 1800,
    textureSize: 1024,
    glowOpacity: 0.26,
    coronaScale: 1.22,
    bumpScale: 0.14,
    ambientIntensity: 0.50,
    pointLightIntensity: 1.82,
    starRotationSpeed: 0.024,
    textureDrift: 0.0024
  },
  ultra: {
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2.2),
    antialias: true,
    starSegments: 256,
    planetSegments: 120,
    moonSegments: 72,
    starfieldCount: 2800,
    textureSize: 1536,
    glowOpacity: 0.30,
    coronaScale: 1.28,
    bumpScale: 0.18,
    ambientIntensity: 0.56,
    pointLightIntensity: 2.0,
    starRotationSpeed: 0.028,
    textureDrift: 0.0030
  }
};

const TWO_PI = Math.PI * 2;
const STAR_RADIUS = 1.55;
const PLANET_BASE_RADIUS = 0.23;
const MOON_BASE_RADIUS = 0.05;

/* ---------------------------------------------------------------------------
   Utility helpers
--------------------------------------------------------------------------- */

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
}

function degToRad(deg) {
  return deg * Math.PI / 180;
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function approxKelvinToRGB(tempKelvin) {
  const temp = clamp(tempKelvin || 5778, 2500, 20000) / 100;
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

  red = clamp(red, 0, 255) / 255;
  green = clamp(green, 0, 255) / 255;
  blue = clamp(blue, 0, 255) / 255;

  return new THREE.Color(red, green, blue);
}

function spectralClassFromTeff(teff) {
  const t = safeNumber(teff, 5778);
  if (t >= 30000) return "O";
  if (t >= 10000) return "B";
  if (t >= 7500) return "A";
  if (t >= 6000) return "F";
  if (t >= 5200) return "G";
  if (t >= 3700) return "K";
  return "M";
}

function normaliseSpotCoordinate(v) {
  const n = safeNumber(v, 0);
  return clamp(n, -0.95, 0.95);
}

function inferBoolean(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === "boolean") return candidate;
    if (candidate === 1 || candidate === "1" || candidate === "true" || candidate === "on") {
      return true;
    }
    if (candidate === 0 || candidate === "0" || candidate === "false" || candidate === "off") {
      return false;
    }
  }
  return false;
}

/* ---------------------------------------------------------------------------
   Small procedural texture toolkit
--------------------------------------------------------------------------- */

function createCanvas(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createRandomGrid(gridSize) {
  const grid = new Float32Array(gridSize * gridSize);
  for (let i = 0; i < grid.length; i += 1) {
    grid[i] = Math.random();
  }
  return grid;
}

function sampleGrid(grid, gridSize, x, y) {
  const ix = ((x % gridSize) + gridSize) % gridSize;
  const iy = ((y % gridSize) + gridSize) % gridSize;
  return grid[iy * gridSize + ix];
}

function bilerp(a, b, c, d, tx, ty) {
  const ab = lerp(a, b, tx);
  const cd = lerp(c, d, tx);
  return lerp(ab, cd, ty);
}

function fractalNoiseValue(u, v, octaves = 5, persistence = 0.55) {
  let amplitude = 1;
  let frequency = 1.4;
  let total = 0;
  let norm = 0;

  for (let octave = 0; octave < octaves; octave += 1) {
    const gridSize = 8 * Math.pow(2, octave);
    const grid = fractalNoiseValue._grids[gridSize] || (fractalNoiseValue._grids[gridSize] = createRandomGrid(gridSize));

    const x = u * gridSize * frequency;
    const y = v * gridSize * frequency;

    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = x0 + 1;
    const y1 = y0 + 1;

    const tx = x - x0;
    const ty = y - y0;

    const a = sampleGrid(grid, gridSize, x0, y0);
    const b = sampleGrid(grid, gridSize, x1, y0);
    const c = sampleGrid(grid, gridSize, x0, y1);
    const d = sampleGrid(grid, gridSize, x1, y1);

    const s = smoothstep(0, 1, tx);
    const t = smoothstep(0, 1, ty);
    const value = bilerp(a, b, c, d, s, t);

    total += value * amplitude;
    norm += amplitude;

    amplitude *= persistence;
    frequency *= 1.9;
  }

  return total / (norm || 1);
}
fractalNoiseValue._grids = {};

function createStarTexture(size, teff) {
  const canvas = createCanvas(size);
  const ctx = canvas.getContext("2d");

  const baseColor = approxKelvinToRGB(teff);
  const spectral = spectralClassFromTeff(teff);

  const warm = new THREE.Color(baseColor);
  const dark = new THREE.Color(baseColor).multiplyScalar(0.35);
  const hot = new THREE.Color(baseColor).lerp(new THREE.Color(1, 0.98, 0.92), spectral === "A" || spectral === "B" || spectral === "O" ? 0.55 : 0.18);

  const image = ctx.createImageData(size, size);
  const data = image.data;

  for (let y = 0; y < size; y += 1) {
    const v = y / (size - 1);
    for (let x = 0; x < size; x += 1) {
      const u = x / (size - 1);

      const nx = u - 0.5;
      const ny = v - 0.5;
      const r = Math.sqrt(nx * nx + ny * ny);

      const gran1 = fractalNoiseValue(u * 1.2, v * 1.2, 5, 0.56);
      const gran2 = fractalNoiseValue(u * 3.7 + 5.4, v * 3.7 + 1.8, 4, 0.52);
      const gran3 = fractalNoiseValue(u * 8.2 + 2.4, v * 8.2 + 6.1, 3, 0.48);

      const network = Math.pow(gran2, 1.7);
      const cells = (gran1 * 0.62 + gran2 * 0.28 + gran3 * 0.10);
      const contrast = 0.78 + (network - 0.5) * 0.42;
      const limb = clamp(1.08 - Math.pow(r, 1.6) * 0.42, 0.62, 1.08);
      const facula = smoothstep(0.68, 1.0, r) * (network * 0.22);
      const intensity = clamp(cells * contrast * limb + facula, 0, 1.25);

      const color = new THREE.Color(dark);
      color.lerp(warm, clamp(intensity * 0.95, 0, 1));
      color.lerp(hot, clamp((intensity - 0.65) * 0.9, 0, 1));

      const idx = (y * size + x) * 4;
      data[idx] = Math.round(color.r * 255);
      data[idx + 1] = Math.round(color.g * 255);
      data[idx + 2] = Math.round(color.b * 255);
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

function createStarBumpTexture(size) {
  const canvas = createCanvas(size);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(size, size);
  const data = image.data;

  for (let y = 0; y < size; y += 1) {
    const v = y / (size - 1);
    for (let x = 0; x < size; x += 1) {
      const u = x / (size - 1);

      const n1 = fractalNoiseValue(u * 1.5, v * 1.5, 5, 0.58);
      const n2 = fractalNoiseValue(u * 6.0 + 2.1, v * 6.0 + 4.2, 3, 0.50);
      const grain = clamp((n1 * 0.68 + n2 * 0.32), 0, 1);
      const g = Math.round(grain * 255);

      const idx = (y * size + x) * 4;
      data[idx] = g;
      data[idx + 1] = g;
      data[idx + 2] = g;
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

function createPlanetTexture(size) {
  const canvas = createCanvas(size);
  const ctx = canvas.getContext("2d");

  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, "#0d2536");
  grad.addColorStop(0.5, "#133d53");
  grad.addColorStop(1, "#0b1a24");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 16; i += 1) {
    const y = (i + 0.5) / 16;
    const bandNoise = fractalNoiseValue(i * 0.73, i * 1.11, 3, 0.55);
    const thickness = size * lerp(0.018, 0.07, bandNoise);
    const centerY = y * size + (bandNoise - 0.5) * size * 0.03;
    const alpha = lerp(0.05, 0.18, bandNoise);

    ctx.fillStyle = `rgba(120, 210, 230, ${alpha.toFixed(3)})`;
    ctx.fillRect(0, centerY - thickness * 0.5, size, thickness);

    ctx.fillStyle = `rgba(10, 25, 40, ${(alpha * 0.55).toFixed(3)})`;
    ctx.fillRect(0, centerY + thickness * 0.18, size, thickness * 0.38);
  }

  for (let k = 0; k < 1000; k += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = Math.random() * size * 0.01;
    ctx.fillStyle = `rgba(160,220,240,${(Math.random() * 0.05).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TWO_PI);
    ctx.fill();
  }

  return canvas;
}

function createMoonTexture(size) {
  const canvas = createCanvas(size);
  const ctx = canvas.getContext("2d");
  const base = ctx.createRadialGradient(size * 0.35, size * 0.3, size * 0.1, size * 0.5, size * 0.5, size * 0.6);
  base.addColorStop(0, "#d4b48a");
  base.addColorStop(0.45, "#a78966");
  base.addColorStop(1, "#5f4938");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 350; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = Math.random() * size * 0.03;
    ctx.fillStyle = `rgba(70,50,40,${(0.04 + Math.random() * 0.08).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TWO_PI);
    ctx.fill();
  }

  return canvas;
}

function createSpotTexture(size) {
  const canvas = createCanvas(size);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);

  for (let i = 0; i < 16; i += 1) {
    const cx = size * (0.5 + (Math.random() - 0.5) * 0.26);
    const cy = size * (0.5 + (Math.random() - 0.5) * 0.26);
    const rx = size * (0.12 + Math.random() * 0.14);
    const ry = size * (0.09 + Math.random() * 0.12);

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
    grad.addColorStop(0.0, "rgba(20,12,8,0.66)");
    grad.addColorStop(0.55, "rgba(45,28,18,0.36)");
    grad.addColorStop(1.0, "rgba(40,24,18,0.00)");

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, Math.random() * Math.PI, 0, TWO_PI);
    ctx.fill();
  }

  return canvas;
}

function textureFromCanvas(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

/* ---------------------------------------------------------------------------
   Scene renderer
--------------------------------------------------------------------------- */

class ExoSceneRenderer {
  constructor(targetOrOptions = {}) {
    const options = this._resolveConstructorOptions(targetOrOptions);
    this.container = options.container;
    this.onReady = typeof options.onReady === "function" ? options.onReady : null;
    this.onError = typeof options.onError === "function" ? options.onError : null;
    this.quality = this._normaliseQuality(options.quality || "balanced");
    this.theme = options.theme || "night";

    this._destroyed = false;
    this._clock = new THREE.Clock();
    this._lastRenderPhase = 0;
    this._idlePhase = 0;
    this._currentState = this._createDefaultState();
    this._targetMeta = {
      pl_name: "Planet",
      hostname: "Host star",
      st_teff: 5778
    };

    this._buildBase();
    this._buildSceneGraph();
    this._applyTargetAppearance();
    this._applyStateToScene(true);
    this._bindResize();
    this._animate();

    if (this.onReady) {
      this.onReady(this);
    }
  }

  /* -----------------------------------------------------------------------
     Public API
  ----------------------------------------------------------------------- */

  setQuality(quality) {
    const next = this._normaliseQuality(quality);
    if (next === this.quality) return;
    this.quality = next;
    this._rebuildQualitySensitiveAssets();
  }

  setTheme(theme) {
    this.theme = theme === "light" ? "light" : "night";
    const clearColor = this.theme === "light" ? 0xf3f6fb : 0x04101f;
    this.renderer.setClearColor(clearColor, 0);
  }

  setTarget(meta = {}) {
    this._targetMeta = { ...this._targetMeta, ...meta };
    this._applyTargetAppearance();
  }

  setTargetMeta(meta = {}) {
    this.setTarget(meta);
  }

  setTargetData(meta = {}) {
    this.setTarget(meta);
  }

  update(state = {}) {
    this._ingestState(state);
    this._applyTargetAppearance();
    this._applyStateToScene(false);
  }

  setState(state = {}) {
    this.update(state);
  }

  syncState(state = {}) {
    this.update(state);
  }

  updateFromModel(state = {}) {
    this.update(state);
  }

  applyModelState(state = {}) {
    this.update(state);
  }

  resize() {
    if (this._destroyed) return;
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(10, Math.floor(rect.width));
    const height = Math.max(10, Math.floor(rect.height));

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setPixelRatio(QUALITY_PRESETS[this.quality].pixelRatio);
    this.renderer.setSize(width, height, false);
  }

  dispose() {
    this._destroyed = true;
    window.removeEventListener("resize", this._boundResize);

    if (this._rafId) cancelAnimationFrame(this._rafId);

    this.renderer.dispose();

    this.scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose && m.dispose());
        } else if (obj.material.dispose) {
          obj.material.dispose();
        }
      }
    });

    if (this.renderer.domElement && this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }

  /* -----------------------------------------------------------------------
     Construction
  ----------------------------------------------------------------------- */

  _resolveConstructorOptions(targetOrOptions) {
    if (targetOrOptions instanceof HTMLElement) {
      return { container: targetOrOptions };
    }
    if (typeof targetOrOptions === "string") {
      const el = document.querySelector(targetOrOptions);
      if (!el) {
        throw new Error(`ExoSceneRenderer: container "${targetOrOptions}" not found.`);
      }
      return { container: el };
    }
    const options = targetOrOptions || {};
    const container = options.container || options.mount || options.el || options.element;
    if (!(container instanceof HTMLElement)) {
      throw new Error("ExoSceneRenderer: a valid container HTMLElement is required.");
    }
    return { ...options, container };
  }

  _normaliseQuality(quality) {
    const key = String(quality || "balanced").toLowerCase();
    if (QUALITY_PRESETS[key]) return key;
    return "balanced";
  }

  _createDefaultState() {
    return {
      visualQuality: "balanced",
      theme: "night",
      orbitalPhase: 0,
      modelPhase: 0,
      phaseShift: 0,

      st_teff: 5778,
      pl_ratror: 0.12,
      aRs: 8.5,
      inclination: 87.5,
      eccentricity: 0.0,

      starspotEnabled: false,
      spotX: 0.20,
      spotY: 0.10,
      spotRadius: 0.12,
      spotContrast: 0.55,

      exomoonEnabled: false,
      moonRadius: 0.025,
      moonDistance: 0.55,
      moonPhaseDeg: 45
    };
  }

  _buildBase() {
    const preset = QUALITY_PRESETS[this.quality];

    this.renderer = new THREE.WebGLRenderer({
      antialias: preset.antialias,
      alpha: true,
      powerPreference: "high-performance"
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(preset.pixelRatio);
    this.renderer.setClearColor(this.theme === "light" ? 0xf3f6fb : 0x04101f, 0);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.display = "block";
    this.container.innerHTML = "";
    this.container.appendChild(this.renderer.domElement);

    const rect = this.container.getBoundingClientRect();
    this.renderer.setSize(Math.max(10, rect.width), Math.max(10, rect.height), false);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(
      30,
      Math.max(1, rect.width / Math.max(1, rect.height)),
      0.01,
      100
    );
    this.camera.position.set(0, 0.2, 7.4);

    this.ambientLight = new THREE.AmbientLight(0x9db6d8, preset.ambientIntensity);
    this.scene.add(this.ambientLight);

    this.keyLight = new THREE.PointLight(0xfff1d2, preset.pointLightIntensity, 40, 2.0);
    this.keyLight.position.set(0, 0, 0);
    this.scene.add(this.keyLight);

    this.rimLight = new THREE.DirectionalLight(0x83aaff, 0.36);
    this.rimLight.position.set(-5, 2, 4);
    this.scene.add(this.rimLight);
  }

  _buildSceneGraph() {
    const preset = QUALITY_PRESETS[this.quality];

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.orbitGroup = new THREE.Group();
    this.root.add(this.orbitGroup);

    this.starGroup = new THREE.Group();
    this.root.add(this.starGroup);

    /* Background star field */
    this.starfield = this._createStarfield(preset.starfieldCount);
    this.scene.add(this.starfield);

    /* A very faint transit chord only, no cartoon orbit circles */
    this.transitChord = this._createTransitChord();
    this.root.add(this.transitChord);

    /* Star */
    const starGeo = new THREE.SphereGeometry(STAR_RADIUS, preset.starSegments, preset.starSegments);

    this.starTexture = textureFromCanvas(createStarTexture(preset.textureSize, this._targetMeta.st_teff || 5778));
    this.starBumpTexture = textureFromCanvas(createStarBumpTexture(preset.textureSize));

    this.starMaterial = new THREE.MeshPhysicalMaterial({
      color: approxKelvinToRGB(this._targetMeta.st_teff || 5778).multiplyScalar(0.88),
      map: this.starTexture,
      emissive: approxKelvinToRGB(this._targetMeta.st_teff || 5778).multiplyScalar(0.22),
      emissiveMap: this.starTexture,
      emissiveIntensity: 0.62,
      bumpMap: this.starBumpTexture,
      bumpScale: preset.bumpScale,
      roughness: 0.95,
      metalness: 0.0,
      clearcoat: 0.0
    });

    this.starMesh = new THREE.Mesh(starGeo, this.starMaterial);
    this.starMesh.castShadow = false;
    this.starMesh.receiveShadow = false;
    this.starGroup.add(this.starMesh);

    /* Corona / glow shells */
    this.innerCorona = new THREE.Mesh(
      new THREE.SphereGeometry(STAR_RADIUS * 1.03, Math.max(48, preset.starSegments / 2), Math.max(48, preset.starSegments / 2)),
      new THREE.MeshBasicMaterial({
        color: approxKelvinToRGB(this._targetMeta.st_teff || 5778).multiplyScalar(0.92),
        transparent: true,
        opacity: preset.glowOpacity * 0.34,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    this.starGroup.add(this.innerCorona);

    this.outerCorona = new THREE.Mesh(
      new THREE.SphereGeometry(STAR_RADIUS * preset.coronaScale, Math.max(42, preset.starSegments / 2), Math.max(42, preset.starSegments / 2)),
      new THREE.MeshBasicMaterial({
        color: approxKelvinToRGB(this._targetMeta.st_teff || 5778).multiplyScalar(0.78),
        transparent: true,
        opacity: preset.glowOpacity * 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.BackSide
      })
    );
    this.starGroup.add(this.outerCorona);

    /* Planet */
    const planetGeo = new THREE.SphereGeometry(PLANET_BASE_RADIUS, preset.planetSegments, preset.planetSegments);
    this.planetTexture = textureFromCanvas(createPlanetTexture(768));
    this.planetMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color("#5da9c7"),
      map: this.planetTexture,
      roughness: 0.86,
      metalness: 0.02,
      clearcoat: 0.02,
      sheen: 0.0
    });
    this.planetMesh = new THREE.Mesh(planetGeo, this.planetMaterial);
    this.orbitGroup.add(this.planetMesh);

    /* Planet transit silhouette shell (very faint atmospheric rim) */
    this.planetAtmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(PLANET_BASE_RADIUS * 1.035, Math.max(24, preset.planetSegments / 2), Math.max(24, preset.planetSegments / 2)),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color("#4bc6ff"),
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    this.orbitGroup.add(this.planetAtmosphere);

    /* Moon */
    const moonGeo = new THREE.SphereGeometry(MOON_BASE_RADIUS, preset.moonSegments, preset.moonSegments);
    this.moonTexture = textureFromCanvas(createMoonTexture(512));
    this.moonMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#b3946f"),
      map: this.moonTexture,
      roughness: 0.95,
      metalness: 0.0
    });
    this.moonMesh = new THREE.Mesh(moonGeo, this.moonMaterial);
    this.orbitGroup.add(this.moonMesh);

    this.moonAtmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(MOON_BASE_RADIUS * 1.03, Math.max(16, preset.moonSegments / 2), Math.max(16, preset.moonSegments / 2)),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color("#e1b67c"),
        transparent: true,
        opacity: 0.08,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    this.orbitGroup.add(this.moonAtmosphere);

    /* Spot decal */
    this.spotTexture = textureFromCanvas(createSpotTexture(512));
    this.spotMaterial = new THREE.MeshBasicMaterial({
      map: this.spotTexture,
      transparent: true,
      depthWrite: false,
      opacity: 0.55
    });
    this.spotMesh = new THREE.Mesh(
      new THREE.CircleGeometry(0.18, 48),
      this.spotMaterial
    );
    this.starGroup.add(this.spotMesh);
  }

  _createStarfield(count) {
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
      const r = lerp(8, 18, Math.random());
      const theta = Math.random() * TWO_PI;
      const phi = Math.acos(lerp(-1, 1, Math.random()));

      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      const c = Math.random() < 0.18
        ? new THREE.Color("#b7d6ff")
        : Math.random() < 0.12
          ? new THREE.Color("#ffe7c0")
          : new THREE.Color("#dbe7ff");

      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;

      sizes[i] = lerp(0.35, 1.45, Math.random());
    }

    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geom.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

    const mat = new THREE.PointsMaterial({
      size: 0.03,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.82,
      vertexColors: true,
      depthWrite: false
    });

    return new THREE.Points(geom, mat);
  }

  _createTransitChord() {
    const points = [
      new THREE.Vector3(-3.3, 0, 0),
      new THREE.Vector3(3.3, 0, 0)
    ];
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({
      color: 0xe3d0ae,
      transparent: true,
      opacity: 0.18
    });
    return new THREE.Line(geom, mat);
  }

  _rebuildQualitySensitiveAssets() {
    const currentState = { ...this._currentState };
    const currentMeta = { ...this._targetMeta };

    /* Remove old scene graph pieces */
    if (this.root) this.scene.remove(this.root);
    if (this.starfield) this.scene.remove(this.starfield);

    this._buildSceneGraph();
    this._targetMeta = currentMeta;
    this._currentState = currentState;
    this._applyTargetAppearance();
    this._applyStateToScene(true);
    this.resize();
  }

  _bindResize() {
    this._boundResize = this.resize.bind(this);
    window.addEventListener("resize", this._boundResize);
  }

  /* -----------------------------------------------------------------------
     State ingestion
  ----------------------------------------------------------------------- */

  _ingestState(state) {
    if (!state || typeof state !== "object") return;

    const merged = { ...this._currentState };

    const teff = safeNumber(
      state.st_teff ?? state.teff ?? state.starTeff ?? state.hostTeff,
      merged.st_teff
    );

    const orbitalPhase = safeNumber(
      state.orbitalPhase ??
      state.phase ??
      state.transitPhase ??
      state.modelPhase ??
      state.livePhase,
      merged.orbitalPhase
    );

    merged.visualQuality = this._normaliseQuality(
      state.visualQuality ?? state.quality ?? merged.visualQuality
    );
    merged.theme = state.theme ?? merged.theme;
    merged.st_teff = teff;
    merged.orbitalPhase = orbitalPhase;
    merged.modelPhase = safeNumber(state.modelPhase ?? orbitalPhase, orbitalPhase);
    merged.phaseShift = safeNumber(state.phaseShift ?? merged.phaseShift, merged.phaseShift);

    merged.pl_ratror = safeNumber(
      state.pl_ratror ??
      state.radiusRatio ??
      state.rpRs ??
      state.planetRadiusRatio,
      merged.pl_ratror
    );

    merged.aRs = safeNumber(
      state.aRs ??
      state.a_over_rs ??
      state.scaledDistance ??
      state.scaledSemiMajorAxis,
      merged.aRs
    );

    merged.inclination = safeNumber(
      state.inclination ?? state.pl_orbincl ?? merged.inclination,
      merged.inclination
    );

    merged.eccentricity = safeNumber(
      state.eccentricity ?? state.pl_orbeccen ?? state.catalogueEccentricity ?? merged.eccentricity,
      merged.eccentricity
    );

    merged.starspotEnabled = inferBoolean(
      state.starspotEnabled,
      state.enableStarspot,
      state.spotEnabled,
      merged.starspotEnabled
    );
    merged.spotX = normaliseSpotCoordinate(state.spotX ?? state.spotx ?? merged.spotX);
    merged.spotY = normaliseSpotCoordinate(state.spotY ?? state.spoty ?? merged.spotY);
    merged.spotRadius = clamp(safeNumber(state.spotRadius ?? merged.spotRadius, merged.spotRadius), 0.03, 0.40);
    merged.spotContrast = clamp(safeNumber(state.spotContrast ?? merged.spotContrast, merged.spotContrast), 0.05, 1.00);

    merged.exomoonEnabled = inferBoolean(
      state.exomoonEnabled,
      state.enableExomoon,
      state.moonEnabled,
      merged.exomoonEnabled
    );
    merged.moonRadius = clamp(safeNumber(state.moonRadius ?? merged.moonRadius, merged.moonRadius), 0.008, 0.12);
    merged.moonDistance = clamp(safeNumber(state.moonDistance ?? merged.moonDistance, merged.moonDistance), 0.18, 3.0);
    merged.moonPhaseDeg = safeNumber(state.moonPhaseDeg ?? state.moonPhase ?? merged.moonPhaseDeg, merged.moonPhaseDeg);

    this._currentState = merged;

    if (merged.visualQuality !== this.quality) {
      this.setQuality(merged.visualQuality);
    }
    if (merged.theme !== this.theme) {
      this.setTheme(merged.theme);
    }
  }

  /* -----------------------------------------------------------------------
     Appearance tied to target physics
  ----------------------------------------------------------------------- */

  _applyTargetAppearance() {
    const teff = safeNumber(this._currentState.st_teff ?? this._targetMeta.st_teff, 5778);
    const baseColor = approxKelvinToRGB(teff);
    const spectral = spectralClassFromTeff(teff);
    const preset = QUALITY_PRESETS[this.quality];

    /* More restrained brightness so Ultra is rich, not washed out */
    const starColor = new THREE.Color(baseColor).lerp(new THREE.Color("#fff7e2"), (spectral === "A" || spectral === "B") ? 0.30 : 0.06);
    const emissiveColor = new THREE.Color(baseColor).lerp(new THREE.Color("#ffd488"), 0.12);

    const textureSize = preset.textureSize;
    const freshStarTexture = textureFromCanvas(createStarTexture(textureSize, teff));
    const freshBumpTexture = textureFromCanvas(createStarBumpTexture(textureSize));

    if (this.starMaterial.map) this.starMaterial.map.dispose();
    if (this.starMaterial.bumpMap) this.starMaterial.bumpMap.dispose();
    if (this.starMaterial.emissiveMap) this.starMaterial.emissiveMap.dispose();

    this.starTexture = freshStarTexture;
    this.starBumpTexture = freshBumpTexture;

    this.starMaterial.color.copy(starColor);
    this.starMaterial.map = this.starTexture;
    this.starMaterial.emissive.copy(emissiveColor.multiplyScalar(0.26));
    this.starMaterial.emissiveMap = this.starTexture;
    this.starMaterial.emissiveIntensity = this.quality === "ultra" ? 0.70 : this.quality === "high" ? 0.62 : 0.56;
    this.starMaterial.bumpMap = this.starBumpTexture;
    this.starMaterial.bumpScale = preset.bumpScale;
    this.starMaterial.needsUpdate = true;

    this.innerCorona.material.color.copy(new THREE.Color(starColor).multiplyScalar(0.92));
    this.innerCorona.material.opacity = preset.glowOpacity * 0.34;
    this.outerCorona.material.color.copy(new THREE.Color(starColor).multiplyScalar(0.80));
    this.outerCorona.material.opacity = preset.glowOpacity * 0.22;
    this.outerCorona.scale.setScalar(preset.coronaScale);

    this.keyLight.color.copy(new THREE.Color(starColor).lerp(new THREE.Color("#fff4da"), 0.20));
    this.keyLight.intensity = QUALITY_PRESETS[this.quality].pointLightIntensity;

    /* Spot material darker if star is hotter/brighter */
    const spotOpacity = clamp(0.34 + this._currentState.spotContrast * 0.38, 0.20, 0.82);
    this.spotMaterial.opacity = spotOpacity;

    /* Planet / moon kept cooler for contrast */
    this.planetAtmosphere.material.color.set("#5fd6ff");
    this.moonAtmosphere.material.color.set("#f6c78a");
  }

  /* -----------------------------------------------------------------------
     Core scene update
  ----------------------------------------------------------------------- */

  _applyStateToScene(force = false) {
    const s = this._currentState;
    const planetRadius = STAR_RADIUS * clamp(s.pl_ratror, 0.015, 0.35);
    const moonRadius = STAR_RADIUS * clamp(s.moonRadius, 0.004, 0.15);

    this.planetMesh.scale.setScalar(planetRadius / PLANET_BASE_RADIUS);
    this.planetAtmosphere.scale.setScalar((planetRadius * 1.038) / PLANET_BASE_RADIUS);
    this.moonMesh.scale.setScalar(moonRadius / MOON_BASE_RADIUS);
    this.moonAtmosphere.scale.setScalar((moonRadius * 1.03) / MOON_BASE_RADIUS);

    const phase = safeNumber(s.orbitalPhase, 0) + safeNumber(s.phaseShift, 0);
    this._lastRenderPhase = phase;

    const theta = phase * TWO_PI;

    /* Full orbit with transit at theta ~ 0 */
    const orbitX = 2.55 + clamp((s.aRs - 5.0) * 0.06, 0, 1.15);
    const orbitZ = 1.25 + clamp((s.aRs - 5.0) * 0.04, 0, 0.95);

    const inclinationRad = degToRad(clamp(s.inclination, 80, 90));
    const impactY = Math.cos(inclinationRad) * clamp(s.aRs * 0.12, 0, 1.35);

    const planetX = Math.sin(theta) * orbitX;
    const planetZ = Math.cos(theta) * orbitZ;
    const planetY = impactY;

    this.planetMesh.position.set(planetX, planetY, planetZ);
    this.planetAtmosphere.position.copy(this.planetMesh.position);

    const projectedPlanetDist = Math.sqrt(planetX * planetX + planetY * planetY);
    const planetOnDisk = projectedPlanetDist <= STAR_RADIUS * 1.02;
    const planetInFront = planetZ > 0;

    /* Planet appearance:
       - in front of star and on disk => dark silhouette
       - elsewhere => visible shaded exoplanet
    */
    if (planetOnDisk && planetInFront) {
      this.planetMaterial.color.set("#07141f");
      this.planetMaterial.emissive = new THREE.Color("#000000");
      this.planetMaterial.roughness = 1.0;
      this.planetMaterial.metalness = 0.0;
      this.planetMaterial.opacity = 1.0;
      this.planetMaterial.transparent = false;
      this.planetAtmosphere.material.opacity = 0.08;
    } else {
      this.planetMaterial.color.set("#4f9dc0");
      this.planetMaterial.roughness = 0.86;
      this.planetMaterial.metalness = 0.02;
      this.planetAtmosphere.material.opacity = projectedPlanetDist < STAR_RADIUS * 1.2 ? 0.10 : 0.15;
    }
    this.planetMaterial.needsUpdate = true;
    this.planetAtmosphere.material.needsUpdate = true;

    /* Slower, cleaner moon motion */
    const moonEnabled = !!s.exomoonEnabled;
    const moonAngle = degToRad(s.moonPhaseDeg) + theta * 0.65 + this._clock.getElapsedTime() * 0.12;
    const moonOrbitRadius = planetRadius + STAR_RADIUS * clamp(s.moonDistance, 0.18, 3.0) * 0.17;
    const moonLocalX = Math.cos(moonAngle) * moonOrbitRadius;
    const moonLocalY = Math.sin(moonAngle) * moonOrbitRadius * 0.58;
    const moonLocalZ = Math.sin(moonAngle + Math.PI * 0.25) * moonOrbitRadius * 0.16;

    this.moonMesh.visible = moonEnabled;
    this.moonAtmosphere.visible = moonEnabled;

    if (moonEnabled) {
      this.moonMesh.position.set(planetX + moonLocalX, planetY + moonLocalY, planetZ + moonLocalZ);
      this.moonAtmosphere.position.copy(this.moonMesh.position);

      const mx = this.moonMesh.position.x;
      const my = this.moonMesh.position.y;
      const mz = this.moonMesh.position.z;
      const moonProjectedDist = Math.sqrt(mx * mx + my * my);
      const moonOnDisk = moonProjectedDist <= STAR_RADIUS * 1.015;
      const moonInFront = mz > 0;

      if (moonOnDisk && moonInFront) {
        this.moonMaterial.color.set("#2b231d");
        this.moonMaterial.roughness = 1.0;
        this.moonAtmosphere.material.opacity = 0.045;
      } else {
        this.moonMaterial.color.set("#b3936b");
        this.moonMaterial.roughness = 0.95;
        this.moonAtmosphere.material.opacity = 0.08;
      }
      this.moonMaterial.needsUpdate = true;
      this.moonAtmosphere.material.needsUpdate = true;
    }

    /* Spot visibility */
    this._updateSpotVisual();

    /* Draw order so silhouettes render correctly in front of star */
    this.starMesh.renderOrder = 1;
    this.innerCorona.renderOrder = 0;
    this.outerCorona.renderOrder = 0;
    this.planetMesh.renderOrder = planetInFront ? 4 : 0;
    this.planetAtmosphere.renderOrder = planetInFront ? 5 : 1;
    this.moonMesh.renderOrder = moonEnabled ? 6 : 0;
    this.moonAtmosphere.renderOrder = moonEnabled ? 7 : 0;

    if (force) {
      this.resize();
    }
  }

  _updateSpotVisual() {
    const s = this._currentState;
    if (!s.starspotEnabled) {
      this.spotMesh.visible = false;
      return;
    }

    const x = normaliseSpotCoordinate(s.spotX);
    const y = normaliseSpotCoordinate(s.spotY);
    const r2 = x * x + y * y;

    if (r2 >= 0.96) {
      this.spotMesh.visible = false;
      return;
    }

    const z = Math.sqrt(Math.max(0, 1 - r2));
    const normal = new THREE.Vector3(x, y, z).normalize();

    this.spotMesh.visible = true;
    this.spotMesh.position.copy(normal.clone().multiplyScalar(STAR_RADIUS * 1.003));
    this.spotMesh.scale.setScalar(clamp(s.spotRadius, 0.03, 0.4) * STAR_RADIUS * 1.65);

    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      normal
    );
    this.spotMesh.quaternion.copy(q);

    const opacity = clamp(0.24 + s.spotContrast * 0.48, 0.18, 0.84);
    this.spotMaterial.opacity = opacity;
    this.spotMaterial.needsUpdate = true;
  }

  /* -----------------------------------------------------------------------
     Animation
  ----------------------------------------------------------------------- */

  _animate() {
    if (this._destroyed) return;

    const delta = this._clock.getDelta();
    const elapsed = this._clock.getElapsedTime();
    const preset = QUALITY_PRESETS[this.quality];

    /* Slow star rotation to stop it feeling like a 2D texture */
    this.starMesh.rotation.y += delta * preset.starRotationSpeed;
    this.starMesh.rotation.z = Math.sin(elapsed * 0.09) * 0.02;

    /* Texture drift: subtle photospheric evolution */
    if (this.starTexture) {
      this.starTexture.offset.x = (this.starTexture.offset.x + delta * preset.textureDrift) % 1;
      this.starTexture.offset.y = (this.starTexture.offset.y + delta * preset.textureDrift * 0.35) % 1;
    }
    if (this.starBumpTexture) {
      this.starBumpTexture.offset.x = (this.starBumpTexture.offset.x + delta * preset.textureDrift * 0.7) % 1;
      this.starBumpTexture.offset.y = (this.starBumpTexture.offset.y + delta * preset.textureDrift * 0.22) % 1;
    }

    /* Corona breathing */
    const pulse = 1 + Math.sin(elapsed * 0.8) * 0.006 + Math.sin(elapsed * 1.9) * 0.003;
    this.innerCorona.scale.setScalar(pulse);
    this.outerCorona.scale.setScalar(preset.coronaScale * (1 + Math.sin(elapsed * 0.54) * 0.014));

    /* If the main app stops sending phase updates, keep a gentle idle revolution */
    const statePhase = safeNumber(this._currentState.orbitalPhase, 0);
    if (!Number.isFinite(statePhase) || Math.abs(statePhase - this._idlePhase) < 1e-8) {
      this._idlePhase += delta * 0.018;
      if (this._idlePhase > 1) this._idlePhase -= 1;
      this._currentState.orbitalPhase = this._idlePhase;
      this._applyStateToScene(false);
    } else {
      this._idlePhase = statePhase;
    }

    this.renderer.render(this.scene, this.camera);
    this._rafId = requestAnimationFrame(this._animate.bind(this));
  }
}

/* ---------------------------------------------------------------------------
   Named + default export
--------------------------------------------------------------------------- */

export { ExoSceneRenderer };
export default ExoSceneRenderer;
