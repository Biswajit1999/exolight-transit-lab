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
 
  float v = 0.0;
  float a = 0.56;
  for (int i = 0; i < 8; i++) {
    v += a * noise(p);
    p = p * 2.01 + vec3(4.17, 8.31, 2.73);
    a *= 0.50;
 
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

 
vec3 rotateY(vec3 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

vec3 rotateX(vec3 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
}

vec3 saturateColour(vec3 colour, float amount) {
  float luma = dot(colour, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(luma), colour, amount);
}

float spotMask(vec3 n, vec3 centre, float radius, float contrast) {
  vec3 c = normalize(centre);
  float d = length(n - c);
  float edgeNoise = fbm(n * 82.0 + vec3(2.1, 5.3, 7.4));
  float smallNoise = fbm(n * 190.0 + vec3(9.3, 1.4, 5.6));
  float pores = smoothstep(0.58, 0.92, fbm(n * 260.0 + vec3(4.7, 8.8, 2.2)));
  float ragged = radius * (0.72 + 0.36 * edgeNoise + 0.13 * smallNoise);
  float penumbra = 1.0 - smoothstep(ragged, ragged + radius * 0.55, d);
  float umbra = 1.0 - smoothstep(ragged * 0.33, ragged * 0.33 + radius * 0.17, d);
  return clamp((0.42 * penumbra + 0.76 * umbra + 0.10 * pores * penumbra) * contrast, 0.0, 0.97);
}

void main() {
  vec3 n = normalize(vNormal);
  float qLevel = clamp(uQuality, 0.0, 1.95);

  vec3 rSlow = rotateX(rotateY(n, uTime * (0.070 + 0.032 * qLevel)), 0.12 * sin(uTime * 0.05));
  vec3 rMid  = rotateY(n, -uTime * (0.135 + 0.060 * qLevel));
  vec3 rFast = rotateX(rotateY(n, uTime * (0.300 + 0.115 * qLevel)), 0.35);

  float mu = clamp(vViewNormal.z * 0.5 + 0.5, 0.0, 1.0);
  float oneMinusMu = 1.0 - mu;

  // Physically motivated limb darkening, with extra Ultra edge falloff so the star reads as a sphere.
  float limb = clamp(1.0 - uU1 * oneMinusMu - uU2 * oneMinusMu * oneMinusMu, 0.025, 1.18);
  float sphericalDepth = 0.72 + 0.34 * pow(mu, 0.62);

  // Layered convection: large cells + intergranular dark lanes + fine hot fragments.
  float globalFlow = fbm(rSlow * 2.4 + vec3(uTime * 0.015, -uTime * 0.010, uTime * 0.012));
  float superGran  = fbm(rSlow * 5.6 + vec3(-uTime * 0.032, uTime * 0.020, -uTime * 0.015));
  float meso       = fbm(rMid  * 13.0 + vec3(uTime * 0.070, -uTime * 0.045, uTime * 0.034));
  float granA      = fbm(rMid  * 34.0 + vec3(uTime * 0.160, -uTime * 0.105, uTime * 0.080));
  float granB      = fbm(rFast * 86.0 + vec3(-uTime * 0.320, uTime * 0.235, -uTime * 0.160));
  float granC      = fbm(rFast * 176.0 + vec3(uTime * 0.540, -uTime * 0.390, uTime * 0.270));

  float plasmaField = 0.18 * globalFlow + 0.22 * superGran + 0.20 * meso + 0.25 * granA + 0.11 * granB + 0.04 * granC;
  float hotCell = smoothstep(0.54, 0.73, plasmaField);
  float hotCore = smoothstep(0.66, 0.88, plasmaField);
  float darkLane = smoothstep(0.43, 0.69, 1.0 - plasmaField);
  float fineSpark = smoothstep(0.63, 0.91, granC) * smoothstep(0.20, 0.84, mu);

  float tempFactor = clamp((uTeff - 3200.0) / 6400.0, 0.0, 1.0);
  float baseContrast = mix(0.38, 0.20, tempFactor);
  float contrast = baseContrast * mix(0.74, 1.72, qLevel);

  float textureTerm =
    1.0
    + contrast * (0.78 * hotCell + 0.48 * hotCore - 0.82 * darkLane)
    + contrast * 0.20 * ((granB - 0.5) + 0.55 * (granC - 0.5));

  // Self-luminous centre/edge structure. Not a planet lit by a lamp.
  float centreEmission = 0.78 + 0.30 * pow(mu, 0.52);
  float innerGlow = smoothstep(0.18, 1.0, mu);

  vec3 photosphere = mix(uCoolColour, uBaseColour, limb);
  photosphere = mix(photosphere, uHotColour, 0.20 * hotCell + 0.22 * hotCore + 0.12 * fineSpark + 0.10 * pow(mu, 1.25));

  // Keep stellar temperature colour visible. Cooler stars stay orange/red; hotter stars keep white/blue-white.
  vec3 colour = photosphere * limb * textureTerm * centreEmission * sphericalDepth;

  // Thin bright facular fragments, especially toward the limb.
  float facula = smoothstep(0.64, 0.91, fbm(rFast * 122.0 + vec3(7.1, uTime * 0.42, 3.2)));
  colour += uHotColour * facula * pow(oneMinusMu, 1.06) * 0.044 * qLevel;
  colour += uHotColour * fineSpark * innerGlow * 0.030 * qLevel;

  // Chromatic limb falloff: redder/darker at the edge, no chalky flat disk.
  vec3 chromaLimb = mix(uCoolColour, vec3(1.15, 0.30, 0.070), 0.32);
  colour = mix(colour, chromaLimb * 0.48, pow(oneMinusMu, 1.18) * 0.52);

  // Irregular starspot: broken penumbra and darker umbral islands.
  if (uSpotEnabled > 0.5) {
    float s = spotMask(n, uSpotCentre, uSpotRadius, uSpotContrast);
    vec3 penumbraColour = mix(uCoolColour * 0.34, vec3(0.36, 0.16, 0.060), 0.55);
    vec3 umbraColour = vec3(0.045, 0.023, 0.014);
    colour = mix(colour, penumbraColour * limb, s * 0.70);
    colour = mix(colour, umbraColour, smoothstep(0.58, 0.95, s) * 0.88);
  }

  // Warm corona contribution only at the rim, not a flat disc over the star.
  colour += uHotColour * pow(oneMinusMu, 3.0) * 0.035 * qLevel;

  // Filmic compression with saturation recovery. This avoids both chalk-white saturation and muddy brown.
  vec3 preTone = max(colour, vec3(0.0));
  preTone = saturateColour(preTone, 1.18 + 0.16 * qLevel);
  preTone *= 0.92;
  vec3 mapped = preTone / (preTone + vec3(0.34));
  mapped = saturateColour(mapped, 1.10 + 0.12 * qLevel);
  mapped *= 1.20;
  mapped = pow(max(mapped, vec3(0.0)), vec3(0.92));

  gl_FragColor = vec4(mapped, 1.0);
 
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
  float mu = clamp(vViewNormal.z * 0.5 + 0.5, 0.0, 1.0);
  float edge = 1.0 - mu;
  float rim = smoothstep(0.58, 0.98, edge);
  float outer = pow(edge, 5.7);
  float texture = noise(vec3(gl_FragCoord.xy * 0.010, uTime * 0.030));
  float pulse = 0.96 + 0.04 * sin(uTime * 0.52);
  float broken = 0.72 + 0.36 * texture;
  vec3 colour = uGlowColour * (0.20 * rim + 0.92 * outer) * uStrength * pulse * broken;
  float alpha = clamp((0.018 * rim + 0.115 * outer) * uStrength * broken, 0.0, 0.22);
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
    this.ready = true;
    this.onStatus("Ultra flagship stellar renderer online");
    this.frameHandle = requestAnimationFrame(time => this.loop(time));
  }

  qualitySettings() {
    if (this.quality === "ultra") {
      return { sphereSegments: 320, sphereRings: 184, starCount: 2600, quality: 1.92, glow: 1.78 };
    }
    if (this.quality === "high") {
      return { sphereSegments: 220, sphereRings: 126, starCount: 1450, quality: 1.28, glow: 1.30 };
    }
    if (this.quality === "low") {
      return { sphereSegments: 72, sphereRings: 42, starCount: 320, quality: 0.42, glow: 0.70 };
    }
    return { sphereSegments: 132, sphereRings: 78, starCount: 760, quality: 0.78, glow: 0.96 };
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
    const model = mat4Scale(mat4RotateY(mat4Identity(), time * (this.quality === "ultra" ? 0.105 : 0.045)), [this.quality === "ultra" ? 1.56 : 1.50, this.quality === "ultra" ? 1.56 : 1.50, this.quality === "ultra" ? 1.56 : 1.50]);

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
      model: mat4Scale(mat4Identity(), [this.quality === "ultra" ? 1.82 : 1.72, this.quality === "ultra" ? 1.82 : 1.72, this.quality === "ultra" ? 1.82 : 1.72]),
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
  const t = clamp(numberOr(teff, 5772), 2500, 12000);

  // Physically inspired but visually tuned palette. Values may exceed 1.0 because
  // the shader applies its own filmic compression; this gives Ultra mode an emissive look.
  if (t < 3600) {
    return {
      base: [1.18, 0.33, 0.105],
      hot: [1.55, 0.64, 0.22],
      cool: [0.40, 0.075, 0.030],
      glow: [1.00, 0.22, 0.055]
    };
  }

  if (t < 5000) {
    const k = (t - 3600) / 1400;
    return {
      base: mix3([1.18, 0.36, 0.12], [1.12, 0.55, 0.20], k),
      hot: mix3([1.55, 0.66, 0.23], [1.48, 0.84, 0.34], k),
      cool: mix3([0.42, 0.085, 0.035], [0.46, 0.16, 0.055], k),
      glow: mix3([1.00, 0.24, 0.060], [1.00, 0.40, 0.10], k)
    };
  }

  if (t < 6500) {
    const k = (t - 5000) / 1500;
    return {
      base: mix3([1.12, 0.58, 0.22], [1.12, 0.78, 0.38], k),
      hot: mix3([1.50, 0.88, 0.36], [1.44, 1.08, 0.62], k),
      cool: mix3([0.46, 0.17, 0.060], [0.45, 0.27, 0.12], k),
      glow: mix3([1.00, 0.42, 0.10], [1.00, 0.64, 0.22], k)
    };
  }

  if (t < 8500) {
    const k = (t - 6500) / 2000;
    return {
      base: mix3([1.10, 0.82, 0.46], [0.82, 0.92, 1.18], k),
      hot: mix3([1.42, 1.16, 0.72], [1.02, 1.24, 1.58], k),
      cool: mix3([0.42, 0.30, 0.15], [0.20, 0.30, 0.55], k),
      glow: mix3([1.00, 0.70, 0.30], [0.48, 0.68, 1.25], k)
    };
  }

  return {
    base: [0.70, 0.88, 1.28],
    hot: [0.96, 1.18, 1.72],
    cool: [0.16, 0.24, 0.58],
    glow: [0.36, 0.58, 1.35]
  };
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
