/* ============================================================================
   ExoIntel-Prime
   Ultra Cinematic WebGL Scientific Scene Renderer
   ---------------------------------------------------------------------------
   Purpose:
   - Render a high-end WebGL visualisation of an exoplanet transit system.
   - Keep heavy photometric calculations inside transitWorker.js.
   - Use the same projected-orbit convention as the worker:
       circular: phase = 0 at inferior conjunction
       eccentric: f0 ≈ π/2 − ω at inferior conjunction
   - Support visual quality modes:
       "low" | "balanced" | "ultra"

   Scientific note:
   The scene is a normalised visual representation. It uses the same phase,
   front/back, eccentricity, and argument-of-periastron convention as the
   worker, but it scales the orbit to remain visible in the browser viewport.
   ============================================================================ */

const TWO_PI = Math.PI * 2;

/* ============================================================================
   SHADERS
   ============================================================================ */

const STAR_VERTEX_SHADER = `
attribute vec3 aPosition;
attribute vec3 aNormal;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;
uniform mat3 uNormalMatrix;

varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vViewNormal;

void main(){
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(uNormalMatrix * aNormal);
  vViewNormal = normalize((uView * vec4(vNormal, 0.0)).xyz);
  gl_Position = uProjection * uView * world;
}
`;

const STAR_FRAGMENT_SHADER = `
precision highp float;

varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vViewNormal;

uniform float uTime;
uniform float uU1;
uniform float uU2;
uniform float uTeff;
uniform float uGranulationStrength;

uniform float uSpotEnabled;
uniform vec3 uSpotA;
uniform vec3 uSpotB;
uniform vec3 uSpotC;
uniform float uSpotRadius;
uniform float uSpotContrast;

float hash(vec3 p){
  p = fract(p * 0.3183099 + vec3(0.1031, 0.11369, 0.13787));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 p){
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

float fbm(vec3 p){
  float value = 0.0;
  float amp = 0.54;

  for(int i = 0; i < 6; i++){
    value += amp * noise(p);
    p = p * 2.03 + vec3(5.31, 7.17, 3.83);
    amp *= 0.47;
  }

  return value;
}

float spotMask(vec3 n, vec3 centre, float radius, float softness){
  float d = length(n - centre);
  return 1.0 - smoothstep(radius, radius + softness, d);
}

vec3 stellarColour(float teff){
  float t = clamp((teff - 2800.0) / 7200.0, 0.0, 1.0);

  vec3 mStar = vec3(1.00, 0.30, 0.10);
  vec3 kStar = vec3(1.00, 0.50, 0.18);
  vec3 gStar = vec3(1.00, 0.72, 0.34);
  vec3 fStar = vec3(0.93, 0.91, 1.00);
  vec3 aStar = vec3(0.55, 0.72, 1.00);

  vec3 c = mix(mStar, kStar, smoothstep(0.00, 0.25, t));
  c = mix(c, gStar, smoothstep(0.23, 0.52, t));
  c = mix(c, fStar, smoothstep(0.50, 0.72, t));
  c = mix(c, aStar, smoothstep(0.70, 1.00, t));

  return c;
}

void main(){
  vec3 n = normalize(vNormal);

  float mu = clamp(vViewNormal.z * 0.5 + 0.5, 0.0, 1.0);
  float q = 1.0 - mu;

  float limb = clamp(1.0 - uU1 * q - uU2 * q * q, 0.0, 1.25);

  vec3 slowCoord = n * 7.5 + vec3(uTime * 0.010, -uTime * 0.008, uTime * 0.007);
  vec3 cellCoord = n * 31.0 + vec3(-uTime * 0.026, uTime * 0.018, -uTime * 0.013);
  vec3 fineCoord = n * 96.0 + vec3(uTime * 0.050, uTime * 0.034, -uTime * 0.024);

  float convection = fbm(slowCoord);
  float cells = fbm(cellCoord);
  float fine = fbm(fineCoord);

  float brightCell = smoothstep(0.42, 0.70, cells);
  float darkLane = smoothstep(0.28, 0.48, 1.0 - cells);

  float granulation =
    0.84 +
    uGranulationStrength * (
      0.18 * convection +
      0.15 * fine +
      0.10 * brightCell -
      0.14 * darkLane
    );

  vec3 base = stellarColour(uTeff);
  vec3 photosphere = base * limb * granulation;

  float edge = pow(1.0 - mu, 1.80);
  photosphere = mix(
    photosphere,
    vec3(1.0, 0.28, 0.06) * limb,
    edge * 0.26
  );

  float spotDark = 0.0;

  if(uSpotEnabled > 0.5){
    float ragA = 0.86 + 0.24 * fbm(n * 110.0 + vec3(2.1, 5.3, 1.7));
    float ragB = 0.84 + 0.27 * fbm(n * 96.0 + vec3(7.4, 2.8, 6.2));
    float ragC = 0.82 + 0.28 * fbm(n * 126.0 + vec3(3.7, 9.1, 4.4));

    float penA = spotMask(n, normalize(uSpotA), uSpotRadius * 1.02 * ragA, uSpotRadius * 0.34);
    float umbA = spotMask(n, normalize(uSpotA), uSpotRadius * 0.42 * ragA, uSpotRadius * 0.16);

    float penB = spotMask(n, normalize(uSpotB), uSpotRadius * 0.72 * ragB, uSpotRadius * 0.30);
    float umbB = spotMask(n, normalize(uSpotB), uSpotRadius * 0.28 * ragB, uSpotRadius * 0.15);

    float penC = spotMask(n, normalize(uSpotC), uSpotRadius * 0.60 * ragC, uSpotRadius * 0.26);
    float umbC = spotMask(n, normalize(uSpotC), uSpotRadius * 0.24 * ragC, uSpotRadius * 0.14);

    float penumbra = max(max(penA, penB * 0.78), penC * 0.65);
    float umbra = max(max(umbA, umbB * 0.86), umbC * 0.70);

    spotDark = clamp(penumbra * 0.54 + umbra * 0.90, 0.0, 1.0);
  }

  float spotFactor = 1.0 - spotDark * clamp(uSpotContrast, 0.0, 0.98);
  vec3 colour = photosphere * spotFactor;

  colour += vec3(1.0, 0.38, 0.08) * pow(1.0 - mu, 2.75) * 0.11;

  gl_FragColor = vec4(max(colour, vec3(0.0)), 1.0);
}
`;

const GLOW_VERTEX_SHADER = STAR_VERTEX_SHADER;

const GLOW_FRAGMENT_SHADER = `
precision highp float;

varying vec3 vViewNormal;

uniform float uTime;
uniform vec3 uGlowColour;
uniform float uGlowStrength;

void main(){
  float mu = clamp(vViewNormal.z * 0.5 + 0.5, 0.0, 1.0);

  float rim = pow(1.0 - mu, 1.05);
  float halo = pow(1.0 - mu, 2.85);
  float pulse = 0.94 + 0.06 * sin(uTime * 0.52);

  vec3 colour = uGlowColour * (0.45 * rim + 0.78 * halo) * pulse * uGlowStrength;
  float alpha = clamp((0.20 * rim + 0.34 * halo) * uGlowStrength, 0.0, 0.72);

  gl_FragColor = vec4(colour, alpha);
}
`;

const BODY_VERTEX_SHADER = STAR_VERTEX_SHADER;

const BODY_FRAGMENT_SHADER = `
precision highp float;

varying vec3 vNormal;
varying vec3 vViewNormal;

uniform vec3 uColour;
uniform vec3 uRimColour;
uniform float uAlpha;
uniform float uPhaseTint;

void main(){
  vec3 n = normalize(vNormal);
  vec3 light = normalize(vec3(-0.62, 0.32, 0.74));

  float lambert = max(dot(n, light), 0.0);
  float night = 1.0 - lambert;

  float mu = clamp(vViewNormal.z * 0.5 + 0.5, 0.0, 1.0);
  float rim = pow(1.0 - mu, 2.18);

  vec3 dayColour = uColour * (0.12 + 0.96 * lambert);
  vec3 nightColour = vec3(0.005, 0.010, 0.018) * (0.72 + 0.28 * uPhaseTint);

  vec3 colour = mix(dayColour, nightColour, night * 0.72);
  colour += uRimColour * rim * 0.42;

  gl_FragColor = vec4(colour, uAlpha);
}
`;

const LINE_VERTEX_SHADER = `
attribute vec3 aPosition;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;

void main(){
  gl_Position = uProjection * uView * uModel * vec4(aPosition, 1.0);
}
`;

const LINE_FRAGMENT_SHADER = `
precision highp float;

uniform vec3 uColour;
uniform float uAlpha;

void main(){
  gl_FragColor = vec4(uColour, uAlpha);
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

void main(){
  vec3 p = aPosition;
  p.x += sin(uTime * 0.012 + aPosition.z * 0.27) * 0.006;
  p.y += cos(uTime * 0.010 + aPosition.x * 0.19) * 0.004;

  vAlpha = aAlpha;
  gl_Position = uProjection * uView * vec4(p, 1.0);
  gl_PointSize = aSize * uPixelRatio;
}
`;

const STARFIELD_FRAGMENT_SHADER = `
precision highp float;

varying float vAlpha;

void main(){
  vec2 p = gl_PointCoord - vec2(0.5);
  float d = length(p);
  float a = smoothstep(0.5, 0.0, d) * vAlpha;
  gl_FragColor = vec4(0.76, 0.88, 1.0, a);
}
`;

/* ============================================================================
   RENDERER
   ============================================================================ */

export class ExoSceneRenderer {
  constructor({ container, onStatus = () => {}, onWarning = () => {} } = {}) {
    this.container = container;
    this.onStatus = onStatus;
    this.onWarning = onWarning;

    this.canvas = null;
    this.overlay = null;
    this.gl = null;

    this.ready = false;
    this.programs = {};
    this.meshes = {};

    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);

    this.params = {
      rpRs: 0.1,
      aRs: 12,
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

    this.model = {
      phase: new Float32Array(0),
      flux: new Float32Array(0),
      revision: 0
    };

    this.quality = "balanced";
    this.orbitPhase = 0.0;
    this.lastFrame = 0;
    this.frameHandle = null;

    this.view = mat4Identity();
    this.projection = mat4Identity();

    this.camera = {
      eye: [0, 0, 5.70],
      target: [0, 0, 0],
      up: [0, 1, 0],
      fov: 38.5 * Math.PI / 180,
      near: 0.01,
      far: 100
    };

    this.orbitSignature = "";
  }

  mount() {
    if (!this.container) {
      this.onWarning("Scene renderer could not mount because no container was supplied.");
      return;
    }

    this.container.innerHTML = "";
    this.container.style.position = "relative";
    this.container.style.overflow = "hidden";
    this.container.style.background = "transparent";

    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("aria-label", "Theoretical exoplanet transit CGI model viewport");
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.display = "block";

    this.overlay = document.createElement("div");
    this.overlay.style.position = "absolute";
    this.overlay.style.left = "16px";
    this.overlay.style.bottom = "16px";
    this.overlay.style.maxWidth = "820px";
    this.overlay.style.padding = "10px 12px";
    this.overlay.style.border = "1px solid rgba(120,145,180,.38)";
    this.overlay.style.borderRadius = "14px";
    this.overlay.style.background = "rgba(5,10,18,.48)";
    this.overlay.style.color = "#dbeafe";
    this.overlay.style.font = "12px Inter, system-ui, sans-serif";
    this.overlay.style.backdropFilter = "blur(12px)";
    this.overlay.style.boxShadow = "0 14px 34px rgba(0,0,0,.24)";
    this.overlay.textContent = "Theoretical CGI model · projected orbit visualisation · photometry calculated by the worker";

    this.container.append(this.canvas, this.overlay);
    this.initWebGL();
  }

  initWebGL() {
    this.gl = this.canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      depth: true,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: "high-performance"
    });

    if (!this.gl) {
      this.ready = false;
      this.onWarning("WebGL unavailable. Scene renderer is disabled.");
      return;
    }

    const gl = this.gl;

    try {
      this.programs.star = createProgram(gl, STAR_VERTEX_SHADER, STAR_FRAGMENT_SHADER);
      this.programs.glow = createProgram(gl, GLOW_VERTEX_SHADER, GLOW_FRAGMENT_SHADER);
      this.programs.body = createProgram(gl, BODY_VERTEX_SHADER, BODY_FRAGMENT_SHADER);
      this.programs.line = createProgram(gl, LINE_VERTEX_SHADER, LINE_FRAGMENT_SHADER);
      this.programs.starfield = createProgram(gl, STARFIELD_VERTEX_SHADER, STARFIELD_FRAGMENT_SHADER);
    } catch (error) {
      this.ready = false;
      this.onWarning(`WebGL shader failed: ${error.message}`);
      return;
    }

    this.rebuildMeshesForQuality();

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0, 0, 0, 0);

    this.canvas.addEventListener("webglcontextlost", event => {
      event.preventDefault();
      this.ready = false;
      this.onWarning("WebGL context lost. Reload the page to reinitialise the scene.");
    });

    window.addEventListener("resize", () => this.resize(), { passive: true });

    this.resize();
    this.ready = true;
    this.onStatus("Ultra WebGL scene online");

    this.frameHandle = requestAnimationFrame(time => this.loop(time));
  }

  rebuildMeshesForQuality() {
    const gl = this.gl;
    const quality = this.qualitySettings();

    this.meshes = {
      sphere: createSphereMesh(gl, quality.sphereSegments, quality.sphereRings),
      glowSphere: createSphereMesh(gl, quality.glowSegments, quality.glowRings),
      orbitPath: createLineMesh(gl, createOrbitPathData(this.params, quality.orbitPoints)),
      moonOrbit: createUnitCircleMesh(gl, Math.max(120, Math.floor(quality.orbitPoints / 3))),
      chord: createLineMesh(gl, [
        -1.12, 0, 0.040,
         1.12, 0, 0.040
      ]),
      starfield: createStarfieldMesh(gl, quality.starCount)
    };

    this.orbitSignature = this.computeOrbitSignature();
  }

  rebuildOrbitPathIfNeeded() {
    if (!this.gl || !this.meshes.orbitPath) return;

    const signature = this.computeOrbitSignature();

    if (signature === this.orbitSignature) {
      return;
    }

    const quality = this.qualitySettings();
    const data = createOrbitPathData(this.params, quality.orbitPoints);

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.meshes.orbitPath.position);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(data), this.gl.STATIC_DRAW);

    this.meshes.orbitPath.vertexCount = data.length / 3;
    this.orbitSignature = signature;
  }

  computeOrbitSignature() {
    return [
      this.quality,
      numberOr(this.params.aRs, 12).toFixed(4),
      numberOr(this.params.inclinationDeg, 88.5).toFixed(4),
      numberOr(this.params.eccentricity, 0).toFixed(5),
      numberOr(this.params.omegaDeg, 90).toFixed(4)
    ].join("|");
  }

  qualitySettings() {
    if (this.quality === "low") {
      return {
        sphereSegments: 48,
        sphereRings: 28,
        glowSegments: 42,
        glowRings: 24,
        orbitPoints: 260,
        starCount: 180,
        granulationStrength: 0.70,
        glowStrength: 0.80
      };
    }

    if (this.quality === "ultra") {
      return {
        sphereSegments: 128,
        sphereRings: 72,
        glowSegments: 104,
        glowRings: 58,
        orbitPoints: 840,
        starCount: 720,
        granulationStrength: 1.22,
        glowStrength: 1.22
      };
    }

    return {
      sphereSegments: 88,
      sphereRings: 52,
      glowSegments: 76,
      glowRings: 44,
      orbitPoints: 520,
      starCount: 400,
      granulationStrength: 1.00,
      glowStrength: 1.00
    };
  }

  dispose() {
    if (this.frameHandle) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }

    this.ready = false;
  }

  updateState({ params = null, target = null, model = null } = {}) {
    if (params) {
      const nextQuality = params.visualQuality || this.params.visualQuality || "balanced";

      this.params = {
        ...this.params,
        ...params,
        visualQuality: nextQuality
      };

      if (nextQuality !== this.quality) {
        this.quality = nextQuality;
        if (this.gl) {
          this.rebuildMeshesForQuality();
        }
      } else {
        this.rebuildOrbitPathIfNeeded();
      }
    }

    if (target) {
      this.target = {
        ...this.target,
        ...target
      };
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
    const quality = this.quality || "balanced";

    this.overlay.textContent =
      `${name} around ${host} · ${geometry} · ${spot} · ${moon} · ${quality} visual quality`;
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

    const aspect = width / Math.max(1, height);
    this.view = mat4LookAt(this.camera.eye, this.camera.target, this.camera.up);
    this.projection = mat4Perspective(this.camera.fov, aspect, this.camera.near, this.camera.far);
  }

  loop(time) {
    if (!this.ready) return;

    const seconds = time * 0.001;
    const dt = Math.min(0.05, Math.max(0, (time - this.lastFrame) / 1000 || 0));
    this.lastFrame = time;

    const speed = this.quality === "low" ? 0.045 : 0.052;
    this.orbitPhase = wrap01(this.orbitPhase + dt * speed);

    this.render(seconds);
    this.frameHandle = requestAnimationFrame(next => this.loop(next));
  }

  render(time) {
    const gl = this.gl;
    if (!gl) return;

    this.resize();
    this.rebuildOrbitPathIfNeeded();

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const teff = numberOr(this.target.st_teff, 5772);
    const glowColour = stellarGlowColour(teff);
    const bodies = this.computeBodyPositions();

    this.drawStarfield(time);
    this.drawOrbitGuides();
    this.drawTransitChord();

    if (!bodies.planet.front) {
      this.drawPlanet(bodies.planet);
    }

    if (bodies.moon.enabled && !bodies.moon.front) {
      this.drawMoon(bodies.moon);
    }

    this.drawStar(time, teff);
    this.drawStarGlow(time, glowColour);

    if (bodies.planet.front) {
      this.drawPlanet(bodies.planet);
    }

    if (bodies.moon.enabled && bodies.moon.front) {
      this.drawMoon(bodies.moon);
    }

    if (bodies.moon.enabled) {
      this.drawMoonOrbitGuide(bodies.planet);
    }
  }

  computeBodyPositions() {
    const p = this.params;
    const radius = clamp(numberOr(p.rpRs, 0.1), 0.01, 0.28);

    const projected = projectedVisualGeometry(this.orbitPhase, p);

    const planet = {
      position: [projected.planet.x, projected.planet.y, projected.planet.z],
      radius,
      front: projected.planet.front,
      phaseTint: 0.5 + 0.5 * Math.max(-1, Math.min(1, projected.planet.z / 1.8))
    };

    const moonEnabled = Boolean(p.moonEnabled);
    const moonRadius = clamp(numberOr(p.moonRadius, 0.025), 0.004, 0.08);

    const moon = {
      enabled: moonEnabled,
      position: [projected.moon.x, projected.moon.y, projected.moon.z],
      radius: moonRadius,
      front: projected.moon.front,
      phaseTint: 0.5 + 0.5 * Math.max(-1, Math.min(1, projected.moon.z / 1.8))
    };

    return { planet, moon };
  }

  drawStarfield(time) {
    const gl = this.gl;
    const loc = useProgram(gl, this.programs.starfield);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshes.starfield.position);
    gl.enableVertexAttribArray(loc.aPosition);
    gl.vertexAttribPointer(loc.aPosition, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshes.starfield.size);
    gl.enableVertexAttribArray(loc.aSize);
    gl.vertexAttribPointer(loc.aSize, 1, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshes.starfield.alpha);
    gl.enableVertexAttribArray(loc.aAlpha);
    gl.vertexAttribPointer(loc.aAlpha, 1, gl.FLOAT, false, 0, 0);

    setMat4(gl, loc.uView, this.view);
    setMat4(gl, loc.uProjection, this.projection);
    setUniform(gl, loc.uPixelRatio, this.pixelRatio);
    setUniform(gl, loc.uTime, time);

    gl.drawArrays(gl.POINTS, 0, this.meshes.starfield.vertexCount);

    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  drawStar(time, teff) {
    const p = this.params;
    const spotBasis = computeSpotBasis(p);
    const quality = this.qualitySettings();

    const model = mat4RotateY(mat4Identity(), time * 0.018);

    this.drawSphere({
      program: this.programs.star,
      mesh: this.meshes.sphere,
      model,
      uniforms: {
        uTime: time,
        uU1: numberOr(p.u1, 0.32),
        uU2: numberOr(p.u2, 0.28),
        uTeff: teff,
        uGranulationStrength: quality.granulationStrength,
        uSpotEnabled: p.spotEnabled ? 1 : 0,
        uSpotA: spotBasis.a,
        uSpotB: spotBasis.b,
        uSpotC: spotBasis.c,
        uSpotRadius: clamp(numberOr(p.spotRadius, 0.12), 0.01, 0.60),
        uSpotContrast: clamp(numberOr(p.spotContrast, 0.55), 0, 1)
      }
    });
  }

  drawStarGlow(time, glowColour) {
    const gl = this.gl;
    const quality = this.qualitySettings();

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);

    this.drawSphere({
      program: this.programs.glow,
      mesh: this.meshes.glowSphere,
      model: mat4Scale(mat4Identity(), [1.27, 1.27, 1.27]),
      uniforms: {
        uTime: time,
        uGlowColour: glowColour,
        uGlowStrength: quality.glowStrength
      },
      transparent: true
    });

    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  drawPlanet(body) {
    this.drawBody(body, [0.026, 0.044, 0.064], [0.30, 0.64, 0.78], 1);
  }

  drawMoon(body) {
    if (!body.enabled) return;
    this.drawBody(body, [0.42, 0.42, 0.40], [0.86, 0.82, 0.70], 1);
  }

  drawBody(body, colour, rim, alpha) {
    const model = mat4Scale(
      mat4Translate(mat4Identity(), body.position),
      [body.radius, body.radius, body.radius]
    );

    this.drawSphere({
      program: this.programs.body,
      mesh: this.meshes.sphere,
      model,
      uniforms: {
        uColour: colour,
        uRimColour: rim,
        uAlpha: alpha,
        uPhaseTint: body.phaseTint || 0.5
      }
    });
  }

  drawOrbitGuides() {
    const gl = this.gl;
    const e = clamp(numberOr(this.params.eccentricity, 0), 0, 0.95);
    const colour = e > 1e-5 ? [0.40, 0.82, 1.00] : [0.30, 0.72, 0.96];
    const alpha = e > 1e-5 ? 0.34 : 0.27;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);

    this.drawLineMesh(this.meshes.orbitPath, mat4Identity(), colour, alpha);

    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  drawTransitChord() {
    const gl = this.gl;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);

    this.drawLineMesh(this.meshes.chord, mat4Identity(), [0.98, 0.63, 0.22], 0.18);

    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  drawMoonOrbitGuide(planet) {
    const p = this.params;
    const distance = clamp(numberOr(p.moonDistance, 0.55), 0.05, 2.5) * 0.22;

    const gl = this.gl;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);

    let model = mat4Translate(mat4Identity(), planet.position);
    model = mat4Scale(model, [distance, distance * 0.58, distance * 0.42]);

    this.drawLineMesh(this.meshes.moonOrbit, model, [0.95, 0.67, 0.24], 0.24);

    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  drawSphere({ program, mesh, model, uniforms = {}, transparent = false }) {
    const gl = this.gl;
    const loc = useProgram(gl, program);

    bindMesh(gl, mesh, loc);

    setMat4(gl, loc.uModel, model);
    setMat4(gl, loc.uView, this.view);
    setMat4(gl, loc.uProjection, this.projection);
    setMat3(gl, loc.uNormalMatrix, normalMatrix(model));

    for (const [key, value] of Object.entries(uniforms)) {
      setUniform(gl, loc[key], value);
    }

    if (transparent) {
      gl.disable(gl.CULL_FACE);
    }

    gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_SHORT, 0);

    if (transparent) {
      gl.enable(gl.CULL_FACE);
    }
  }

  drawLineMesh(mesh, model, colour, alpha) {
    const gl = this.gl;
    const loc = useProgram(gl, this.programs.line);

    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.position);
    gl.enableVertexAttribArray(loc.aPosition);
    gl.vertexAttribPointer(loc.aPosition, 3, gl.FLOAT, false, 0, 0);

    setMat4(gl, loc.uModel, model);
    setMat4(gl, loc.uView, this.view);
    setMat4(gl, loc.uProjection, this.projection);
    setUniform(gl, loc.uColour, colour);
    setUniform(gl, loc.uAlpha, alpha);

    gl.drawArrays(gl.LINES, 0, mesh.vertexCount);
  }
}

/* ============================================================================
   ORBIT GEOMETRY
   ============================================================================ */

function projectedVisualGeometry(phase01, params) {
  const p = params || {};

  const aRs = clamp(numberOr(p.aRs, 12), 2, 100);
  const inclination = degToRad(clamp(numberOr(p.inclinationDeg, 88.5), 0, 90));
  const e = clamp(numberOr(p.eccentricity, 0), 0, 0.95);
  const omega = degToRad(normaliseDegrees(numberOr(p.omegaDeg, 90)));

  const visualOrbitScale = 1.76;
  const zScale = 1.08;
  const phase = wrap01(phase01);

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

    radiusPhysical =
      aRs *
      (1 - e * e) /
      Math.max(1e-8, 1 + e * Math.cos(trueAnomaly));

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

  /*
    The worker uses stellar-radius units, where a/R★ is often 5--60.
    Rendering that literally would put the planet far outside the viewport.
    We therefore normalise by a/R★ while preserving phase, impact parameter
    direction, front/back sign, and eccentric shape.
  */
  const normalisation = Math.max(aRs, 1e-6);

  const x = xPhysical / normalisation * visualOrbitScale;
  const y = yPhysical / normalisation * visualOrbitScale;
  const z = zPhysical / normalisation * visualOrbitScale * zScale;

  const moonPhase =
    degToRad(normaliseDegrees(numberOr(p.moonPhaseDeg, 45))) +
    phase * TWO_PI * 5.0;

  const moonDistance = clamp(numberOr(p.moonDistance, 0.55), 0.02, 3.0) * 0.22;

  const moonX = x + moonDistance * Math.cos(moonPhase);
  const moonY = y + moonDistance * 0.58 * Math.sin(moonPhase);
  const moonZ = z + moonDistance * 0.42 * Math.sin(moonPhase);

  return {
    planet: {
      x,
      y,
      z,
      front: z >= 0
    },
    moon: {
      x: moonX,
      y: moonY,
      z: moonZ,
      front: moonZ >= 0
    }
  };
}

function createOrbitPathData(params, points) {
  const data = [];
  const n = Math.max(24, points);

  for (let i = 0; i < n; i++) {
    const a = i / n;
    const b = (i + 1) / n;

    const pa = projectedVisualGeometry(a, params).planet;
    const pb = projectedVisualGeometry(b, params).planet;

    data.push(
      pa.x, pa.y, pa.z,
      pb.x, pb.y, pb.z
    );
  }

  return data;
}

function solveKepler(meanAnomaly, eccentricity) {
  const e = clamp(eccentricity, 0, 0.95);
  const m = wrapRadians(meanAnomaly);

  if (e < 1e-8) {
    return m;
  }

  let E = e < 0.8 ? m : Math.PI;

  for (let i = 0; i < 30; i++) {
    const f = E - e * Math.sin(E) - m;
    const fp = 1 - e * Math.cos(E);
    const dE = -f / Math.max(fp, 1e-12);

    E += dE;

    if (Math.abs(dE) < 1e-12) {
      break;
    }
  }

  return E;
}

function trueAnomalyToEccentricAnomaly(f, e) {
  if (e < 1e-8) {
    return wrapRadians(f);
  }

  const factor = Math.sqrt((1 - e) / (1 + e));
  return wrapRadians(2 * Math.atan2(
    factor * Math.sin(f / 2),
    Math.cos(f / 2)
  ));
}

function eccentricAnomalyToTrueAnomaly(E, e) {
  if (e < 1e-8) {
    return wrapRadians(E);
  }

  const factor = Math.sqrt((1 + e) / (1 - e));
  return wrapRadians(2 * Math.atan2(
    factor * Math.sin(E / 2),
    Math.cos(E / 2)
  ));
}

function eccentricAnomalyToMeanAnomaly(E, e) {
  return wrapRadians(E - e * Math.sin(E));
}

/* ============================================================================
   SCENE HELPERS
   ============================================================================ */

function computeSpotBasis(params) {
  const x = clamp(numberOr(params.spotX, 0.2), -0.88, 0.88);
  const y = clamp(numberOr(params.spotY, 0.1), -0.88, 0.88);
  const z = Math.sqrt(Math.max(0.03, 1 - x * x - y * y));

  const a = normalize3([x, y, z]);
  const b = normalize3([x + 0.08, y - 0.035, z]);
  const c = normalize3([x - 0.055, y + 0.060, z]);

  return { a, b, c };
}

function stellarGlowColour(teff) {
  if (teff < 3600) return [1.00, 0.19, 0.05];
  if (teff < 5200) return [1.00, 0.32, 0.06];
  if (teff < 6500) return [1.00, 0.50, 0.09];
  if (teff < 8500) return [0.48, 0.74, 1.00];
  return [0.28, 0.52, 1.00];
}

/* ============================================================================
   WEBGL UTILITIES
   ============================================================================ */

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

      indices.push(a, b, a + 1);
      indices.push(b, b + 1, a + 1);
    }
  }

  return {
    position: bufferData(gl, gl.ARRAY_BUFFER, new Float32Array(positions)),
    normal: bufferData(gl, gl.ARRAY_BUFFER, new Float32Array(normals)),
    index: bufferData(gl, gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices)),
    indexCount: indices.length
  };
}

function createUnitCircleMesh(gl, points) {
  const data = [];

  for (let i = 0; i < points; i++) {
    const a = i / points * TWO_PI;
    const b = (i + 1) / points * TWO_PI;

    data.push(
      Math.cos(a), Math.sin(a), 0,
      Math.cos(b), Math.sin(b), 0
    );
  }

  return createLineMesh(gl, data);
}

function createLineMesh(gl, data) {
  return {
    position: bufferData(gl, gl.ARRAY_BUFFER, new Float32Array(data)),
    vertexCount: data.length / 3
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
    const radius = 2.9 + 2.9 * v;
    const y = -1.9 + 3.8 * w;

    positions.push(
      radius * Math.cos(theta),
      y,
      -2.9 - radius * Math.sin(theta) * 0.38
    );

    sizes.push(0.9 + 2.5 * seededRandom(i * 7.77 + 8.4));
    alphas.push(0.20 + 0.60 * seededRandom(i * 5.45 + 4.2));
  }

  return {
    position: bufferData(gl, gl.ARRAY_BUFFER, new Float32Array(positions)),
    size: bufferData(gl, gl.ARRAY_BUFFER, new Float32Array(sizes)),
    alpha: bufferData(gl, gl.ARRAY_BUFFER, new Float32Array(alphas)),
    vertexCount: count
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
  gl.enableVertexAttribArray(loc.aPosition);
  gl.vertexAttribPointer(loc.aPosition, 3, gl.FLOAT, false, 0, 0);

  if (mesh.normal && loc.aNormal !== undefined && loc.aNormal >= 0) {
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normal);
    gl.enableVertexAttribArray(loc.aNormal);
    gl.vertexAttribPointer(loc.aNormal, 3, gl.FLOAT, false, 0, 0);
  }

  if (mesh.index) {
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.index);
  }
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

/* ============================================================================
   MATRIX MATH
   ============================================================================ */

function mat4Identity() {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ]);
}

function mat4Perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  const nf = 1 / (near - far);

  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0
  ]);
}

function mat4LookAt(eye, target, up) {
  const z = normalize3(sub3(eye, target));
  const x = normalize3(cross3(up, z));
  const y = cross3(z, x);

  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1
  ]);
}

function mat4Multiply(a, b) {
  const out = new Float32Array(16);

  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
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

  if (!det) {
    return new Float32Array([
      1, 0, 0,
      0, 1, 0,
      0, 0, 1
    ]);
  }

  det = 1.0 / det;

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

/* ============================================================================
   NUMERIC HELPERS
   ============================================================================ */

function sub3(a, b) {
  return [
    a[0] - b[0],
    a[1] - b[1],
    a[2] - b[2]
  ];
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize3(v) {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;

  return [
    v[0] / length,
    v[1] / length,
    v[2] / length
  ];
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function wrap01(value) {
  let result = value % 1;
  if (result < 0) result += 1;
  return result;
}

function seededRandom(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453123;
  return x - Math.floor(x);
}

function degToRad(deg) {
  return deg * Math.PI / 180;
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

function wrapRadians(angle) {
  let value = Number(angle);

  if (!Number.isFinite(value)) {
    return 0;
  }

  value %= TWO_PI;

  if (value < 0) {
    value += TWO_PI;
  }

  return value;
}
