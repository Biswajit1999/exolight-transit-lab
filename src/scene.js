/* ============================================================================
   ExoIntel-Prime
   Native WebGL Scientific Scene Renderer
   ---------------------------------------------------------------------------
   Purpose:
   - Render a cinematic star/planet/exomoon/starspot scene without blocking UI.
   - Keep rendering lightweight and independent from the heavy worker solver.
   - Use the same parameter snapshot that is sent to the worker.
   - Avoid decorative physics lies: starspots, planet size, moon state, and
     limb darkening visually represent the current theoretical hypothesis.

   This module deliberately does not compute the transit light curve. That is
   the worker's responsibility. The scene is a visual companion to the current
   model parameters.
   ============================================================================ */

const TWO_PI = Math.PI * 2;

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
uniform float uSpotEnabled;
uniform vec3 uSpotA;
uniform vec3 uSpotB;
uniform vec3 uSpotC;
uniform float uSpotRadius;
uniform float uSpotContrast;

float hash(vec3 p){
  p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
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
  float v = 0.0;
  float a = 0.52;

  for(int i = 0; i < 5; i++){
    v += a * noise(p);
    p = p * 2.03 + vec3(7.1, 3.9, 5.4);
    a *= 0.48;
  }

  return v;
}

float spotMask(vec3 n, vec3 centre, float radius, float softness){
  float d = length(n - centre);
  return 1.0 - smoothstep(radius, radius + softness, d);
}

vec3 stellarColour(float teff){
  float t = clamp((teff - 2800.0) / 7200.0, 0.0, 1.0);

  vec3 cool = vec3(1.0, 0.39, 0.13);
  vec3 solar = vec3(1.0, 0.72, 0.34);
  vec3 hot = vec3(0.60, 0.77, 1.0);

  vec3 c1 = mix(cool, solar, smoothstep(0.0, 0.52, t));
  vec3 c2 = mix(solar, hot, smoothstep(0.48, 1.0, t));

  return mix(c1, c2, smoothstep(0.46, 0.60, t));
}

void main(){
  vec3 n = normalize(vNormal);

  float mu = clamp(vViewNormal.z * 0.5 + 0.5, 0.0, 1.0);
  float q = 1.0 - mu;
  float limb = clamp(1.0 - uU1 * q - uU2 * q * q, 0.0, 1.2);

  vec3 pSlow = n * 8.0 + vec3(uTime * 0.018, -uTime * 0.012, uTime * 0.010);
  vec3 pCell = n * 28.0 + vec3(-uTime * 0.032, uTime * 0.019, -uTime * 0.014);
  vec3 pFine = n * 72.0 + vec3(uTime * 0.050, uTime * 0.041, -uTime * 0.026);

  float convection = fbm(pSlow);
  float cells = fbm(pCell);
  float fine = fbm(pFine);

  float lanes = smoothstep(0.36, 0.58, cells);
  float grain = 0.88 + 0.19 * convection + 0.11 * fine - 0.07 * lanes;

  vec3 base = stellarColour(uTeff);
  vec3 photosphere = base * limb * grain;

  float edgeWarmth = pow(1.0 - mu, 1.75);
  photosphere = mix(photosphere, vec3(1.0, 0.28, 0.06) * limb, edgeWarmth * 0.25);

  float spot = 0.0;

  if(uSpotEnabled > 0.5){
    float umbraA = spotMask(n, normalize(uSpotA), uSpotRadius * 0.50, uSpotRadius * 0.18);
    float penA = spotMask(n, normalize(uSpotA), uSpotRadius * 1.00, uSpotRadius * 0.28);

    float umbraB = spotMask(n, normalize(uSpotB), uSpotRadius * 0.30, uSpotRadius * 0.18);
    float penB = spotMask(n, normalize(uSpotB), uSpotRadius * 0.74, uSpotRadius * 0.25);

    float umbraC = spotMask(n, normalize(uSpotC), uSpotRadius * 0.22, uSpotRadius * 0.16);
    float penC = spotMask(n, normalize(uSpotC), uSpotRadius * 0.58, uSpotRadius * 0.23);

    float penumbra = max(max(penA, penB), penC);
    float umbra = max(max(umbraA, umbraB), umbraC);

    float ragged = fbm(n * 95.0 + vec3(1.7, 3.1, 0.4));
    penumbra *= 0.78 + 0.28 * ragged;
    umbra *= 0.82 + 0.22 * ragged;

    spot = clamp(penumbra * 0.55 + umbra * 0.90, 0.0, 1.0);
  }

  float darkening = 1.0 - spot * clamp(uSpotContrast, 0.0, 0.98);
  vec3 colour = photosphere * darkening;

  colour += vec3(1.0, 0.42, 0.10) * pow(1.0 - mu, 2.8) * 0.10;

  gl_FragColor = vec4(max(colour, vec3(0.0)), 1.0);
}
`;

const GLOW_VERTEX_SHADER = STAR_VERTEX_SHADER;

const GLOW_FRAGMENT_SHADER = `
precision highp float;

varying vec3 vViewNormal;

uniform float uTime;
uniform vec3 uGlowColour;

void main(){
  float mu = clamp(vViewNormal.z * 0.5 + 0.5, 0.0, 1.0);
  float rim = pow(1.0 - mu, 1.20);
  float outer = pow(1.0 - mu, 3.40);
  float pulse = 0.92 + 0.08 * sin(uTime * 0.65);

  vec3 colour = uGlowColour * (0.42 * rim + 0.58 * outer) * pulse;
  float alpha = clamp(0.24 * rim + 0.30 * outer, 0.0, 0.62);

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

void main(){
  vec3 n = normalize(vNormal);
  vec3 light = normalize(vec3(-0.55, 0.42, 0.86));

  float lambert = max(dot(n, light), 0.0);
  float mu = clamp(vViewNormal.z * 0.5 + 0.5, 0.0, 1.0);
  float rim = pow(1.0 - mu, 2.3);

  vec3 colour = uColour * (0.10 + 0.90 * lambert) + uRimColour * rim * 0.35;

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

export class ExoSceneRenderer {
  constructor({
    container,
    onStatus = () => {},
    onWarning = () => {}
  } = {}) {
    this.container = container;
    this.onStatus = onStatus;
    this.onWarning = onWarning;

    this.canvas = null;
    this.gl = null;
    this.ready = false;
    this.programs = {};
    this.meshes = {};
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);

    this.params = {
      rpRs: 0.1,
      aRs: 12,
      inclinationDeg: 88.5,
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
      moonPhaseDeg: 45
    };

    this.target = {
      st_teff: 5772
    };

    this.phase = 0;
    this.lastFrame = 0;
    this.frameHandle = null;
    this.view = mat4Identity();
    this.projection = mat4Identity();

    this.camera = {
      eye: [0, 0, 5.3],
      target: [0, 0, 0],
      up: [0, 1, 0],
      fov: 38 * Math.PI / 180,
      near: 0.01,
      far: 100
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

    this.container.appendChild(this.canvas);

    const label = document.createElement("div");
    label.textContent = "Theoretical CGI model · archival data remain fixed below";
    label.style.position = "absolute";
    label.style.left = "16px";
    label.style.bottom = "16px";
    label.style.padding = "9px 11px";
    label.style.border = "1px solid rgba(217,224,234,.9)";
    label.style.borderRadius = "12px";
    label.style.background = "rgba(255,255,255,.82)";
    label.style.color = "#637083";
    label.style.font = "12px Inter, system-ui, sans-serif";
    label.style.backdropFilter = "blur(10px)";

    this.container.appendChild(label);

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
      this.onWarning("WebGL unavailable. Scene renderer is disabled.");
      return;
    }

    const gl = this.gl;

    this.programs.star = createProgram(gl, STAR_VERTEX_SHADER, STAR_FRAGMENT_SHADER);
    this.programs.glow = createProgram(gl, GLOW_VERTEX_SHADER, GLOW_FRAGMENT_SHADER);
    this.programs.body = createProgram(gl, BODY_VERTEX_SHADER, BODY_FRAGMENT_SHADER);
    this.programs.line = createProgram(gl, LINE_VERTEX_SHADER, LINE_FRAGMENT_SHADER);

    this.meshes.sphere = createSphereMesh(gl, 96, 56);
    this.meshes.glowSphere = createSphereMesh(gl, 80, 48);
    this.meshes.orbit = createUnitCircleMesh(gl, 360);
    this.meshes.chord = createLineMesh(gl, [
      -1.08, 0, 0.026,
       1.08, 0, 0.026
    ]);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0, 0, 0, 0);

    window.addEventListener("resize", () => this.resize(), { passive: true });
    this.resize();

    this.ready = true;
    this.onStatus("CGI WebGL scene mounted.");

    this.frameHandle = requestAnimationFrame(time => this.loop(time));
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
      this.params = {
        ...this.params,
        ...params
      };
    }

    if (target) {
      this.target = {
        ...this.target,
        ...target
      };
    }

    if (model && model.phase && model.phase.length) {
      const minIndex = indexOfMinimum(model.flux);
      if (minIndex >= 0 && Number.isFinite(model.phase[minIndex])) {
        this.phase = model.phase[minIndex];
      }
    }
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

    this.phase += dt * 0.035;
    if (this.phase > 0.14) this.phase = -0.14;

    this.render(seconds);
    this.frameHandle = requestAnimationFrame(next => this.loop(next));
  }

  render(time) {
    const gl = this.gl;
    if (!gl) return;

    this.resize();

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const teff = numberOr(this.target.st_teff, 5772);
    const starColour = stellarColour(teff);
    const glowColour = stellarGlowColour(teff);

    const starModel = mat4RotateY(mat4Identity(), time * 0.018);

    this.drawOrbitGuides();
    this.drawTransitChord();

    const bodies = this.computeBodyPositions();

    if (!bodies.planet.front) {
      this.drawPlanet(bodies.planet);
    }

    if (bodies.moon.enabled && !bodies.moon.front) {
      this.drawMoon(bodies.moon);
    }

    this.drawStar(time, starModel, teff, starColour);
    this.drawStarGlow(time, glowColour);

    if (bodies.planet.front) {
      this.drawPlanet(bodies.planet);
    }

    if (bodies.moon.enabled && bodies.moon.front) {
      this.drawMoon(bodies.moon);
    }
  }

  computeBodyPositions() {
    const p = this.params;
    const radius = clamp(numberOr(p.rpRs, 0.1), 0.01, 0.28);
    const inclination = numberOr(p.inclinationDeg, 88.5) * Math.PI / 180;

    const visualPhase = clamp(this.phase, -0.14, 0.14);
    const theta = visualPhase * TWO_PI + Math.PI / 2;

    const orbitRadius = 1.55;
    const flatten = Math.max(0.10, Math.abs(Math.cos(inclination)) * 3.2);

    const x = orbitRadius * Math.sin(theta);
    const y = -orbitRadius * Math.cos(theta) * flatten;
    const z = 0.92 * Math.cos(theta) * Math.sin(inclination);

    const planet = {
      position: [x, y, z],
      radius,
      front: z >= 0
    };

    const moonEnabled = Boolean(p.moonEnabled);
    const moonPhase = numberOr(p.moonPhaseDeg, 45) * Math.PI / 180 + timeFreeOscillation(this.phase);
    const moonDistance = clamp(numberOr(p.moonDistance, 0.55), 0.05, 2.5) * 0.35;
    const moonRadius = clamp(numberOr(p.moonRadius, 0.025), 0.004, 0.08);

    const mx = planet.position[0] + Math.cos(moonPhase) * moonDistance;
    const my = planet.position[1] + Math.sin(moonPhase) * moonDistance * 0.50;
    const mz = planet.position[2] + Math.sin(moonPhase) * moonDistance * 0.55;

    const moon = {
      enabled: moonEnabled,
      position: [mx, my, mz],
      radius: moonRadius,
      front: mz >= 0
    };

    return { planet, moon };
  }

  drawStar(time, model, teff, colour) {
    const p = this.params;
    const spotBasis = computeSpotBasis(p);

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
        uSpotA: spotBasis.a,
        uSpotB: spotBasis.b,
        uSpotC: spotBasis.c,
        uSpotRadius: clamp(numberOr(p.spotRadius, 0.12), 0.01, 0.6),
        uSpotContrast: clamp(numberOr(p.spotContrast, 0.55), 0, 1)
      }
    });
  }

  drawStarGlow(time, glowColour) {
    const gl = this.gl;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);

    this.drawSphere({
      program: this.programs.glow,
      mesh: this.meshes.glowSphere,
      model: mat4Scale(mat4Identity(), [1.23, 1.23, 1.23]),
      uniforms: {
        uTime: time,
        uGlowColour: glowColour
      },
      transparent: true
    });

    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  drawPlanet(body) {
    this.drawBody(body, [0.045, 0.062, 0.078], [0.20, 0.47, 0.62], 1);
  }

  drawMoon(body) {
    if (!body.enabled) return;
    this.drawBody(body, [0.42, 0.42, 0.40], [0.88, 0.82, 0.70], 1);
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
        uAlpha: alpha
      }
    });
  }

  drawOrbitGuides() {
    const p = this.params;
    const inclination = numberOr(p.inclinationDeg, 88.5) * Math.PI / 180;
    const orbitRadius = 1.55;
    const flatten = Math.max(0.10, Math.abs(Math.cos(inclination)) * 3.2);

    const gl = this.gl;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);

    let model = mat4RotateX(mat4Identity(), Math.PI / 2);
    model = mat4Scale(model, [orbitRadius, orbitRadius, flatten]);

    this.drawLineMesh(this.meshes.orbit, model, [0.10, 0.42, 0.58], 0.26);

    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  drawTransitChord() {
    const gl = this.gl;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);

    this.drawLineMesh(this.meshes.chord, mat4Identity(), [0.15, 0.40, 0.55], 0.22);

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

function computeSpotBasis(params) {
  const x = clamp(numberOr(params.spotX, 0.2), -0.9, 0.9);
  const y = clamp(numberOr(params.spotY, 0.1), -0.9, 0.9);
  const z = Math.sqrt(Math.max(0.01, 1 - x * x - y * y));

  const a = normalize3([x, y, z]);
  const b = normalize3([x + 0.08, y - 0.035, z]);
  const c = normalize3([x - 0.055, y + 0.060, z]);

  return { a, b, c };
}

function stellarColour(teff) {
  if (teff < 3600) return [1.00, 0.43, 0.18];
  if (teff < 5200) return [1.00, 0.60, 0.25];
  if (teff < 6500) return [1.00, 0.75, 0.36];
  if (teff < 8500) return [0.85, 0.90, 1.00];
  return [0.62, 0.76, 1.00];
}

function stellarGlowColour(teff) {
  if (teff < 3600) return [1.00, 0.22, 0.05];
  if (teff < 5200) return [1.00, 0.34, 0.06];
  if (teff < 6500) return [1.00, 0.48, 0.08];
  if (teff < 8500) return [0.46, 0.72, 1.00];
  return [0.28, 0.52, 1.00];
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

function mat4RotateX(m, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const r = mat4Identity();

  r[5] = c;
  r[6] = s;
  r[9] = -s;
  r[10] = c;

  return mat4Multiply(m, r);
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

function indexOfMinimum(array) {
  if (!array || !array.length) return -1;

  let index = 0;
  let value = array[0];

  for (let i = 1; i < array.length; i++) {
    if (array[i] < value) {
      value = array[i];
      index = i;
    }
  }

  return index;
}

function timeFreeOscillation(phase) {
  return phase * TWO_PI * 5.0;
}
