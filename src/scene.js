/* ============================================================================
   ExoIntel-Prime
   src/scene.js
   ---------------------------------------------------------------------------
   Ultra-realistic WebGL scene renderer for the ExoLight Transit Lab.

   This version is intentionally heavier than the recovery Canvas renderer:
   - true WebGL sphere rendering
   - procedural GLSL stellar granulation
   - animated rotating photosphere
   - temperature-based stellar colour
   - subtle non-flat coronal atmosphere / glow shell
   - shaded planet and moon spheres
   - no cartoon orbit rings or dotted moon guides
   - stable public API for the current src/app.js
   ============================================================================ */

const TWO_PI = Math.PI * 2;

const STAR_VERTEX_SHADER = `
attribute vec3 aPosition;
attribute vec3 aNormal;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;
uniform mat3 uNormalMatrix;

varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vViewNormal;

void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(uNormalMatrix * aNormal);
  vViewNormal = normalize((uView * vec4(vNormal, 0.0)).xyz);
  gl_Position = uProjection * uView * world;
}
`;

const STAR_FRAGMENT_SHADER = `
precision highp float;

varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vViewNormal;

uniform float uTime;
uniform float uU1;
uniform float uU2;
uniform float uTeff;
uniform float uSpotEnabled;
uniform vec3 uSpotCentre;
uniform float uSpotRadius;
uniform float uSpotContrast;
uniform vec3 uBaseColour;
uniform vec3 uHotColour;
uniform vec3 uCoolColour;
uniform float uQuality;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1031, 0.11369, 0.13787));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);

  float n000 = hash(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash(i + vec3(1.0, 1.0, 1.0));

  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  float nxy0 = mix(nx00, nx10, f.y);
  float nxy1 = mix(nx01, nx11, f.y);

  return mix(nxy0, nxy1, f.z);
}

float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.56;
  for (int i = 0; i < 7; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec3(4.17, 8.31, 2.73);
    a *= 0.49;
  }
  return v;
}

vec3 rotateY(vec3 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

float spotMask(vec3 n, vec3 centre, float radius, float contrast) {
  vec3 c = normalize(centre);
  float d = length(n - c);
  float edgeNoise = fbm(n * 70.0 + vec3(2.1, 5.3, 7.4));
  float smallNoise = fbm(n * 155.0 + vec3(9.3, 1.4, 5.6));
  float ragged = radius * (0.76 + 0.30 * edgeNoise + 0.12 * smallNoise);
  float penumbra = 1.0 - smoothstep(ragged, ragged + radius * 0.50, d);
  float umbra = 1.0 - smoothstep(ragged * 0.30, ragged * 0.30 + radius * 0.18, d);
  float pores = smoothstep(0.62, 0.92, fbm(n * 210.0 + vec3(4.7, 8.8, 2.2)));
  return clamp((0.42 * penumbra + 0.72 * umbra + 0.08 * pores * penumbra) * contrast, 0.0, 0.96);
}

void main() {
  vec3 n = normalize(vNormal);

  // Use the actual spherical normal as a moving photospheric coordinate.
  // Ultra quality exaggerates fine scales and time evolution for a solar-video feel.
  float qLevel = clamp(uQuality, 0.0, 1.80);
  vec3 rSlow = rotateY(n, uTime * (0.090 + 0.035 * qLevel));
  vec3 rMid  = rotateY(n, -uTime * (0.145 + 0.050 * qLevel));
  vec3 rFast = rotateY(n, uTime * (0.260 + 0.080 * qLevel));

  // Limb darkening in view space; this makes the disk read as a sphere.
  float mu = clamp(vViewNormal.z * 0.5 + 0.5, 0.0, 1.0);
  float oneMinusMu = 1.0 - mu;
  float limb = clamp(1.0 - uU1 * oneMinusMu - uU2 * oneMinusMu * oneMinusMu, 0.03, 1.24);

  // Solar-style nested cellular texture: broad convection, fine granules, and dark lanes.
  float globalFlow = fbm(rSlow * 2.8 + vec3(uTime * 0.018, -uTime * 0.011, uTime * 0.014));
  float superGran = fbm(rSlow * 6.5 + vec3(-uTime * 0.035, uTime * 0.022, -uTime * 0.018));
  float granA = fbm(rMid * 24.0 + vec3(uTime * 0.125, -uTime * 0.082, uTime * 0.055));
  float granB = fbm(rFast * 62.0 + vec3(-uTime * 0.260, uTime * 0.190, -uTime * 0.140));
  float granC = fbm(rFast * 138.0 + vec3(uTime * 0.420, -uTime * 0.310, uTime * 0.220));

  float cells = 0.22 * globalFlow + 0.24 * superGran + 0.30 * granA + 0.17 * granB + 0.07 * granC;
  float brightCell = smoothstep(0.54, 0.76, cells);
  float hotKernel = smoothstep(0.67, 0.90, cells);
  float darkLane = smoothstep(0.34, 0.64, 1.0 - cells);
  float filigree = (granC - 0.5) * 2.35;

  float tempFactor = clamp((uTeff - 3200.0) / 6200.0, 0.0, 1.0);
  float granulationContrast = mix(0.34, 0.18, tempFactor) * mix(0.75, 2.05, qLevel);

  float textureTerm =
    1.0
    + granulationContrast * (0.78 * brightCell + 0.34 * hotKernel - 0.85 * darkLane)
    + granulationContrast * 0.16 * filigree;

  // Self-luminous volume. Directional term is subtle; the star must not look like a planet lit by a lamp.
  vec3 virtualViewLight = normalize(vec3(-0.35, 0.18, 0.92));
  float volume = 0.86 + 0.14 * max(dot(n, virtualViewLight), 0.0);
  float centre = 0.90 + 0.23 * pow(mu, 0.55);

  vec3 photosphere = mix(uCoolColour, uBaseColour, limb);
  photosphere = mix(photosphere, uHotColour, 0.28 * brightCell + 0.20 * hotKernel + 0.16 * pow(mu, 1.4));

  vec3 colour = photosphere * limb * textureTerm * volume * centre;

  // Chromatic limb: darker and slightly redder at the edge, like an optically thick stellar disk.
  vec3 chromaLimb = mix(uBaseColour, vec3(1.00, 0.26, 0.055), 0.36);
  colour = mix(colour, chromaLimb * 0.58, pow(oneMinusMu, 1.35) * 0.42);

  // Faculae close to the limb and small bright magnetic fragments.
  float facula = smoothstep(0.60, 0.90, fbm(rFast * 96.0 + vec3(7.1, uTime * 0.38, 3.2)));
  colour += uHotColour * facula * pow(oneMinusMu, 1.15) * 0.045 * qLevel;

  if (uSpotEnabled > 0.5) {
    float s = spotMask(n, uSpotCentre, uSpotRadius, uSpotContrast);
    vec3 penumbraColour = vec3(0.34, 0.17, 0.075);
    vec3 umbraColour = vec3(0.055, 0.030, 0.018);
    colour = mix(colour, penumbraColour * limb, s * 0.72);
    colour = mix(colour, umbraColour, smoothstep(0.55, 0.95, s) * 0.86);
  }

  // Mild filmic compression: brighter, hotter, less muddy than the recovery renderer.
  colour = max(colour, vec3(0.0));
  colour = colour / (colour + vec3(0.30));
  colour *= 1.68;

  gl_FragColor = vec4(colour, 1.0);
}
`;

const GLOW_FRAGMENT_SHADER = `
precision highp float;

varying vec3 vViewNormal;

uniform vec3 uGlowColour;
uniform float uTime;
uniform float uStrength;

void main() {
  float mu = clamp(vViewNormal.z * 0.5 + 0.5, 0.0, 1.0);
  float edge = 1.0 - mu;

  // No flat circular disk: emission is concentrated around the limb/corona.
  float innerSuppression = smoothstep(0.10, 0.74, edge);
  float corona = pow(edge, 2.0) * innerSuppression;
  float outer = pow(edge, 5.0);
  float pulse = 0.96 + 0.04 * sin(uTime * 0.45);

  vec3 colour = uGlowColour * (0.58 * corona + 1.10 * outer) * uStrength * pulse;
  float alpha = clamp((0.055 * corona + 0.24 * outer) * uStrength, 0.0, 0.38);
  gl_FragColor = vec4(colour, alpha);
}
`;

const BODY_FRAGMENT_SHADER = `
precision highp float;

varying vec3 vNormal;
varying vec3 vViewNormal;

uniform vec3 uBaseColour;
uniform vec3 uRimColour;
uniform vec3 uLightDir;
uniform float uAtmosphere;
uniform float uBanding;
uniform float uTime;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1031, 0.11369, 0.13787));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash(i + vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 light = normalize(uLightDir);
  float lambert = max(dot(n, light), 0.0);
  float night = 1.0 - lambert;
  float mu = clamp(vViewNormal.z * 0.5 + 0.5, 0.0, 1.0);
  float rim = pow(1.0 - mu, 2.0);

  float bands = sin((n.y * 12.0 + noise(n * 10.0 + vec3(uTime * 0.08)) * 0.75) * 3.14159);
  float bandTerm = 1.0 + uBanding * bands * 0.08;
  vec3 day = uBaseColour * (0.18 + 1.02 * lambert) * bandTerm;
  vec3 nightColour = vec3(0.004, 0.010, 0.018) * (0.82 + 0.18 * mu);
  vec3 colour = mix(day, nightColour, night * 0.72);
  colour += uRimColour * rim * (0.26 + 0.30 * uAtmosphere);
  gl_FragColor = vec4(colour, 1.0);
}
`;

const STARFIELD_VERTEX_SHADER = `
attribute vec3 aPosition;
attribute float aSize;
attribute float aAlpha;

uniform mat4 uView;
uniform mat4 uProjection;
uniform float uPixelRatio;
uniform float uTime;

varying float vAlpha;

void main() {
  vec3 p = aPosition;
  p.x += sin(uTime * 0.012 + aPosition.z * 0.35) * 0.008;
  p.y += cos(uTime * 0.010 + aPosition.x * 0.29) * 0.006;
  vAlpha = aAlpha;
  gl_Position = uProjection * uView * vec4(p, 1.0);
  gl_PointSize = aSize * uPixelRatio;
}
`;

const STARFIELD_FRAGMENT_SHADER = `
precision highp float;
varying float vAlpha;
void main() {
  vec2 p = gl_PointCoord - vec2(0.5);
  float d = length(p);
  float a = smoothstep(0.5, 0.0, d) * vAlpha;
  gl_FragColor = vec4(0.74, 0.86, 1.0, a);
}
`;

const LINE_VERTEX_SHADER = `
attribute vec3 aPosition;
uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;
void main() {
  gl_Position = uProjection * uView * uModel * vec4(aPosition, 1.0);
}
`;

const LINE_FRAGMENT_SHADER = `
precision highp float;
uniform vec3 uColour;
uniform float uAlpha;
void main() {
  gl_FragColor = vec4(uColour, uAlpha);
}
`;

export class ExoSceneRenderer {
  constructor({ container, onStatus = () => {}, onWarning = () => {} } = {}) {
    this.container = container;
    this.onStatus = onStatus;
    this.onWarning = onWarning;
    this.canvas = null;
    this.gl = null;
    this.ready = false;
    this.frameHandle = null;
    this.lastFrame = 0;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2.0);

    this.params = {
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
      visualQuality: "balanced"
    };

    this.target = {
      pl_name: "Synthetic Hot Jupiter",
      hostname: "Demonstration Host",
      st_teff: 5772
    };

    this.model = { phase: new Float32Array(0), flux: new Float32Array(0), revision: 0 };
    this.orbitPhase = 0;
    this.quality = "balanced";
    this.programs = {};
    this.meshes = {};
    this.view = mat4Identity();
    this.projection = mat4Identity();
    this.camera = { eye: [0, 0, 6.2], target: [0, 0, 0], up: [0, 1, 0], fov: degToRad(36), near: 0.01, far: 100 };
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
    this.canvas.setAttribute("aria-label", "High-fidelity WebGL star and exoplanet scene");
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.display = "block";
    this.container.appendChild(this.canvas);

    this.initWebGL();
  }

  initWebGL() {
    const gl = this.canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      depth: true,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: "high-performance"
    });

    if (!gl) {
      this.ready = false;
      this.onWarning("WebGL unavailable. The scene could not be rendered.");
      return;
    }

    this.gl = gl;

    try {
      this.programs.star = createProgram(gl, STAR_VERTEX_SHADER, STAR_FRAGMENT_SHADER);
      this.programs.glow = createProgram(gl, STAR_VERTEX_SHADER, GLOW_FRAGMENT_SHADER);
      this.programs.body = createProgram(gl, STAR_VERTEX_SHADER, BODY_FRAGMENT_SHADER);
      this.programs.starfield = createProgram(gl, STARFIELD_VERTEX_SHADER, STARFIELD_FRAGMENT_SHADER);
      this.programs.line = createProgram(gl, LINE_VERTEX_SHADER, LINE_FRAGMENT_SHADER);
    } catch (error) {
      this.ready = false;
      this.onWarning(`WebGL shader failed: ${error.message}`);
      return;
    }

    this.rebuildMeshes();

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0, 0, 0, 0);

    window.addEventListener("resize", () => this.resize(), { passive: true });
    this.resize();
    this.ready = true;
    this.onStatus("Ultra WebGL photosphere online");
    this.frameHandle = requestAnimationFrame(time => this.loop(time));
  }

  qualitySettings() {
    if (this.quality === "ultra") {
      return { sphereSegments: 260, sphereRings: 148, starCount: 1650, quality: 1.72, glow: 1.62 };
    }
    if (this.quality === "high") {
      return { sphereSegments: 184, sphereRings: 106, starCount: 980, quality: 1.12, glow: 1.22 };
    }
    if (this.quality === "low") {
      return { sphereSegments: 72, sphereRings: 42, starCount: 260, quality: 0.42, glow: 0.72 };
    }
    return { sphereSegments: 118, sphereRings: 70, starCount: 520, quality: 0.72, glow: 0.92 };
  }

  rebuildMeshes() {
    const gl = this.gl;
    const q = this.qualitySettings();
    this.meshes.sphere = createSphereMesh(gl, q.sphereSegments, q.sphereRings);
    this.meshes.glowSphere = createSphereMesh(gl, Math.max(48, Math.floor(q.sphereSegments * 0.75)), Math.max(28, Math.floor(q.sphereRings * 0.75)));
    this.meshes.starfield = createStarfieldMesh(gl, q.starCount);
    this.meshes.chord = createLineMesh(gl, [-2.55, 0.0, 0.05, 2.55, 0.0, 0.05]);
  }

  dispose() {
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
    this.ready = false;
  }

  updateState({ params = null, target = null, model = null } = {}) {
    if (params) {
      const nextQuality = String(params.visualQuality || this.params.visualQuality || "balanced").toLowerCase();
      this.params = { ...this.params, ...params, visualQuality: nextQuality };
      if (nextQuality !== this.quality) {
        this.quality = nextQuality;
        if (this.gl) this.rebuildMeshes();
      }
    }
    if (target) this.target = { ...this.target, ...target };
    if (model?.phase?.length && model?.flux?.length) this.model = model;
  }

  resize() {
    if (!this.canvas || !this.gl) return;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(2, Math.floor(rect.width * this.pixelRatio));
    const height = Math.max(2, Math.floor(rect.height * this.pixelRatio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.gl.viewport(0, 0, width, height);
    this.view = mat4LookAt(this.camera.eye, this.camera.target, this.camera.up);
    this.projection = mat4Perspective(this.camera.fov, width / Math.max(1, height), this.camera.near, this.camera.far);
  }

  loop(time) {
    if (!this.ready) return;
    const dt = Math.min(0.05, Math.max(0, (time - this.lastFrame) / 1000 || 0));
    this.lastFrame = time;

    // Full orbit is visible but not frantic. The moon has its own relative motion.
    const orbitSpeed = this.quality === "ultra" ? 0.035 : 0.026;
    this.orbitPhase = wrap01(this.orbitPhase + dt * orbitSpeed);

    this.render(time * 0.001);
    this.frameHandle = requestAnimationFrame(next => this.loop(next));
  }

  render(time) {
    const gl = this.gl;
    if (!gl) return;

    this.resize();
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const q = this.qualitySettings();
    const teff = numberOr(this.target.st_teff, 5772);
    const colours = stellarColours(teff);
    const geom = this.computeGeometry(time);

    this.drawStarfield(time);
    this.drawTransitChord();

    if (!geom.planet.front) this.drawPlanet(geom.planet, time);
    if (geom.moon.enabled && !geom.moon.front) this.drawMoon(geom.moon, time);

    this.drawStar(time, teff, colours, q);
    this.drawGlow(time, colours.glow, q);

    if (geom.planet.front) this.drawPlanet(geom.planet, time);
    if (geom.moon.enabled && geom.moon.front) this.drawMoon(geom.moon, time);
  }

  computeGeometry(time) {
    const p = this.params;
    const projected = projectedVisualGeometry(this.orbitPhase, p, time);
    const starScale = this.quality === "ultra" ? 1.58 : 1.52;
    const planetRadius = clamp(numberOr(p.rpRs, 0.1) * starScale, 0.025, 0.42);
    const moonRadius = clamp(numberOr(p.moonRadius, 0.025) * starScale, 0.012, 0.16);

    return {
      planet: {
        position: [projected.planet.x, projected.planet.y, projected.planet.z],
        radius: planetRadius,
        front: projected.planet.front
      },
      moon: {
        enabled: Boolean(p.moonEnabled),
        position: [projected.moon.x, projected.moon.y, projected.moon.z],
        radius: moonRadius,
        front: projected.moon.front
      }
    };
  }

  drawStarfield(time) {
    const gl = this.gl;
    const loc = useProgram(gl, this.programs.starfield);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshes.starfield.position);
    enableAttrib(gl, loc.aPosition, 3);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshes.starfield.size);
    enableAttrib(gl, loc.aSize, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshes.starfield.alpha);
    enableAttrib(gl, loc.aAlpha, 1);

    setMat4(gl, loc.uView, this.view);
    setMat4(gl, loc.uProjection, this.projection);
    setUniform(gl, loc.uPixelRatio, this.pixelRatio);
    setUniform(gl, loc.uTime, time);
    gl.drawArrays(gl.POINTS, 0, this.meshes.starfield.vertexCount);

    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  drawTransitChord() {
    // Not an orbit ring: just a very subtle line-of-sight transit chord.
    const gl = this.gl;
    const loc = useProgram(gl, this.programs.line);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshes.chord.position);
    enableAttrib(gl, loc.aPosition, 3);
    setMat4(gl, loc.uModel, mat4Identity());
    setMat4(gl, loc.uView, this.view);
    setMat4(gl, loc.uProjection, this.projection);
    setUniform(gl, loc.uColour, [0.95, 0.66, 0.30]);
    setUniform(gl, loc.uAlpha, this.quality === "ultra" ? 0.0 : 0.018);
    gl.drawArrays(gl.LINES, 0, this.meshes.chord.vertexCount);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  drawStar(time, teff, colours, q) {
    const p = this.params;
    const gl = this.gl;
    const spot = spotCentreFromProjected(p.spotX, p.spotY);
    const model = mat4Scale(mat4RotateY(mat4Identity(), time * (this.quality === "ultra" ? 0.070 : 0.035)), [this.quality === "ultra" ? 1.58 : 1.50, this.quality === "ultra" ? 1.58 : 1.50, this.quality === "ultra" ? 1.58 : 1.50]);

    this.drawSphere({
      program: this.programs.star,
      mesh: this.meshes.sphere,
      model,
      uniforms: {
        uTime: time,
        uU1: numberOr(p.u1, 0.32),
        uU2: numberOr(p.u2, 0.28),
        uTeff: teff,
        uSpotEnabled: p.spotEnabled ? 1 : 0,
        uSpotCentre: spot,
        uSpotRadius: clamp(numberOr(p.spotRadius, 0.12), 0.02, 0.45),
        uSpotContrast: clamp(numberOr(p.spotContrast, 0.55), 0, 0.98),
        uBaseColour: colours.base,
        uHotColour: colours.hot,
        uCoolColour: colours.cool,
        uQuality: q.quality
      }
    });
    gl.disable(gl.BLEND);
  }

  drawGlow(time, glowColour, q) {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);

    this.drawSphere({
      program: this.programs.glow,
      mesh: this.meshes.glowSphere,
      model: mat4Scale(mat4Identity(), [this.quality === "ultra" ? 1.92 : 1.76, this.quality === "ultra" ? 1.92 : 1.76, this.quality === "ultra" ? 1.92 : 1.76]),
      uniforms: {
        uGlowColour: glowColour,
        uTime: time,
        uStrength: q.glow
      }
    });

    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  drawPlanet(body, time) {
    const light = normalise3([-body.position[0], -body.position[1], -body.position[2]]);
    const model = mat4Scale(mat4Translate(mat4Identity(), body.position), [body.radius, body.radius, body.radius]);
    this.drawSphere({
      program: this.programs.body,
      mesh: this.meshes.sphere,
      model,
      uniforms: {
        uBaseColour: [0.035, 0.150, 0.190],
        uRimColour: [0.26, 0.86, 1.00],
        uLightDir: light,
        uAtmosphere: 1.0,
        uBanding: 0.78,
        uTime: time
      }
    });
  }

  drawMoon(body, time) {
    const light = normalise3([-body.position[0], -body.position[1], -body.position[2]]);
    const model = mat4Scale(mat4Translate(mat4Identity(), body.position), [body.radius, body.radius, body.radius]);
    this.drawSphere({
      program: this.programs.body,
      mesh: this.meshes.sphere,
      model,
      uniforms: {
        uBaseColour: [0.54, 0.49, 0.40],
        uRimColour: [0.88, 0.82, 0.68],
        uLightDir: light,
        uAtmosphere: 0.0,
        uBanding: 0.18,
        uTime: time
      }
    });
  }

  drawSphere({ program, mesh, model, uniforms = {} }) {
    const gl = this.gl;
    const loc = useProgram(gl, program);
    bindMesh(gl, mesh, loc);
    setMat4(gl, loc.uModel, model);
    setMat4(gl, loc.uView, this.view);
    setMat4(gl, loc.uProjection, this.projection);
    setMat3(gl, loc.uNormalMatrix, normalMatrix(model));
    for (const [key, value] of Object.entries(uniforms)) setUniform(gl, loc[key], value);
    gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_SHORT, 0);
  }
}

function projectedVisualGeometry(phase01, params, time) {
  const p = params || {};
  const aRs = clamp(numberOr(p.aRs, 12), 2, 100);
  const inclination = degToRad(clamp(numberOr(p.inclinationDeg, 88.5), 0, 90));
  const e = clamp(numberOr(p.eccentricity, 0), 0, 0.95);
  const omega = degToRad(normaliseDegrees(numberOr(p.omegaDeg, 90)));
  const phase = wrap01(phase01);
  const visualScale = 2.05;
  const zScale = 0.92;

  let xPhysical;
  let yPhysical;
  let zPhysical;
  let radiusPhysical;

  if (e > 1e-5) {
    const f0 = wrapRadians(Math.PI / 2 - omega);
    const e0 = trueAnomalyToEccentricAnomaly(f0, e);
    const m0 = eccentricAnomalyToMeanAnomaly(e0, e);
    const meanAnomaly = m0 + TWO_PI * phase;
    const eccentricAnomaly = solveKepler(meanAnomaly, e);
    const trueAnomaly = eccentricAnomalyToTrueAnomaly(eccentricAnomaly, e);
    radiusPhysical = aRs * (1 - e * e) / Math.max(1e-8, 1 + e * Math.cos(trueAnomaly));
    const u = omega + trueAnomaly;
    xPhysical = -radiusPhysical * Math.cos(u);
    yPhysical = radiusPhysical * Math.sin(u) * Math.cos(inclination);
    zPhysical = radiusPhysical * Math.sin(u) * Math.sin(inclination);
  } else {
    const theta = TWO_PI * phase;
    radiusPhysical = aRs;
    xPhysical = -aRs * Math.sin(theta);
    yPhysical = aRs * Math.cos(inclination) * Math.cos(theta);
    zPhysical = aRs * Math.sin(inclination) * Math.cos(theta);
  }

  const norm = Math.max(aRs, 1e-6);
  const x = xPhysical / norm * visualScale;
  const y = yPhysical / norm * visualScale * 0.55;
  const z = zPhysical / norm * visualScale * zScale;

  const moonBase = degToRad(normaliseDegrees(numberOr(p.moonPhaseDeg, 45)));
  const moonDistance = clamp(numberOr(p.moonDistance, 0.55), 0.02, 3.0);
  const moonTheta = moonBase + TWO_PI * (phase * 4.8 + time * 0.030);
  const moonScale = 0.18 + 0.11 * moonDistance;
  const moonX = x + moonScale * Math.cos(moonTheta);
  const moonY = y + moonScale * 0.55 * Math.sin(moonTheta);
  const moonZ = z + moonScale * 0.40 * Math.sin(moonTheta + 0.85);

  return {
    planet: { x, y, z, front: z >= 0 },
    moon: { x: moonX, y: moonY, z: moonZ, front: moonZ >= 0 }
  };
}

function stellarColours(teff) {
  const c = kelvinToRgb01(clamp(numberOr(teff, 5772), 2500, 12000));
  const warm = [1.0, 0.46, 0.13];
  const hot = [1.0, 0.80, 0.42];
  const blueHot = [0.72, 0.84, 1.0];
  const t = clamp((teff - 3600) / 4200, 0, 1);
  const base = mix3(warm, c, 0.58);
  const hotColour = teff > 7200 ? mix3(c, blueHot, 0.35) : mix3(c, hot, 0.40);
  const cool = mul3(base, 0.42);
  const glow = teff > 7200 ? [0.40, 0.62, 1.0] : [1.0, 0.42, 0.10];
  return { base, hot: hotColour, cool, glow };
}

function spotCentreFromProjected(x, y) {
  const sx = clamp(numberOr(x, 0.2), -0.86, 0.86);
  const sy = clamp(numberOr(y, 0.1), -0.86, 0.86);
  const z = Math.sqrt(Math.max(0.03, 1 - sx * sx - sy * sy));
  return normalise3([sx, sy, z]);
}

function kelvinToRgb01(kelvin) {
  const temp = kelvin / 100;
  let r, g, b;
  if (temp <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(temp) - 161.1195681661;
    b = temp <= 19 ? 0 : 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
    b = 255;
  }
  return [clamp(r, 0, 255) / 255, clamp(g, 0, 255) / 255, clamp(b, 0, 255) / 255];
}

function createProgram(gl, vertexSource, fragmentSource) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || "Unknown WebGL link error";
    gl.deleteProgram(program);
    throw new Error(message);
  }
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  program._locations = {};
  program._cached = false;
  return program;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "Unknown WebGL shader error";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function useProgram(gl, program) {
  gl.useProgram(program);
  if (program._cached) return program._locations;
  const loc = program._locations;
  const attributes = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < attributes; i++) {
    const info = gl.getActiveAttrib(program, i);
    loc[info.name] = gl.getAttribLocation(program, info.name);
  }
  const uniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < uniforms; i++) {
    const info = gl.getActiveUniform(program, i);
    loc[info.name] = gl.getUniformLocation(program, info.name);
  }
  program._cached = true;
  return loc;
}

function createSphereMesh(gl, segments, rings) {
  const positions = [];
  const normals = [];
  const indices = [];
  for (let y = 0; y <= rings; y++) {
    const v = y / rings;
    const phi = v * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    for (let x = 0; x <= segments; x++) {
      const u = x / segments;
      const theta = u * TWO_PI;
      const nx = Math.cos(theta) * sinPhi;
      const ny = cosPhi;
      const nz = Math.sin(theta) * sinPhi;
      positions.push(nx, ny, nz);
      normals.push(nx, ny, nz);
    }
  }
  for (let y = 0; y < rings; y++) {
    for (let x = 0; x < segments; x++) {
      const a = y * (segments + 1) + x;
      const b = a + segments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return {
    position: bufferData(gl, gl.ARRAY_BUFFER, new Float32Array(positions)),
    normal: bufferData(gl, gl.ARRAY_BUFFER, new Float32Array(normals)),
    index: bufferData(gl, gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices)),
    indexCount: indices.length
  };
}

function createStarfieldMesh(gl, count) {
  const positions = [];
  const sizes = [];
  const alphas = [];
  for (let i = 0; i < count; i++) {
    const u = seededRandom(i * 13.17 + 1.1);
    const v = seededRandom(i * 19.31 + 3.7);
    const w = seededRandom(i * 29.67 + 5.9);
    const theta = TWO_PI * u;
    const radius = 3.0 + 3.4 * v;
    const y = -2.4 + 4.8 * w;
    positions.push(radius * Math.cos(theta), y, -3.1 - radius * Math.sin(theta) * 0.32);
    sizes.push(0.8 + 2.8 * seededRandom(i * 7.77 + 8.4));
    alphas.push(0.16 + 0.58 * seededRandom(i * 5.45 + 4.2));
  }
  return {
    position: bufferData(gl, gl.ARRAY_BUFFER, new Float32Array(positions)),
    size: bufferData(gl, gl.ARRAY_BUFFER, new Float32Array(sizes)),
    alpha: bufferData(gl, gl.ARRAY_BUFFER, new Float32Array(alphas)),
    vertexCount: count
  };
}

function createLineMesh(gl, data) {
  return {
    position: bufferData(gl, gl.ARRAY_BUFFER, new Float32Array(data)),
    vertexCount: data.length / 3
  };
}

function bufferData(gl, target, data) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(target, buffer);
  gl.bufferData(target, data, gl.STATIC_DRAW);
  return buffer;
}

function bindMesh(gl, mesh, loc) {
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.position);
  enableAttrib(gl, loc.aPosition, 3);
  if (mesh.normal && loc.aNormal !== undefined && loc.aNormal >= 0) {
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normal);
    enableAttrib(gl, loc.aNormal, 3);
  }
  if (mesh.index) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.index);
}

function enableAttrib(gl, location, size) {
  if (location === undefined || location < 0) return;
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
}

function setUniform(gl, location, value) {
  if (location === null || location === undefined) return;
  if (typeof value === "number") {
    gl.uniform1f(location, value);
    return;
  }
  if (Array.isArray(value) || value instanceof Float32Array) {
    if (value.length === 2) gl.uniform2fv(location, value);
    else if (value.length === 3) gl.uniform3fv(location, value);
    else if (value.length === 4) gl.uniform4fv(location, value);
    else if (value.length === 9) gl.uniformMatrix3fv(location, false, value);
    else if (value.length === 16) gl.uniformMatrix4fv(location, false, value);
  }
}

function setMat4(gl, location, matrix) {
  if (location) gl.uniformMatrix4fv(location, false, matrix);
}

function setMat3(gl, location, matrix) {
  if (location) gl.uniformMatrix3fv(location, false, matrix);
}

function mat4Identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function mat4Perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  const nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

function mat4LookAt(eye, target, up) {
  const z = normalise3(sub3(eye, target));
  const x = normalise3(cross3(up, z));
  const y = cross3(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1]);
}

function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[0 * 4 + r] * b[c * 4 + 0] + a[1 * 4 + r] * b[c * 4 + 1] + a[2 * 4 + r] * b[c * 4 + 2] + a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

function mat4Translate(m, v) {
  const t = mat4Identity();
  t[12] = v[0];
  t[13] = v[1];
  t[14] = v[2];
  return mat4Multiply(m, t);
}

function mat4Scale(m, v) {
  const s = mat4Identity();
  s[0] = v[0];
  s[5] = v[1];
  s[10] = v[2];
  return mat4Multiply(m, s);
}

function mat4RotateY(m, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const r = mat4Identity();
  r[0] = c;
  r[2] = -s;
  r[8] = s;
  r[10] = c;
  return mat4Multiply(m, r);
}

function normalMatrix(m) {
  const a00 = m[0], a01 = m[1], a02 = m[2];
  const a10 = m[4], a11 = m[5], a12 = m[6];
  const a20 = m[8], a21 = m[9], a22 = m[10];
  const b01 = a22 * a11 - a12 * a21;
  const b11 = -a22 * a10 + a12 * a20;
  const b21 = a21 * a10 - a11 * a20;
  let det = a00 * b01 + a01 * b11 + a02 * b21;
  if (!det) return new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  det = 1 / det;
  return new Float32Array([
    b01 * det,
    (-a22 * a01 + a02 * a21) * det,
    (a12 * a01 - a02 * a11) * det,
    b11 * det,
    (a22 * a00 - a02 * a20) * det,
    (-a12 * a00 + a02 * a10) * det,
    b21 * det,
    (-a21 * a00 + a01 * a20) * det,
    (a11 * a00 - a01 * a10) * det
  ]);
}

function solveKepler(meanAnomaly, eccentricity) {
  const e = clamp(eccentricity, 0, 0.95);
  const m = wrapRadians(meanAnomaly);
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

function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function normalise3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function mix3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function mul3(a, t) { return [a[0] * t, a[1] * t, a[2] * t]; }
function numberOr(value, fallback) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function wrap01(value) { let r = value % 1; if (r < 0) r += 1; return r; }
function seededRandom(seed) { const x = Math.sin(seed * 12.9898) * 43758.5453123; return x - Math.floor(x); }
function degToRad(deg) { return deg * Math.PI / 180; }
function normaliseDegrees(deg) { let value = Number(deg); if (!Number.isFinite(value)) return 0; value %= 360; if (value < 0) value += 360; return value; }
function wrapRadians(angle) { let value = Number(angle); if (!Number.isFinite(value)) return 0; value %= TWO_PI; if (value < 0) value += TWO_PI; return value; }
