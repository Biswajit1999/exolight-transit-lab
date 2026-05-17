const TWO_PI = Math.PI * 2;

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
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(uNormalMatrix * aNormal);
  vViewNormal = normalize((uView * vec4(vNormal, 0.0)).xyz);
  gl_Position = uProjection * uView * world;
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
uniform float uGranulationAmp;
uniform vec3 uHotColor;
uniform vec3 uCoolColor;

float hash(vec3 p){
  p = fract(p * 0.3183099 + 0.1);
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
  float amp = 0.55;

  for(int i = 0; i < 4; i++){
    value += amp * noise(p);
    p = p * 2.04 + vec3(3.7, 7.1, 5.3);
    amp *= 0.48;
  }

  return value;
}

void main(){
  vec3 n = normalize(vNormal);

  float mu = clamp(vViewNormal.z * 0.5 + 0.5, 0.0, 1.0);
  float q = 1.0 - mu;
  float limb = max(0.0, 1.0 - uU1 * q - uU2 * q * q);

  float granLarge = fbm(n * 13.0 + vec3(uTime * 0.018, -uTime * 0.012, uTime * 0.010));
  float granFine = fbm(n * 42.0 + vec3(-uTime * 0.030, uTime * 0.021, -uTime * 0.016));
  float cells = 0.62 * granLarge + 0.38 * granFine;

  float lane = smoothstep(0.34, 0.60, cells);
  float grain = 1.0 + uGranulationAmp * ((cells - 0.5) * 1.15 + (lane - 0.5) * 0.32);

  vec3 base = mix(uCoolColor, uHotColor, clamp(uTeffNorm, 0.0, 1.0));
  vec3 warmPhotosphere = mix(base, vec3(1.0, 0.62, 0.18), 0.16 + 0.10 * granLarge);
  vec3 edgeColor = mix(warmPhotosphere, vec3(0.95, 0.24, 0.055), pow(1.0 - mu, 1.8) * 0.42);

  vec3 color = edgeColor * limb * grain;
  color += vec3(1.0, 0.42, 0.08) * pow(1.0 - mu, 2.4) * 0.16;
  color = max(color, vec3(0.0));

  gl_FragColor = vec4(color, 1.0);
}`;

const GLOW_FRAGMENT_SHADER = `
precision highp float;

varying vec3 vViewNormal;

uniform float uTime;
uniform vec3 uGlowColor;

void main(){
  float mu = clamp(vViewNormal.z * 0.5 + 0.5, 0.0, 1.0);
  float rim = pow(1.0 - mu, 1.35);
  float outer = pow(1.0 - mu, 3.10);
  float pulse = 0.90 + 0.10 * sin(uTime * 0.65);

  vec3 color = uGlowColor * (0.55 + 0.45 * outer) * pulse;
  float alpha = clamp((rim * 0.34 + outer * 0.28) * pulse, 0.0, 0.70);

  gl_FragColor = vec4(color, alpha);
}`;

const BODY_FRAGMENT_SHADER = `
precision highp float;

varying vec3 vNormal;
varying vec3 vViewNormal;

uniform vec3 uColor;
uniform vec3 uRimColor;
uniform float uDarkness;
uniform float uAlpha;

void main(){
  vec3 n = normalize(vNormal);
  vec3 light = normalize(vec3(-0.65, 0.38, 0.95));

  float lambert = max(dot(n, light), 0.0);
  float mu = clamp(vViewNormal.z * 0.5 + 0.5, 0.0, 1.0);
  float rim = pow(1.0 - mu, 2.0);

  vec3 color = uColor * (0.08 + 0.92 * lambert) * (1.0 - uDarkness) + uRimColor * rim * 0.45;

  gl_FragColor = vec4(color, uAlpha);
}`;

const LINE_VERTEX_SHADER = `
attribute vec3 aPosition;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;

void main(){
  gl_Position = uProjection * uView * uModel * vec4(aPosition, 1.0);
}`;

const LINE_FRAGMENT_SHADER = `
precision highp float;

uniform vec3 uColor;
uniform float uAlpha;

void main(){
  gl_FragColor = vec4(uColor, uAlpha);
}`;

export class ObservatoryScene {
  constructor({ canvas, onStatus = () => {}, onWarn = () => {} } = {}) {
    this.canvas = canvas;
    this.onStatus = onStatus;
    this.onWarn = onWarn;
    this.gl = null;
    this.ctx2d = null;
    this.ready = false;
    this.safe2d = false;
    this.programs = {};
    this.meshes = {};
    this.curveSummary = null;
    this.lastFpsTime = performance.now();
    this.frameCounter = 0;
    this.fps = 0;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.35);

    this.camera = {
      eye: [0, 0, 5.55],
      target: [0, 0, 0],
      up: [0, 1, 0],
      fov: 39 * Math.PI / 180,
      near: 0.01,
      far: 100
    };

    this.view = mat4Identity();
    this.projection = mat4Identity();
  }

  async init() {
    if (!this.canvas) {
      throw new Error("Scene canvas not found");
    }

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

    this.meshes.sphere = createSphereMesh(gl, 80, 48);
    this.meshes.glowSphere = createSphereMesh(gl, 72, 42);
    this.meshes.orbit = createUnitCircleMesh(gl, 360);
    this.meshes.moonOrbit = createUnitCircleMesh(gl, 180);
    this.meshes.transitChord = createLineMesh(gl, [
      -1.08, 0.0, 0.022,
       1.08, 0.0, 0.022
    ]);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0, 0, 0, 0);

    this.resize();

    window.addEventListener("resize", () => this.resize(), { passive: true });

    this.canvas.addEventListener("webglcontextlost", event => {
      event.preventDefault();
      this.ready = false;
      this.onWarn("WebGL context lost. Reloading the page will reinitialise the GPU resources.");
    });

    this.ready = true;
    this.onStatus("Native WebGL observatory ready: renderer consumes the shared physics state vector.");
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(2, Math.floor(rect.width * this.pixelRatio));
    const height = Math.max(2, Math.floor(rect.height * this.pixelRatio));

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    if (this.gl) {
      this.gl.viewport(0, 0, width, height);
    }

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

  render({
    time = 0,
    phase = 0,
    visualPhase = 0,
    params = {},
    sample = {},
    moonState = {},
    target = null,
    systemState = null
  } = {}) {
    if (!this.ready) return;

    this.frameCounter += 1;

    const now = performance.now();

    if (now - this.lastFpsTime >= 500) {
      this.fps = Math.round(this.frameCounter * 1000 / (now - this.lastFpsTime));
      this.frameCounter = 0;
      this.lastFpsTime = now;
    }

    const state = systemState || this.makeFallbackSystemState(visualPhase, phase, params, sample, moonState);

    if (this.safe2d) {
      this.render2DSafe({ time, params, systemState: state });
      return;
    }

    const gl = this.gl;

    this.resize();
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const teff = Number.isFinite(target?.st_teff) ? target.st_teff : 5772;
    const colors = stellarColors(teff);

    const planetDisplay = this.projectPlanetToDisplay(state.planet, params);
    const moonDisplay = this.projectMoonToDisplay(state.moon, planetDisplay, params);

    this.drawBackgroundFrame(params, state);
    this.drawRearBodies(planetDisplay, moonDisplay);
    this.drawStarSolid(time, params, teff, colors);
    this.drawSpotComponents(state.spotComponents || []);
    this.drawStarGlow(time, colors);
    this.drawDepthAwareGuides(planetDisplay, moonDisplay, params, state);
    this.drawFrontBodies(planetDisplay, moonDisplay);
  }

  makeFallbackSystemState(visualPhase, phase, params, sample, moonState) {
    const orbitPhase = wrap01(Number.isFinite(visualPhase) ? visualPhase : 0);
    const theta = TWO_PI * orbitPhase;
    const inc = (params.inclinationDeg ?? 88.5) * Math.PI / 180;
    const aRs = Math.max(1.5, params.aRs || 12);

    const planet = {
      x: aRs * Math.sin(theta),
      y: -aRs * Math.cos(theta) * Math.cos(inc),
      z: aRs * Math.cos(theta) * Math.sin(inc),
      radius: clamp(params.rpRs ?? 0.1, 0.005, 0.28),
      front: Math.cos(theta) >= 0,
      theta,
      orbitPhase,
      distanceRs: aRs
    };

    const moon = {
      enabled: !!params.moonEnabled,
      x: moonState?.x ?? planet.x,
      y: moonState?.y ?? planet.y,
      z: moonState?.z ?? planet.z - 1,
      radius: clamp(params.moonRadius ?? 0.025, 0.004, 0.08),
      front: !!moonState?.front,
      label: moonState?.label || "DISABLED",
      vector: moonState?.vector || [0, 0, 0],
      orbitPhase
    };

    return {
      phase,
      transitPhase: phase,
      orbitPhase,
      rawOrbitPhase: orbitPhase,
      depthPpm: sample?.depthPpm || 0,
      planet,
      moon,
      spotComponents: []
    };
  }

  projectPlanetToDisplay(planet = {}, params = {}) {
    const orbitPhase = wrap01(planet.orbitPhase ?? 0);
    const theta = Number.isFinite(planet.theta) ? planet.theta : TWO_PI * orbitPhase;
    const inc = (params.inclinationDeg ?? 88.5) * Math.PI / 180;

    const radius = clamp(planet.radius ?? params.rpRs ?? 0.1, 0.005, 0.30);

    /*
      Important:
      The previous version blended between physical projected coordinates
      and a decorative schematic orbit. That caused visible snapping/bouncing
      near ingress and egress. This version uses one continuous visual orbit.
      The physics state still drives phase, depth, and front/back ordering.
    */

    const orbitRadius = 1.58;
    const orbitFlatten = Math.max(0.14, Math.abs(Math.cos(inc)) * 3.4);

    const x = orbitRadius * Math.sin(theta);
    const y = -orbitRadius * Math.cos(theta) * orbitFlatten;
    const z = 0.95 * Math.cos(theta) * Math.sin(inc);

    /*
      During the actual transit chord, gently lock the displayed y-position
      to the true impact parameter from physics.js. This keeps the crossing
      physically meaningful without switching the whole coordinate system.
    */

    const physicalY = finite(planet.y) ? clamp(planet.y, -1.0, 1.0) : y;
    const transitProximity = Math.abs(Math.sin(theta));
    const frontWeight = z > 0 ? 1 : 0;
    const transitLock = frontWeight * (1.0 - smoothstep(0.78, 1.18, transitProximity));
    const lockedY = y + (physicalY - y) * transitLock;

    return {
      position: [x, lockedY, z],
      physicalPosition: [
        finite(planet.x) ? planet.x : x,
        finite(planet.y) ? planet.y : physicalY,
        finite(planet.z) ? planet.z : z
      ],
      schematicPosition: [x, y, z],
      radius,
      front: planet.front !== undefined ? !!planet.front : z >= 0,
      theta,
      orbitPhase,
      source: planet
    };
  }

  projectMoonToDisplay(moon = {}, planetDisplay, params = {}) {
    const enabled = !!moon.enabled || !!params.moonEnabled;
    const radius = enabled ? clamp(moon.radius ?? params.moonRadius ?? 0.025, 0.004, 0.09) : 0;

    if (!enabled || radius <= 0) {
      return {
        enabled: false,
        position: [0, 0, -1],
        radius: 0,
        front: false,
        source: moon
      };
    }

    const vector = Array.isArray(moon.vector) ? moon.vector : [0, 0, 0];

    /*
      Keep the moon visually tied to the planet without using a second
      independent display orbit. The vector still comes from physics.js.
    */

    const scale = 0.34;

    const position = [
      planetDisplay.position[0] + vector[0] * scale,
      planetDisplay.position[1] + vector[1] * scale,
      planetDisplay.position[2] + vector[2] * scale
    ];

    return {
      enabled: true,
      position,
      physicalPosition: [
        finite(moon.x) ? moon.x : position[0],
        finite(moon.y) ? moon.y : position[1],
        finite(moon.z) ? moon.z : position[2]
      ],
      schematicPosition: position,
      radius,
      front: moon.front !== undefined ? !!moon.front : position[2] >= 0,
      source: moon
    };
  }

  drawBackgroundFrame(params, state) {
    const gl = this.gl;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);

    this.drawLineMesh(
      this.meshes.transitChord,
      mat4Translate(mat4Identity(), [0, this.computeTransitChordY(params), 0.040]),
      [0.0, 0.94, 1.0],
      0.055
    );

    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  computeTransitChordY(params) {
    const inc = (params.inclinationDeg ?? 88.5) * Math.PI / 180;
    const aRs = Math.max(1.5, params.aRs || 12);
    return clamp(-aRs * Math.cos(inc), -1.0, 1.0);
  }

  drawRearBodies(planet, moon) {
    const rear = [];

    if (!planet.front) {
      rear.push({
        position: planet.position,
        radius: planet.radius,
        color: [0.014, 0.030, 0.045],
        rim: [0.0, 0.92, 1.0],
        darkness: 0.08,
        alpha: 1
      });
    }

    if (moon.enabled && !moon.front) {
      rear.push({
        position: moon.position,
        radius: moon.radius,
        color: [0.105, 0.118, 0.13],
        rim: [1.0, 0.68, 0.08],
        darkness: 0.03,
        alpha: 1
      });
    }

    rear
      .sort((a, b) => a.position[2] - b.position[2])
      .forEach(body => this.drawBody(body));
  }

  drawFrontBodies(planet, moon) {
    const front = [];

    if (planet.front) {
      front.push({
        position: planet.position,
        radius: planet.radius,
        color: [0.014, 0.030, 0.045],
        rim: [0.0, 0.92, 1.0],
        darkness: 0.08,
        alpha: 1
      });
    }

    if (moon.enabled && moon.front) {
      front.push({
        position: moon.position,
        radius: moon.radius,
        color: [0.105, 0.118, 0.13],
        rim: [1.0, 0.68, 0.08],
        darkness: 0.03,
        alpha: 1
      });
    }

    front
      .sort((a, b) => a.position[2] - b.position[2])
      .forEach(body => this.drawBody(body));
  }

  drawStarSolid(time, params, teff, colors) {
    const model = mat4Scale(
      mat4RotateY(mat4Identity(), time * 0.026),
      [1, 1, 1]
    );

    this.drawSphere({
      program: this.programs.star,
      mesh: this.meshes.sphere,
      model,
      uniforms: {
        uTime: time,
        uU1: params.u1 ?? 0.32,
        uU2: params.u2 ?? 0.28,
        uTeffNorm: clamp((teff - 2500) / 8500, 0, 1),
        uGranulationAmp: 0.18,
        uHotColor: colors.hot,
        uCoolColor: colors.cool
      }
    });
  }

  drawStarGlow(time, colors) {
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
        uGlowColor: colors.glow
      },
      transparent: true
    });

    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  drawSpotComponents(components = []) {
    if (!Array.isArray(components) || !components.length) return;

    const gl = this.gl;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    for (const component of components) {
      const x = clamp(component.x ?? 0, -0.985, 0.985);
      const y = clamp(component.y ?? 0, -0.985, 0.985);
      const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));

      if (z <= 0) continue;

      const kind = String(component.kind || "");
      const opacity = clamp(component.opacity ?? 0.35, 0.04, 0.92);
      const isUmbra = kind.includes("umbra");

      const color = isUmbra
        ? [0.018, 0.008, 0.004]
        : [0.070, 0.030, 0.012];

      const rim = isUmbra
        ? [0.10, 0.025, 0.008]
        : [0.38, 0.10, 0.025];

      let model = mat4Translate(mat4Identity(), [x, y, z + (component.lift ?? 0.014)]);
      model = mat4RotateZ(model, component.angle ?? 0);
      model = mat4Scale(model, [
        Math.max(0.002, component.rx ?? 0.05),
        Math.max(0.002, component.ry ?? 0.03),
        0.004
      ]);

      this.drawSphere({
        program: this.programs.body,
        mesh: this.meshes.sphere,
        model,
        uniforms: {
          uColor: color,
          uRimColor: rim,
          uDarkness: 0.0,
          uAlpha: opacity
        },
        transparent: true
      });
    }

    gl.disable(gl.BLEND);
  }

  drawDepthAwareGuides(planet, moon, params, state) {
    const gl = this.gl;

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);

    this.drawOrbitGuide(params);

    if (moon.enabled) {
      this.drawMoonOrbitGuide(planet, params);
      this.drawHierarchyArm(planet.position, moon.position);
    }

    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  drawBody(body) {
    const model = mat4Scale(
      mat4Translate(mat4Identity(), body.position),
      [body.radius, body.radius, body.radius]
    );

    this.drawSphere({
      program: this.programs.body,
      mesh: this.meshes.sphere,
      model,
      uniforms: {
        uColor: body.color,
        uRimColor: body.rim,
        uDarkness: body.darkness,
        uAlpha: body.alpha ?? 1
      },
      transparent: body.alpha !== undefined && body.alpha < 1
    });
  }

  drawOrbitGuide(params) {
    const inc = (params.inclinationDeg ?? 88.5) * Math.PI / 180;
    const orbitRadius = 1.58;
    const visualFlatten = Math.max(0.14, Math.abs(Math.cos(inc)) * 3.4);

    let model = mat4RotateX(mat4Identity(), Math.PI / 2);
    model = mat4Scale(model, [orbitRadius, orbitRadius, visualFlatten]);

    this.drawLineMesh(this.meshes.orbit, model, [0.0, 0.94, 1.0], 0.18);
  }

  drawMoonOrbitGuide(planet, params) {
    const distance = clamp(params.moonDistance ?? 0.55, 0.05, 2.5) * 0.34;

    let model = mat4Translate(mat4Identity(), planet.position);
    model = mat4RotateZ(model, (params.moonNodeDeg ?? 35) * Math.PI / 180);
    model = mat4RotateX(model, (params.moonInclinationDeg ?? 12) * Math.PI / 180);
    model = mat4Scale(model, [distance, distance, distance]);

    this.drawLineMesh(this.meshes.moonOrbit, model, [1.0, 0.69, 0.0], 0.30);
  }

  drawHierarchyArm(a, b) {
    const mesh = createLineMesh(this.gl, [
      a[0], a[1], a[2],
      b[0], b[1], b[2]
    ]);

    this.drawLineMesh(mesh, mat4Identity(), [1.0, 0.69, 0.0], 0.22);
    this.gl.deleteBuffer(mesh.position);
  }

  drawSphere({ program, mesh, model, uniforms = {}, transparent = false }) {
    const gl = this.gl;
    const locations = useProgram(gl, program);

    bindMesh(gl, mesh, locations);

    setMat4(gl, locations.uModel, model);
    setMat4(gl, locations.uView, this.view);
    setMat4(gl, locations.uProjection, this.projection);
    setMat3(gl, locations.uNormalMatrix, normalMatrix(model));

    Object.entries(uniforms).forEach(([key, value]) => {
      setUniform(gl, locations[key], value);
    });

    if (transparent) {
      gl.disable(gl.CULL_FACE);
    }

    gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_SHORT, 0);

    if (transparent) {
      gl.enable(gl.CULL_FACE);
    }
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

  render2DSafe({ time, params, systemState }) {
    const ctx = this.ctx2d;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    const cx = w * 0.5;
    const cy = h * 0.5;
    const r = Math.min(w, h) * 0.245;

    const grad = ctx.createRadialGradient(
      cx - r * 0.25,
      cy - r * 0.3,
      r * 0.04,
      cx,
      cy,
      r
    );

    grad.addColorStop(0, "#fff6d8");
    grad.addColorStop(0.34, "#ffb000");
    grad.addColorStop(0.76, "#9a3500");
    grad.addColorStop(1, "rgba(255,176,0,0)");

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.18, 0, Math.PI * 2);
    ctx.fill();

    const planet = this.projectPlanetToDisplay(systemState?.planet, params);

    ctx.fillStyle = "#02070a";
    ctx.strokeStyle = "#00f0ff";
    ctx.lineWidth = 2 * this.pixelRatio;
    ctx.beginPath();
    ctx.arc(
      cx + planet.position[0] * r,
      cy - planet.position[1] * r,
      Math.max(5, planet.radius * r),
      0,
      Math.PI * 2
    );
    ctx.fill();
    ctx.stroke();
  }
}

function stellarColors(teff) {
  if (!Number.isFinite(teff)) teff = 5772;

  if (teff < 3300) {
    return {
      hot: [1.0, 0.56, 0.29],
      cool: [0.52, 0.10, 0.045],
      glow: [1.0, 0.26, 0.07]
    };
  }

  if (teff < 5000) {
    return {
      hot: [1.0, 0.74, 0.42],
      cool: [0.76, 0.27, 0.08],
      glow: [1.0, 0.43, 0.08]
    };
  }

  if (teff < 6500) {
    return {
      hot: [1.0, 0.86, 0.56],
      cool: [0.95, 0.47, 0.12],
      glow: [1.0, 0.58, 0.08]
    };
  }

  if (teff < 8500) {
    return {
      hot: [0.86, 0.95, 1.0],
      cool: [0.95, 0.67, 0.25],
      glow: [0.46, 0.88, 1.0]
    };
  }

  return {
    hot: [0.58, 0.78, 1.0],
    cool: [0.72, 0.82, 1.0],
    glow: [0.30, 0.68, 1.0]
  };
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

function createUnitCircleMesh(gl, points = 256) {
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
  } else if (Array.isArray(value) || value instanceof Float32Array) {
    if (value.length === 2) gl.uniform2fv(location, value);
    else if (value.length === 3) gl.uniform3fv(location, value);
    else if (value.length === 4) gl.uniform4fv(location, value);
    else if (value.length === 9) gl.uniformMatrix3fv(location, false, value);
    else if (value.length === 16) gl.uniformMatrix4fv(location, false, value);
  }
}

function setMat4(gl, location, matrix) {
  if (location) {
    gl.uniformMatrix4fv(location, false, matrix);
  }
}

function setMat3(gl, location, matrix) {
  if (location) {
    gl.uniformMatrix3fv(location, false, matrix);
  }
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
  const l = Math.hypot(v[0], v[1], v[2]) || 1;

  return [
    v[0] / l,
    v[1] / l,
    v[2] / l
  ];
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / Math.max(1e-9, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function wrap01(value) {
  let phase = Number(value) || 0;
  phase %= 1;

  if (phase < 0) {
    phase += 1;
  }

  return phase;
}

function finite(value) {
  return Number.isFinite(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
