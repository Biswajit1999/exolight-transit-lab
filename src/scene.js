const VERTEX_SHADER = `
attribute vec3 aPosition;
attribute vec3 aNormal;
uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;
uniform mat3 uNormalMatrix;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vViewNormal;
void main(){
  vec4 world=uModel*vec4(aPosition,1.0);
  vWorld=world.xyz;
  vNormal=normalize(uNormalMatrix*aNormal);
  vViewNormal=normalize((uView*vec4(vNormal,0.0)).xyz);
  gl_Position=uProjection*uView*world;
}`;

const STAR_FRAGMENT_SHADER = `
precision highp float;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vViewNormal;
uniform float uTime;
uniform float uU1;
uniform float uU2;
uniform float uTeffNorm;
uniform vec3 uHotColor;
uniform vec3 uCoolColor;

float hash(vec3 p){
  p=fract(p*0.3183099+.1);
  p*=17.0;
  return fract(p.x*p.y*p.z*(p.x+p.y+p.z));
}

float noise(vec3 p){
  vec3 i=floor(p);
  vec3 f=fract(p);
  f=f*f*(3.0-2.0*f);
  return mix(
    mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),
        mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
    mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
        mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),
    f.z);
}

float fbm(vec3 p){
  float v=0.0;
  float a=0.5;
  for(int i=0;i<5;i++){
    v+=a*noise(p);
    p=p*2.05+vec3(7.1,3.7,5.2);
    a*=0.52;
  }
  return v;
}

void main(){
  vec3 n=normalize(vNormal);
  float mu=clamp(vViewNormal.z*0.5+0.5,0.0,1.0);
  float q=1.0-mu;
  float limb=max(0.0,1.0-uU1*q-uU2*q*q);
  float cells=fbm(n*16.0+vec3(uTime*.055,uTime*.031,-uTime*.024));
  float lanes=fbm(n*42.0+vec3(-uTime*.08,uTime*.04,uTime*.025));
  float turb=0.78+0.34*cells+0.11*lanes;
  vec3 base=mix(uCoolColor,uHotColor,clamp(uTeffNorm,0.0,1.0));
  vec3 amber=vec3(1.0,.58,.08);
  vec3 color=mix(base,amber,0.18+0.15*cells)*limb*turb;
  float rim=pow(1.0-mu,2.4);
  color+=vec3(1.0,.55,.10)*rim*.38;
  gl_FragColor=vec4(color,1.0);
}`;

const GLOW_FRAGMENT_SHADER = `
precision highp float;
varying vec3 vViewNormal;
uniform float uTime;
uniform vec3 uGlowColor;
void main(){
  float mu=clamp(vViewNormal.z*0.5+0.5,0.0,1.0);
  float rim=pow(1.0-mu,1.8);
  float pulse=.86+.14*sin(uTime*1.7);
  gl_FragColor=vec4(uGlowColor*rim*pulse,rim*.48);
}`;

const BODY_FRAGMENT_SHADER = `
precision highp float;
varying vec3 vNormal;
varying vec3 vViewNormal;
uniform vec3 uColor;
uniform vec3 uRimColor;
uniform float uDarkness;
void main(){
  vec3 n=normalize(vNormal);
  vec3 light=normalize(vec3(-.7,.35,.9));
  float lambert=max(dot(n,light),0.0);
  float mu=clamp(vViewNormal.z*0.5+0.5,0.0,1.0);
  float rim=pow(1.0-mu,2.0);
  vec3 color=uColor*(0.10+0.90*lambert)*(1.0-uDarkness)+uRimColor*rim*.42;
  gl_FragColor=vec4(color,1.0);
}`;

const LINE_VERTEX_SHADER = `
attribute vec3 aPosition;
uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;
void main(){
  gl_Position=uProjection*uView*uModel*vec4(aPosition,1.0);
}`;

const LINE_FRAGMENT_SHADER = `
precision highp float;
uniform vec3 uColor;
uniform float uAlpha;
void main(){
  gl_FragColor=vec4(uColor,uAlpha);
}`;

export class ObservatoryScene {
  constructor({ canvas, onStatus = () => {}, onWarn = () => {} } = {}) {
    this.canvas = canvas;
    this.onStatus = onStatus;
    this.onWarn = onWarn;
    this.gl = null;
    this.ready = false;
    this.safe2d = false;
    this.programs = {};
    this.meshes = {};
    this.buffers = {};
    this.curveSummary = null;
    this.lastFpsTime = performance.now();
    this.frameCounter = 0;
    this.fps = 0;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.camera = {
      eye: [0, 0, 5.2],
      target: [0, 0, 0],
      up: [0, 1, 0],
      fov: 42 * Math.PI / 180,
      near: 0.01,
      far: 100
    };
    this.view = mat4Identity();
    this.projection = mat4Identity();
  }

  async init() {
    if (!this.canvas) throw new Error("Scene canvas not found");

    this.gl = this.canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      depth: true,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance"
    });

    if (!this.gl) {
      this.safe2d = true;
      this.ctx2d = this.canvas.getContext("2d");
      this.ready = true;
      this.onWarn("WebGL unavailable; 2D emergency renderer active.");
      return;
    }

    const gl = this.gl;
    this.programs.star = createProgram(gl, VERTEX_SHADER, STAR_FRAGMENT_SHADER);
    this.programs.glow = createProgram(gl, VERTEX_SHADER, GLOW_FRAGMENT_SHADER);
    this.programs.body = createProgram(gl, VERTEX_SHADER, BODY_FRAGMENT_SHADER);
    this.programs.line = createProgram(gl, LINE_VERTEX_SHADER, LINE_FRAGMENT_SHADER);
    this.meshes.sphere = createSphereMesh(gl, 72, 42);
    this.meshes.orbit = createUnitCircleMesh(gl, 256);
    this.meshes.axes = createLineMesh(gl, [
      -1.25, 0, 0, 1.25, 0, 0,
      0, -1.25, 0, 0, 1.25, 0
    ]);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0, 0, 0, 0);
    this.resize();
    window.addEventListener("resize", () => this.resize(), { passive: true });
    this.ready = true;
    this.onStatus("Native WebGL observatory ready.");
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(2, Math.floor(rect.width * this.pixelRatio));
    const height = Math.max(2, Math.floor(rect.height * this.pixelRatio));

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    if (this.gl) this.gl.viewport(0, 0, width, height);
    const aspect = width / Math.max(1, height);
    this.view = mat4LookAt(this.camera.eye, this.camera.target, this.camera.up);
    this.projection = mat4Perspective(this.camera.fov, aspect, this.camera.near, this.camera.far);
  }

  setCurveSummary(summary) {
    this.curveSummary = summary;
  }

  getFPS() {
    return this.fps;
  }

  render({ time = 0, phase = 0, params = {}, sample = {}, moonState = {}, target = null } = {}) {
    if (!this.ready) return;

    this.frameCounter += 1;
    const now = performance.now();
    if (now - this.lastFpsTime >= 500) {
      this.fps = Math.round(this.frameCounter * 1000 / (now - this.lastFpsTime));
      this.frameCounter = 0;
      this.lastFpsTime = now;
    }

    if (this.safe2d) {
      this.render2DSafe({ time, phase, params, sample, moonState, target });
      return;
    }

    const gl = this.gl;
    this.resize();
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const teff = Number.isFinite(target?.st_teff) ? target.st_teff : 5772;
    const starColors = stellarColors(teff);
    const planet = sample.planet || this.computeFallbackPlanet(phase, params);
    const moon = sample.moon || moonState || {};
    const sceneScale = 1.0;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);
    this.drawSphere({
      program: this.programs.glow,
      mesh: this.meshes.sphere,
      model: mat4Scale(mat4Identity(), [1.22, 1.22, 1.22]),
      uniforms: {
        uTime: time,
        uGlowColor: starColors.glow
      },
      transparent: true
    });
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    this.drawSphere({
      program: this.programs.star,
      mesh: this.meshes.sphere,
      model: mat4Scale(mat4RotateY(mat4Identity(), time * 0.035), [1, 1, 1]),
      uniforms: {
        uTime: time,
        uU1: params.u1 ?? 0.32,
        uU2: params.u2 ?? 0.28,
        uTeffNorm: clamp((teff - 2500) / 8500, 0, 1),
        uHotColor: starColors.hot,
        uCoolColor: starColors.cool
      }
    });

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);
    this.drawOrbitGuide(planet, params, time);
    if (params.moonEnabled) this.drawMoonOrbitGuide(planet, params, time, phase);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    this.drawAxes();

    const frontBodies = [];
    const rearBodies = [];

    const planetBody = {
      position: [planet.x * sceneScale, planet.y * sceneScale, planet.z * 0.12],
      radius: Math.max(0.025, planet.radius || params.rpRs || 0.1),
      color: [0.018, 0.035, 0.048],
      rim: [0.0, 0.92, 1.0],
      darkness: 0.18,
      front: planet.front !== false
    };

    if (planetBody.front) frontBodies.push(planetBody);
    else rearBodies.push(planetBody);

    if (params.moonEnabled && moon.enabled !== false) {
      const moonBody = {
        position: [
          Number.isFinite(moon.x) ? moon.x * sceneScale : planet.x + 0.45,
          Number.isFinite(moon.y) ? moon.y * sceneScale : planet.y,
          Number.isFinite(moon.z) ? moon.z * 0.12 : planet.z * 0.12 + 0.08
        ],
        radius: Math.max(0.012, moon.radius || params.moonRadius || 0.025),
        color: [0.11, 0.125, 0.135],
        rim: [1.0, 0.68, 0.08],
        darkness: 0.08,
        front: moon.front !== false
      };
      if (moonBody.front) frontBodies.push(moonBody);
      else rearBodies.push(moonBody);
      this.drawHierarchyArm(planetBody.position, moonBody.position);
    }

    rearBodies.sort((a, b) => a.position[2] - b.position[2]).forEach(body => this.drawBody(body));
    frontBodies.sort((a, b) => a.position[2] - b.position[2]).forEach(body => this.drawBody(body));

    if (params.spotEnabled) this.drawStarspot(params, time);
  }

  drawSphere({ program, mesh, model, uniforms = {}, transparent = false }) {
    const gl = this.gl;
    const locations = useProgram(gl, program);

    bindMesh(gl, mesh, locations);
    setMat4(gl, locations.uModel, model);
    setMat4(gl, locations.uView, this.view);
    setMat4(gl, locations.uProjection, this.projection);
    setMat3(gl, locations.uNormalMatrix, normalMatrix(model));

    Object.entries(uniforms).forEach(([key, value]) => setUniform(gl, locations[key], value));

    if (transparent) gl.disable(gl.CULL_FACE);
    gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_SHORT, 0);
    if (transparent) gl.enable(gl.CULL_FACE);
  }

  drawBody(body) {
    const model = mat4Translate(mat4Identity(), body.position);
    const scaled = mat4Scale(model, [body.radius, body.radius, body.radius]);
    this.drawSphere({
      program: this.programs.body,
      mesh: this.meshes.sphere,
      model: scaled,
      uniforms: {
        uColor: body.color,
        uRimColor: body.rim,
        uDarkness: body.darkness
      }
    });
  }

  drawStarspot(params, time) {
    const z = Math.sqrt(Math.max(0, 1 - params.spotX * params.spotX - params.spotY * params.spotY));
    if (z <= 0) return;
    const radius = Math.max(0.01, params.spotRadius);
    const model = mat4Scale(mat4Translate(mat4Identity(), [params.spotX, params.spotY, z + 0.006]), [radius, radius, 0.004]);
    this.drawSphere({
      program: this.programs.body,
      mesh: this.meshes.sphere,
      model,
      uniforms: {
        uColor: [0.035, 0.012, 0.006],
        uRimColor: [1.0, 0.35, 0.05],
        uDarkness: 0.0
      }
    });
  }

  drawOrbitGuide(planet, params, time) {
    const a = Math.min(2.15, Math.max(1.05, (params.aRs || 12) / 8));
    const b = Math.max(0.07, a * Math.cos((params.inclinationDeg || 88.5) * Math.PI / 180));
    const model = mat4Scale(mat4RotateX(mat4Identity(), Math.PI / 2), [a, a, b]);
    this.drawLineMesh(this.meshes.orbit, model, [0.0, 0.94, 1.0], 0.22);
  }

  drawMoonOrbitGuide(planet, params, time, phase) {
    const d = params.moonDistance || 0.55;
    let model = mat4Translate(mat4Identity(), [planet.x || 0, planet.y || 0, (planet.z || 0) * 0.12]);
    model = mat4RotateZ(model, (params.moonNodeDeg || 0) * Math.PI / 180);
    model = mat4RotateX(model, (params.moonInclinationDeg || 0) * Math.PI / 180);
    model = mat4Scale(model, [d, d, d]);
    this.drawLineMesh(this.meshes.orbit, model, [1.0, 0.69, 0.0], 0.32);
  }

  drawAxes() {
    this.drawLineMesh(this.meshes.axes, mat4Identity(), [0.0, 0.94, 1.0], 0.12);
  }

  drawHierarchyArm(a, b) {
    const mesh = createLineMesh(this.gl, [a[0], a[1], a[2], b[0], b[1], b[2]]);
    this.drawLineMesh(mesh, mat4Identity(), [1.0, 0.69, 0.0], 0.45);
    this.gl.deleteBuffer(mesh.position);
  }

  drawLineMesh(mesh, model, color, alpha) {
    const gl = this.gl;
    const locations = useProgram(gl, this.programs.line);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.position);
    gl.enableVertexAttribArray(locations.aPosition);
    gl.vertexAttribPointer(locations.aPosition, 3, gl.FLOAT, false, 0, 0);
    setMat4(gl, locations.uModel, model);
    setMat4(gl, locations.uView, this.view);
    setMat4(gl, locations.uProjection, this.projection);
    setUniform(gl, locations.uColor, color);
    setUniform(gl, locations.uAlpha, alpha);
    gl.drawArrays(gl.LINES, 0, mesh.vertexCount);
  }

  render2DSafe({ time, phase, params, sample, moonState, target }) {
    const ctx = this.ctx2d;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    const cx = w * 0.5;
    const cy = h * 0.5;
    const r = Math.min(w, h) * 0.245;
    const grad = ctx.createRadialGradient(cx - r * .25, cy - r * .3, r * .04, cx, cy, r);
    grad.addColorStop(0, "#fff6d8");
    grad.addColorStop(.34, "#ffb000");
    grad.addColorStop(.76, "#9a3500");
    grad.addColorStop(1, "rgba(255,176,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.18, 0, Math.PI * 2);
    ctx.fill();

    const p = sample.planet || this.computeFallbackPlanet(phase, params);
    ctx.fillStyle = "#02070a";
    ctx.strokeStyle = "#00f0ff";
    ctx.lineWidth = 2 * this.pixelRatio;
    ctx.beginPath();
    ctx.arc(cx + p.x * r, cy - p.y * r, Math.max(5, p.radius * r), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (params.moonEnabled) {
      const m = sample.moon || moonState;
      ctx.fillStyle = "#14191f";
      ctx.strokeStyle = "#ffb000";
      ctx.beginPath();
      ctx.arc(cx + (m.x || p.x + .42) * r, cy - (m.y || p.y) * r, Math.max(3, (m.radius || params.moonRadius) * r), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  computeFallbackPlanet(phase, params) {
    const theta = Math.PI * 2 * phase;
    const inc = (params.inclinationDeg || 88.5) * Math.PI / 180;
    const r = params.aRs || 12;
    return {
      x: r * Math.sin(theta),
      y: -r * Math.cos(theta) * Math.cos(inc),
      z: r * Math.cos(theta) * Math.sin(inc),
      radius: params.rpRs || 0.1,
      front: r * Math.cos(theta) * Math.sin(inc) > 0
    };
  }
}

function stellarColors(teff) {
  if (!Number.isFinite(teff)) teff = 5772;
  if (teff < 3300) {
    return { hot: [1.0, .57, .30], cool: [.55, .12, .05], glow: [1.0, .28, .08] };
  }
  if (teff < 5000) {
    return { hot: [1.0, .74, .42], cool: [.78, .28, .08], glow: [1.0, .43, .08] };
  }
  if (teff < 6500) {
    return { hot: [1.0, .86, .56], cool: [.95, .47, .12], glow: [1.0, .58, .08] };
  }
  if (teff < 8500) {
    return { hot: [.86, .95, 1.0], cool: [.95, .67, .25], glow: [.46, .88, 1.0] };
  }
  return { hot: [.58, .78, 1.0], cool: [.72, .82, 1.0], glow: [.30, .68, 1.0] };
}

function createProgram(gl, vsSource, fsSource) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || "Unknown WebGL program link error";
    gl.deleteProgram(program);
    throw new Error(message);
  }

  gl.deleteShader(vs);
  gl.deleteShader(fs);
  program._locations = {};
  return program;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "Unknown WebGL shader compile error";
    gl.deleteShader(shader);
    throw new Error(message);
  }

  return shader;
}

function useProgram(gl, program) {
  gl.useProgram(program);
  if (program._cached) return program._locations;

  const loc = program._locations;
  const attribs = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < attribs; i++) {
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

function createSphereMesh(gl, segments = 64, rings = 32) {
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
      const theta = u * Math.PI * 2;
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);
      const nx = cosTheta * sinPhi;
      const ny = cosPhi;
      const nz = sinTheta * sinPhi;
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

function createUnitCircleMesh(gl, points = 256) {
  const data = [];
  for (let i = 0; i < points; i++) {
    const a = i / points * Math.PI * 2;
    const b = (i + 1) / points * Math.PI * 2;
    data.push(Math.cos(a), Math.sin(a), 0, Math.cos(b), Math.sin(b), 0);
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

  if (mesh.index) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.index);
}

function setUniform(gl, location, value) {
  if (location === null || location === undefined) return;

  if (typeof value === "number") {
    gl.uniform1f(location, value);
  } else if (Array.isArray(value) || value instanceof Float32Array) {
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

function mat4RotateZ(m, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const r = mat4Identity();
  r[0] = c;
  r[1] = s;
  r[4] = -s;
  r[5] = c;
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
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
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
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
