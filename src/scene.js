import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";

const QUALITY_PRESETS = {
  low: {
    pixelRatio: 1.0,
    starSegments: 80,
    planetSegments: 48,
    starfieldCount: 700,
    coronaStrength: 0.34,
    animationRate: 0.7,
    detailScale: 0.85
  },
  balanced: {
    pixelRatio: Math.min(window.devicePixelRatio || 1, 1.4),
    starSegments: 120,
    planetSegments: 72,
    starfieldCount: 1200,
    coronaStrength: 0.48,
    animationRate: 1.0,
    detailScale: 1.0
  },
  high: {
    pixelRatio: Math.min(window.devicePixelRatio || 1, 1.75),
    starSegments: 160,
    planetSegments: 88,
    starfieldCount: 1800,
    coronaStrength: 0.60,
    animationRate: 1.12,
    detailScale: 1.16
  },
  ultra: {
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2.2),
    starSegments: 224,
    planetSegments: 112,
    starfieldCount: 2600,
    coronaStrength: 0.80,
    animationRate: 1.35,
    detailScale: 1.34
  }
};

const DEFAULT_TARGET = {
  pl_name: "Demo b",
  hostname: "Demo",
  st_teff: 5400,
  st_rad: 1.0,
  st_mass: 1.0,
  pl_ratror: 0.12,
  pl_orbper: 3.0,
  pl_orbincl: 87.5,
  pl_orbeccen: 0.0
};

const DEFAULT_STATE = {
  phase: 0.0,
  inclinationDeg: 87.5,
  scaledDistance: 8.0,
  radiusRatio: 0.12,
  eccentricity: 0.0,
  limbU1: 0.32,
  limbU2: 0.28,
  starspotEnabled: false,
  starspotX: 0.20,
  starspotY: 0.10,
  starspotRadius: 0.12,
  starspotContrast: 0.55,
  moonEnabled: false,
  moonRadius: 0.024,
  moonDistance: 0.60,
  moonPhaseDeg: 45,
  visualQuality: "balanced",
  theme: "dark"
};

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

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

function normalizeQualityName(name) {
  const v = String(name || "balanced").trim().toLowerCase();
  if (QUALITY_PRESETS[v]) return v;
  return "balanced";
}

function kelvinToSRGB(kelvin) {
  const temp = clamp(kelvin, 1800, 40000) / 100;

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

  return new THREE.Color(
    clamp(red, 0, 255) / 255,
    clamp(green, 0, 255) / 255,
    clamp(blue, 0, 255) / 255
  );
}

function temperatureToPalette(teff) {
  const t = clamp(Number(teff) || 5400, 2400, 12000);

  const base = kelvinToSRGB(t);
  const accent = kelvinToSRGB(clamp(t * 1.08, 2600, 15000));
  const corona = kelvinToSRGB(clamp(t * 1.15, 2800, 18000));

  // keep cooler stars more golden/orange rather than chalk white
  if (t < 5000) {
    base.offsetHSL(0.02, 0.08, -0.02);
    accent.offsetHSL(0.01, 0.12, 0.05);
    corona.offsetHSL(0.01, 0.06, 0.14);
  } else if (t > 7000) {
    base.offsetHSL(-0.02, -0.06, 0.03);
    accent.offsetHSL(-0.025, -0.08, 0.08);
    corona.offsetHSL(-0.03, -0.10, 0.16);
  } else {
    base.offsetHSL(0.0, 0.03, 0.0);
    accent.offsetHSL(0.0, 0.05, 0.07);
    corona.offsetHSL(0.0, 0.03, 0.16);
  }

  return { base, accent, corona };
}

function createPlanetTexture(size = 512, hue = 0.56, sat = 0.48, light = 0.34) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#0e1726";
  ctx.fillRect(0, 0, size, size);

  const gradient = ctx.createRadialGradient(
    size * 0.35,
    size * 0.30,
    size * 0.05,
    size * 0.50,
    size * 0.50,
    size * 0.60
  );

  const c1 = new THREE.Color().setHSL(hue, sat * 0.8, light * 1.25);
  const c2 = new THREE.Color().setHSL(hue, sat, light);
  const c3 = new THREE.Color().setHSL(hue + 0.02, sat * 0.55, light * 0.55);

  gradient.addColorStop(0, `#${c1.getHexString()}`);
  gradient.addColorStop(0.56, `#${c2.getHexString()}`);
  gradient.addColorStop(1, `#${c3.getHexString()}`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  ctx.globalAlpha = 0.18;
  for (let i = 0; i < 22; i += 1) {
    const y = (i / 21) * size;
    const amp = 10 + Math.random() * 18;
    const thickness = 8 + Math.random() * 12;
    const color = new THREE.Color().setHSL(
      hue + (Math.random() - 0.5) * 0.05,
      sat * (0.6 + Math.random() * 0.4),
      light * (0.7 + Math.random() * 0.6)
    );

    ctx.strokeStyle = `#${color.getHexString()}`;
    ctx.lineWidth = thickness;
    ctx.beginPath();

    for (let x = 0; x <= size; x += 8) {
      const yy = y + Math.sin((x / size) * Math.PI * 2 * (1.4 + Math.random() * 1.2)) * amp;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }

  ctx.globalAlpha = 0.10;
  for (let i = 0; i < 900; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = Math.random() * 2.4 + 0.4;
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.16})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  return tex;
}

function createMoonTexture(size = 256) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  const gradient = ctx.createRadialGradient(
    size * 0.35,
    size * 0.3,
    size * 0.08,
    size * 0.5,
    size * 0.5,
    size * 0.56
  );

  gradient.addColorStop(0, "#f2ead5");
  gradient.addColorStop(0.6, "#bfa98d");
  gradient.addColorStop(1, "#5f5348");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  ctx.globalAlpha = 0.2;
  for (let i = 0; i < 260; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 2 + Math.random() * 10;
    ctx.fillStyle = `rgba(80,60,45,${0.08 + Math.random() * 0.16})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeStarField(count) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    const radius = 50 + Math.random() * 160;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);

    const x = radius * Math.sin(phi) * Math.cos(theta);
    const y = radius * Math.sin(phi) * Math.sin(theta);
    const z = -20 - Math.random() * 150;

    positions[i * 3 + 0] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    const tone = 0.72 + Math.random() * 0.28;
    const warmth = Math.random();

    const color = new THREE.Color();
    color.setRGB(
      tone,
      lerp(tone * 0.94, tone, warmth),
      lerp(tone * 1.05, tone * 0.86, warmth)
    );

    colors[i * 3 + 0] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;

    sizes[i] = Math.random() * 1.8 + 0.5;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.PointsMaterial({
    size: 0.26,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  return new THREE.Points(geometry, material);
}

const STAR_VERTEX_SHADER = `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vLocalPos;
varying vec2 vUv;

void main() {
  vUv = uv;
  vLocalPos = position;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const STAR_FRAGMENT_SHADER = `
uniform float uTime;
uniform float uStarRadius;
uniform float uDetailScale;
uniform float uAnimationRate;
uniform float uLimbU1;
uniform float uLimbU2;
uniform vec3 uBaseColor;
uniform vec3 uAccentColor;
uniform vec3 uCoronaColor;

uniform float uSpotEnabled;
uniform float uSpotX;
uniform float uSpotY;
uniform float uSpotRadius;
uniform float uSpotContrast;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vLocalPos;
varying vec2 vUv;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + .1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
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
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;
  for (int i = 0; i < 6; i++) {
    value += amplitude * noise(p * frequency);
    frequency *= 2.02;
    amplitude *= 0.53;
  }
  return value;
}

float circularMask(float radius, float feather, float distValue) {
  return 1.0 - smoothstep(radius, radius + feather, distValue);
}

void main() {
  vec3 normal = normalize(vWorldNormal);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float mu = max(dot(normal, viewDir), 0.0);

  float limb = 1.0 - uLimbU1 * (1.0 - mu) - uLimbU2 * pow(1.0 - mu, 2.0);
  limb = clamp(limb, 0.08, 1.2);

  vec3 sphereP = normalize(vLocalPos);
  float time = uTime * uAnimationRate;

  vec3 p1 = sphereP * (5.0 * uDetailScale) + vec3(time * 0.030, 0.0, time * 0.018);
  vec3 p2 = sphereP * (10.0 * uDetailScale) + vec3(-time * 0.022, time * 0.026, 0.0);
  vec3 p3 = sphereP * (18.0 * uDetailScale) + vec3(time * 0.040, -time * 0.013, time * 0.020);

  float g1 = fbm(p1);
  float g2 = fbm(p2);
  float g3 = fbm(p3);

  float granules = smoothstep(0.38, 0.75, g1 + g2 * 0.55);
  float fine = smoothstep(0.35, 0.80, g3);
  float mottling = mix(0.84, 1.24, granules) * mix(0.92, 1.11, fine);

  vec2 disk = vLocalPos.xy / uStarRadius;
  vec2 hotCenter = vec2(-0.12, 0.10);
  float hot = exp(-3.2 * dot(disk - hotCenter, disk - hotCenter));

  float spotDarkening = 1.0;
  if (uSpotEnabled > 0.5 && mu > 0.0) {
    vec2 d = disk - vec2(uSpotX, uSpotY);
    float distort = fbm(vec3(d * 18.0, time * 0.05));
    float distValue = length(d) * (0.92 + distort * 0.42);

    float penumbra = circularMask(uSpotRadius, uSpotRadius * 0.28, distValue);
    float umbra = circularMask(uSpotRadius * 0.58, uSpotRadius * 0.18, distValue);

    float irregular = smoothstep(0.24, 0.82, fbm(vec3(d * 28.0, time * 0.03)));
    float spotMask = max(umbra, penumbra * 0.66) * irregular;

    spotDarkening = 1.0 - uSpotContrast * (0.52 * penumbra + 0.28 * umbra) * irregular;
    spotDarkening = clamp(spotDarkening, 0.15, 1.0);
  }

  vec3 base = mix(uBaseColor * 0.84, uAccentColor * 1.10, hot * 0.75);
  vec3 color = base * mottling * limb * spotDarkening;

  float rimGlow = pow(1.0 - mu, 2.05);
  color += uCoronaColor * rimGlow * 0.13;

  color = max(color, vec3(0.0));
  gl_FragColor = vec4(color, 1.0);
}
`;

const CORONA_VERTEX_SHADER = `
varying vec3 vNormalW;
varying vec3 vWorldPos;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const CORONA_FRAGMENT_SHADER = `
uniform float uTime;
uniform vec3 uCoronaColor;
uniform float uStrength;

varying vec3 vNormalW;
varying vec3 vWorldPos;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + .1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
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

void main() {
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float fresnel = pow(1.0 - max(dot(normalize(vNormalW), viewDir), 0.0), 2.6);

  vec3 p = normalize(vWorldPos) * 10.0 + vec3(uTime * 0.015, 0.0, uTime * 0.02);
  float n = noise(p) * 0.5 + noise(p * 2.3) * 0.25;
  float alpha = fresnel * (0.22 + n * 0.28) * uStrength;

  gl_FragColor = vec4(uCoronaColor, alpha);
}
`;

class ExoSceneRenderer {
  constructor(container, options = {}) {
    if (!container) {
      throw new Error("ExoSceneRenderer requires a DOM container.");
    }

    this.container = container;
    this.options = options;

    this.target = { ...DEFAULT_TARGET };
    this.state = { ...DEFAULT_STATE };
    this.qualityName = normalizeQualityName(options.visualQuality || "balanced");
    this.quality = QUALITY_PRESETS[this.qualityName];

    this.clock = new THREE.Clock();
    this.destroyed = false;

    this.starRadius = 3.55;
    this.sceneTime = 0;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 500);
    this.camera.position.set(0, 0.65, 18.5);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance"
    });

    this.renderer.setPixelRatio(this.quality.pixelRatio);
    this.renderer.setSize(container.clientWidth || 800, container.clientHeight || 500, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.physicallyCorrectLights = true;
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.display = "block";
    container.innerHTML = "";
    container.appendChild(this.renderer.domElement);

    this.rootGroup = new THREE.Group();
    this.scene.add(this.rootGroup);

    this.starRoot = new THREE.Group();
    this.rootGroup.add(this.starRoot);

    this.planetRoot = new THREE.Group();
    this.rootGroup.add(this.planetRoot);

    this.moonRoot = new THREE.Group();
    this.rootGroup.add(this.moonRoot);

    this.orbitRoot = new THREE.Group();
    this.rootGroup.add(this.orbitRoot);

    this.scene.add(this.createLights());
    this.starField = null;

    this.planetMesh = null;
    this.planetAtmosphere = null;
    this.moonMesh = null;
    this.starMesh = null;
    this.coronaMesh = null;
    this.orbitLine = null;
    this.moonOrbitLine = null;

    this.planetTexture = createPlanetTexture();
    this.moonTexture = createMoonTexture();

    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(this.container);

    this.setVisualQuality(this.qualityName);
    this.setTarget(this.target);
    this.setSceneState(this.state);

    this.animate = this.animate.bind(this);
    this.animationHandle = requestAnimationFrame(this.animate);
  }

  createLights() {
    const group = new THREE.Group();

    const ambient = new THREE.AmbientLight(0x6b7a96, 0.28);
    group.add(ambient);

    this.keyLight = new THREE.PointLight(0xffd9b0, 8.2, 80, 2);
    this.keyLight.position.set(0, 0, 0);
    group.add(this.keyLight);

    const fill = new THREE.DirectionalLight(0x7ba3ff, 0.28);
    fill.position.set(-8, 6, 8);
    group.add(fill);

    return group;
  }

  setTheme(themeName = "dark") {
    this.state.theme = themeName === "light" ? "light" : "dark";

    if (this.state.theme === "light") {
      this.scene.background = new THREE.Color(0xf4f7fb);
      this.renderer.toneMappingExposure = 1.04;
    } else {
      this.scene.background = new THREE.Color(0x041126);
      this.renderer.toneMappingExposure = 1.12;
    }
  }

  setVisualQuality(name = "balanced") {
    this.qualityName = normalizeQualityName(name);
    this.quality = QUALITY_PRESETS[this.qualityName];
    this.state.visualQuality = this.qualityName;

    this.renderer.setPixelRatio(this.quality.pixelRatio);

    if (this.starField) {
      this.scene.remove(this.starField);
      this.starField.geometry.dispose();
      this.starField.material.dispose();
      this.starField = null;
    }

    this.starField = makeStarField(this.quality.starfieldCount);
    this.scene.add(this.starField);

    this.rebuildBodies();
    this.resize();
  }

  rebuildBodies() {
    while (this.starRoot.children.length) {
      const child = this.starRoot.children.pop();
      this.disposeObject(child);
    }

    while (this.planetRoot.children.length) {
      const child = this.planetRoot.children.pop();
      this.disposeObject(child);
    }

    while (this.moonRoot.children.length) {
      const child = this.moonRoot.children.pop();
      this.disposeObject(child);
    }

    while (this.orbitRoot.children.length) {
      const child = this.orbitRoot.children.pop();
      this.disposeObject(child);
    }

    this.buildStar();
    this.buildPlanet();
    this.buildMoon();
    this.buildOrbitLine();
    this.buildMoonOrbitLine();
  }

  buildStar() {
    const palette = temperatureToPalette(this.target.st_teff || 5400);

    const starGeometry = new THREE.SphereGeometry(
      this.starRadius,
      this.quality.starSegments,
      this.quality.starSegments
    );

    this.starUniforms = {
      uTime: { value: 0 },
      uStarRadius: { value: this.starRadius },
      uDetailScale: { value: this.quality.detailScale },
      uAnimationRate: { value: this.quality.animationRate },
      uLimbU1: { value: this.state.limbU1 },
      uLimbU2: { value: this.state.limbU2 },
      uBaseColor: { value: palette.base.clone() },
      uAccentColor: { value: palette.accent.clone() },
      uCoronaColor: { value: palette.corona.clone() },
      uSpotEnabled: { value: this.state.starspotEnabled ? 1 : 0 },
      uSpotX: { value: this.state.starspotX },
      uSpotY: { value: this.state.starspotY },
      uSpotRadius: { value: this.state.starspotRadius },
      uSpotContrast: { value: this.state.starspotContrast }
    };

    const starMaterial = new THREE.ShaderMaterial({
      uniforms: this.starUniforms,
      vertexShader: STAR_VERTEX_SHADER,
      fragmentShader: STAR_FRAGMENT_SHADER
    });

    this.starMesh = new THREE.Mesh(starGeometry, starMaterial);
    this.starMesh.position.set(0, 0, 0);
    this.starMesh.castShadow = false;
    this.starMesh.receiveShadow = false;
    this.starRoot.add(this.starMesh);

    const coronaGeometry = new THREE.SphereGeometry(
      this.starRadius * 1.18,
      Math.max(64, Math.floor(this.quality.starSegments * 0.75)),
      Math.max(64, Math.floor(this.quality.starSegments * 0.75))
    );

    this.coronaUniforms = {
      uTime: { value: 0 },
      uCoronaColor: { value: palette.corona.clone() },
      uStrength: { value: this.quality.coronaStrength }
    };

    const coronaMaterial = new THREE.ShaderMaterial({
      uniforms: this.coronaUniforms,
      vertexShader: CORONA_VERTEX_SHADER,
      fragmentShader: CORONA_FRAGMENT_SHADER,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide
    });

    this.coronaMesh = new THREE.Mesh(coronaGeometry, coronaMaterial);
    this.starRoot.add(this.coronaMesh);
  }

  buildPlanet() {
    const planetRadius = clamp(this.starRadius * (this.state.radiusRatio || 0.12), 0.20, this.starRadius * 0.55);

    const planetGeometry = new THREE.SphereGeometry(
      planetRadius,
      this.quality.planetSegments,
      this.quality.planetSegments
    );

    const material = new THREE.MeshPhysicalMaterial({
      map: this.planetTexture,
      roughness: 0.9,
      metalness: 0.0,
      clearcoat: 0.0,
      reflectivity: 0.06,
      transmission: 0.0,
      color: new THREE.Color(0x8bc8ff)
    });

    this.planetMesh = new THREE.Mesh(planetGeometry, material);
    this.planetRoot.add(this.planetMesh);

    const atmoGeometry = new THREE.SphereGeometry(
      planetRadius * 1.04,
      this.quality.planetSegments,
      this.quality.planetSegments
    );

    const atmoMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0x50c6df) },
        uStrength: { value: 0.22 }
      },
      vertexShader: `
        varying vec3 vNormalW;
        varying vec3 vWorldPos;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          vNormalW = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uStrength;
        varying vec3 vNormalW;
        varying vec3 vWorldPos;
        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float fresnel = pow(1.0 - max(dot(normalize(vNormalW), viewDir), 0.0), 3.4);
          float alpha = fresnel * uStrength;
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide
    });

    this.planetAtmosphere = new THREE.Mesh(atmoGeometry, atmoMaterial);
    this.planetRoot.add(this.planetAtmosphere);
  }

  buildMoon() {
    const moonRadius = clamp(this.starRadius * (this.state.moonRadius || 0.025), 0.06, this.starRadius * 0.18);

    const moonGeometry = new THREE.SphereGeometry(
      moonRadius,
      Math.max(32, Math.floor(this.quality.planetSegments * 0.7)),
      Math.max(32, Math.floor(this.quality.planetSegments * 0.7))
    );

    const moonMaterial = new THREE.MeshStandardMaterial({
      map: this.moonTexture,
      roughness: 1.0,
      metalness: 0.0,
      color: new THREE.Color(0xd9c8ae)
    });

    this.moonMesh = new THREE.Mesh(moonGeometry, moonMaterial);
    this.moonRoot.add(this.moonMesh);
  }

  buildOrbitLine() {
    const curvePoints = [];
    const radius = this.computeOrbitRadius();
    const inclination = toRadians(this.state.inclinationDeg || this.state.pl_orbincl || 87.5);

    for (let i = 0; i <= 256; i += 1) {
      const theta = (i / 256) * Math.PI * 2;
      const x = radius * Math.sin(theta);
      const y = radius * Math.cos(theta) * Math.cos(inclination) * 0.95;
      const z = radius * Math.cos(theta) * Math.sin(inclination);
      curvePoints.push(new THREE.Vector3(x, y, z));
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(curvePoints);
    const material = new THREE.LineBasicMaterial({
      color: this.state.theme === "light" ? 0x93a8d5 : 0x3f6fc3,
      transparent: true,
      opacity: 0.38
    });

    this.orbitLine = new THREE.LineLoop(geometry, material);
    this.orbitRoot.add(this.orbitLine);
  }

  buildMoonOrbitLine() {
    const moonDistance = this.computeMoonOrbitDistance();
    const points = [];

    for (let i = 0; i <= 96; i += 1) {
      const theta = (i / 96) * Math.PI * 2;
      points.push(new THREE.Vector3(
        Math.cos(theta) * moonDistance,
        Math.sin(theta) * moonDistance * 0.55,
        0
      ));
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineDashedMaterial({
      color: this.state.theme === "light" ? 0x8ea3d3 : 0x4665aa,
      dashSize: 0.12,
      gapSize: 0.10,
      transparent: true,
      opacity: 0.18
    });

    this.moonOrbitLine = new THREE.LineLoop(geometry, material);
    this.moonOrbitLine.computeLineDistances();
    this.moonRoot.add(this.moonOrbitLine);
  }

  computeOrbitRadius() {
    const aOverR = clamp(Number(this.state.scaledDistance) || Number(this.target.pl_orbsmax) || 8.0, 2.5, 50.0);
    const compressed = this.starRadius * (1.48 + Math.log(aOverR + 1.0) * 1.2);
    return clamp(compressed, this.starRadius * 1.6, this.starRadius * 5.8);
  }

  computeMoonOrbitDistance() {
    const planetRadius = clamp(this.starRadius * (this.state.radiusRatio || 0.12), 0.20, this.starRadius * 0.55);
    return clamp(
      planetRadius * (1.6 + (Number(this.state.moonDistance) || 0.55) * 1.3),
      planetRadius * 1.4,
      planetRadius * 5.0
    );
  }

  setTarget(target = {}) {
    this.target = {
      ...DEFAULT_TARGET,
      ...target
    };

    const inferredState = {
      radiusRatio: Number(target.pl_ratror) || this.state.radiusRatio,
      inclinationDeg: Number(target.pl_orbincl) || this.state.inclinationDeg,
      eccentricity: Number(target.pl_orbeccen) || this.state.eccentricity
    };

    this.state = {
      ...this.state,
      ...inferredState
    };

    if (this.starUniforms) {
      const palette = temperatureToPalette(this.target.st_teff || 5400);
      this.starUniforms.uBaseColor.value.copy(palette.base);
      this.starUniforms.uAccentColor.value.copy(palette.accent);
      this.starUniforms.uCoronaColor.value.copy(palette.corona);
      if (this.coronaUniforms) {
        this.coronaUniforms.uCoronaColor.value.copy(palette.corona);
      }
      this.keyLight.color.copy(palette.accent);
    }

    this.rebuildBodies();
    this.updateBodyScales();
  }

  setSceneState(nextState = {}) {
    this.state = {
      ...this.state,
      ...nextState
    };

    if (nextState.visualQuality && normalizeQualityName(nextState.visualQuality) !== this.qualityName) {
      this.setVisualQuality(nextState.visualQuality);
      return;
    }

    if (typeof nextState.theme !== "undefined") {
      this.setTheme(nextState.theme);
    }

    if (this.starUniforms) {
      this.starUniforms.uLimbU1.value = Number(this.state.limbU1) || 0.32;
      this.starUniforms.uLimbU2.value = Number(this.state.limbU2) || 0.28;
      this.starUniforms.uSpotEnabled.value = this.state.starspotEnabled ? 1 : 0;
      this.starUniforms.uSpotX.value = Number(this.state.starspotX) || 0.0;
      this.starUniforms.uSpotY.value = Number(this.state.starspotY) || 0.0;
      this.starUniforms.uSpotRadius.value = clamp(Number(this.state.starspotRadius) || 0.12, 0.03, 0.40);
      this.starUniforms.uSpotContrast.value = clamp(Number(this.state.starspotContrast) || 0.55, 0.05, 1.0);
    }

    if (this.coronaUniforms) {
      this.coronaUniforms.uStrength.value = this.quality.coronaStrength;
    }

    this.updateBodyScales();
  }

  updateBodyScales() {
    if (!this.planetMesh || !this.moonMesh) return;

    const radiusRatio = clamp(Number(this.state.radiusRatio) || 0.12, 0.01, 0.45);
    const moonRadiusRatio = clamp(Number(this.state.moonRadius) || 0.025, 0.002, 0.18);

    const planetRadius = clamp(this.starRadius * radiusRatio, 0.20, this.starRadius * 0.55);
    const moonRadius = clamp(this.starRadius * moonRadiusRatio, 0.06, this.starRadius * 0.18);

    this.planetMesh.geometry.dispose();
    this.planetMesh.geometry = new THREE.SphereGeometry(
      planetRadius,
      this.quality.planetSegments,
      this.quality.planetSegments
    );

    this.planetAtmosphere.geometry.dispose();
    this.planetAtmosphere.geometry = new THREE.SphereGeometry(
      planetRadius * 1.04,
      this.quality.planetSegments,
      this.quality.planetSegments
    );

    this.moonMesh.geometry.dispose();
    this.moonMesh.geometry = new THREE.SphereGeometry(
      moonRadius,
      Math.max(32, Math.floor(this.quality.planetSegments * 0.7)),
      Math.max(32, Math.floor(this.quality.planetSegments * 0.7))
    );

    if (this.moonOrbitLine) {
      this.moonRoot.remove(this.moonOrbitLine);
      this.disposeObject(this.moonOrbitLine);
      this.buildMoonOrbitLine();
    }

    if (this.orbitLine) {
      this.orbitRoot.remove(this.orbitLine);
      this.disposeObject(this.orbitLine);
      this.buildOrbitLine();
    }
  }

  getOrbitPosition(phase) {
    const radius = this.computeOrbitRadius();
    const inc = toRadians(Number(this.state.inclinationDeg) || 87.5);

    // phase 0 -> transit/front
    const theta = phase * Math.PI * 2;

    const x = radius * Math.sin(theta);
    const y = radius * Math.cos(theta) * Math.cos(inc) * 0.95;
    const z = radius * Math.cos(theta) * Math.sin(inc);

    return new THREE.Vector3(x, y, z);
  }

  getMoonPosition(planetPosition) {
    const moonDistance = this.computeMoonOrbitDistance();
    const moonPhase = toRadians(Number(this.state.moonPhaseDeg) || 0);

    // deliberately slower and steadier than before
    const orbitalPhase = moonPhase + this.sceneTime * 0.18;

    const x = Math.cos(orbitalPhase) * moonDistance;
    const y = Math.sin(orbitalPhase) * moonDistance * 0.56;
    const z = Math.sin(orbitalPhase + Math.PI / 5) * moonDistance * 0.22;

    return new THREE.Vector3(
      planetPosition.x + x,
      planetPosition.y + y,
      planetPosition.z + z
    );
  }

  updateSceneObjects(dt) {
    this.sceneTime += dt;

    if (this.starUniforms) {
      this.starUniforms.uTime.value = this.sceneTime;
    }

    if (this.coronaUniforms) {
      this.coronaUniforms.uTime.value = this.sceneTime;
    }

    if (this.starMesh) {
      this.starMesh.rotation.y += dt * 0.08 * this.quality.animationRate;
      this.starMesh.rotation.x = Math.sin(this.sceneTime * 0.12) * 0.03;
      this.coronaMesh.rotation.y -= dt * 0.02;
    }

    const phase = Number(this.state.phase) || 0;
    const planetPosition = this.getOrbitPosition(phase);

    if (this.planetRoot) {
      this.planetRoot.position.copy(planetPosition);
      this.planetMesh.rotation.y += dt * 0.18;
      this.planetMesh.rotation.z = Math.sin(this.sceneTime * 0.3) * 0.03;
      this.planetAtmosphere.rotation.y -= dt * 0.05;
    }

    if (this.state.moonEnabled) {
      const moonPos = this.getMoonPosition(planetPosition);
      this.moonRoot.visible = true;
      this.moonMesh.visible = true;
      if (this.moonOrbitLine) this.moonOrbitLine.visible = true;
      this.moonRoot.position.copy(moonPos);
      this.moonMesh.rotation.y += dt * 0.08;
    } else {
      this.moonRoot.visible = false;
    }

    // subtle camera drift for more life without becoming distracting
    this.camera.position.x = Math.sin(this.sceneTime * 0.08) * 0.30;
    this.camera.position.y = 0.65 + Math.cos(this.sceneTime * 0.06) * 0.14;
    this.camera.lookAt(0, 0.1, 0);

    // theme background
    if (this.state.theme === "light") {
      this.scene.background = new THREE.Color(0xf4f7fb);
    } else {
      this.scene.background = new THREE.Color(0x041126);
    }
  }

  resize() {
    if (this.destroyed) return;

    const width = Math.max(1, this.container.clientWidth || 1);
    const height = Math.max(1, this.container.clientHeight || 1);

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  animate() {
    if (this.destroyed) return;

    const dt = Math.min(this.clock.getDelta(), 0.033);
    this.updateSceneObjects(dt);
    this.renderer.render(this.scene, this.camera);
    this.animationHandle = requestAnimationFrame(this.animate);
  }

  disposeObject(object) {
    if (!object) return;

    if (object.geometry) object.geometry.dispose();

    if (object.material) {
      if (Array.isArray(object.material)) {
        object.material.forEach((m) => {
          if (m.map) m.map.dispose?.();
          m.dispose?.();
        });
      } else {
        if (object.material.map) object.material.map.dispose?.();
        object.material.dispose?.();
      }
    }

    if (object.parent) {
      object.parent.remove(object);
    }
  }

  dispose() {
    this.destroyed = true;

    cancelAnimationFrame(this.animationHandle);
    this._resizeObserver.disconnect();

    if (this.starField) {
      this.disposeObject(this.starField);
    }

    this.disposeObject(this.orbitLine);
    this.disposeObject(this.moonOrbitLine);
    this.disposeObject(this.starMesh);
    this.disposeObject(this.coronaMesh);
    this.disposeObject(this.planetMesh);
    this.disposeObject(this.planetAtmosphere);
    this.disposeObject(this.moonMesh);

    this.planetTexture?.dispose?.();
    this.moonTexture?.dispose?.();

    this.renderer.dispose();

    if (this.renderer.domElement && this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}

export function createSceneRenderer(container, options = {}) {
  return new ExoSceneRenderer(container, options);
}

export { ExoSceneRenderer };
export default ExoSceneRenderer;
