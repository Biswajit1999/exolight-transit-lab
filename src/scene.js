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

vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+10.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}

float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(
    i.z+vec4(0.0,i1.z,i2.z,1.0))
    +i.y+vec4(0.0,i1.y,i2.y,1.0))
    +i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;
  p1*=norm.y;
  p2*=norm.z;
  p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}

float fbm(vec3 p){
  float v=0.0;
  float a=0.5;
  mat3 rot=mat3(
    0.00,0.80,0.60,
   -0.80,0.36,-0.48,
   -0.60,-0.48,0.64
  );
  for(int i=0;i<5;i++){
    v+=a*snoise(p);
    p=rot*p*2.04+vec3(4.7,2.3,6.1);
    a*=0.52;
  }
  return v;
}

float flare(vec3 n,float t){
  float longitude=atan(n.z,n.x);
  float latitude=asin(clamp(n.y,-1.0,1.0));
  float sweep=sin(longitude*3.0+t*0.85)+sin(longitude*7.0-t*0.37)*0.45;
  float band=exp(-pow((latitude-0.18*sin(t*0.21+longitude))*8.0,2.0));
  float pulse=pow(max(0.0,sin(t*1.7+longitude*2.5)),10.0);
  return band*pulse*max(0.0,sweep);
}

void main(){
  vec3 n=normalize(vNormal);
  float mu=clamp(vViewNormal.z*0.5+0.5,0.0,1.0);
  float q=1.0-mu;
  float limb=max(0.0,1.0-uU1*q-uU2*q*q);

  float granSmall=fbm(n*34.0+vec3(uTime*.050,-uTime*.033,uTime*.021));
  float granLarge=fbm(n*10.0+vec3(-uTime*.018,uTime*.026,uTime*.041));
  float magnetic=fbm(n*5.0+vec3(uTime*.011,uTime*.020,-uTime*.013));
  float spotMask=smoothstep(0.48,0.79,magnetic)*smoothstep(0.12,0.72,1.0-mu*0.25);
  float darkSpot=spotMask*(0.38+0.22*snoise(n*22.0+uTime*.04));
  float cell=0.74+0.25*granSmall+0.13*granLarge;
  float hotRidge=smoothstep(0.32,0.92,granSmall+granLarge*.35);
  float flareValue=flare(n,uTime);

  vec3 base=mix(uCoolColor,uHotColor,clamp(uTeffNorm,0.0,1.0));
  vec3 amber=vec3(1.0,0.58,0.08);
  vec3 whiteHot=vec3(1.0,0.92,0.60);
  vec3 color=mix(base,amber,0.20+0.18*granLarge);
  color*=limb*cell;
  color=mix(color,color*0.38,darkSpot);
  color+=whiteHot*hotRidge*0.12*limb;
  color+=vec3(1.0,0.45,0.05)*flareValue*0.75;

  float rim=pow(1.0-mu,2.4);
  color+=vec3(1.0,0.48,0.06)*rim*.33;
  gl_FragColor=vec4(color,1.0);
}`;

const GLOW_FRAGMENT_SHADER = `
precision highp float;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vViewNormal;
uniform float uTime;
uniform vec3 uGlowColor;

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

void main(){
  vec3 n=normalize(vNormal);
  float mu=clamp(vViewNormal.z*0.5+0.5,0.0,1.0);
  float rim=pow(1.0-mu,1.65);
  float corona=noise(n*9.0+vec3(uTime*.05,-uTime*.03,uTime*.025));
  float plume=pow(max(0.0,noise(n*18.0+vec3(-uTime*.11,uTime*.05,uTime*.03))),3.0);
  float pulse=0.82+0.18*sin(uTime*1.3);
  float alpha=clamp(rim*(0.36+0.22*corona+0.36*plume)*pulse,0.0,0.72);
  vec3 color=uGlowColor*(0.62+0.60*corona)+vec3(1.0,0.35,0.04)*plume*.55;
  gl_FragColor=vec4(color,alpha);
}`;

const BODY_FRAGMENT_SHADER = `
precision highp float;
varying vec3 vNormal;
varying vec3 vViewNormal;
uniform vec3 uColor;
uniform vec3 uRimColor;
uniform float uDarkness;
uniform float uTime;
void main(){
  vec3 n=normalize(vNormal);
  vec3 light=normalize(vec3(-.65,.38,.95));
  float lambert=max(dot(n,light),0.0);
  float mu=clamp(vViewNormal.z*0.5+0.5,0.0,1.0);
  float rim=pow(1.0-mu,2.0);
  float terminator=smoothstep(-0.08,0.65,dot(n,light));
  vec3 color=uColor*(0.06+0.94*lambert)*terminator*(1.0-uDarkness)+uRimColor*rim*.45;
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
    this.ctx2d = null;
    this.ready = false;
    this.safe2d = false;
    this.programs = {};
    this.meshes = {};
    this.curveSummary = null;
    this.lastFpsTime = performance.now();
    this.frameCounter = 0;
    this.fps = 0;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.camera = {
      eye: [0, 0, 5.45],
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
    this.meshes.sphere = createSphereMesh(gl, 96, 56);
    this.meshes.glowSphere = createSphereMesh(gl, 96, 56);
    this.meshes.orbit = createUnitCircleMesh(gl, 300);
    this.meshes.axes = createLineMesh(gl, [
      -1.22, 0, 0, 1.22, 0, 0,
      0, -1.22, 0, 0, 1.22, 0
    ]);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0, 0, 0, 0);
    this.resize();

    window.addEventListener("resize", () => this.resize(), { passive: true });
    this.ready = true;
    this.onStatus("Native WebGL observatory ready with dual-mesh stellar atmosphere.");
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
    const planetPhysics = sample.planet || this.computeFallbackPlanet(phase, params);
    const moonPhysics = sample.moon || moonState || {};
    const planetVisual = this.projectPlanet(planetPhysics, params);
    const moonVisual = this.projectMoon(moonPhysics, planetPhysics, planetVisual, params);

    const rearBodies = [];
    const frontBodies = [];

    const planetBody = {
      position: planetVisual.position,
      radius: Math.max(0.028, planetVisual.radius),
      color: [0.014, 0.029, 0.042],
      rim: [0.0, 0.92, 1.0],
      darkness: 0.12,
      front: planetPhysics.front !== false
    };

    if (planetBody.front) {
      frontBodies.push(planetBody);
    } else {
      rearBodies.push(planetBody);
    }

    if (params.moonEnabled && moonPhysics.enabled !== false) {
      const moonBody = {
        position: moonVisual.position,
        radius: Math.max(0.014, moonVisual.radius),
        color: [0.105, 0.118, 0.13],
        rim: [1.0, 0.68, 0.08],
        darkness: 0.04,
        front: moonPhysics.front !== false
      };

      if (moonBody.front) {
        frontBodies.push(moonBody);
      } else {
        rearBodies.push(moonBody);
      }
    }

    this.drawBackgroundField(time);

    rearBodies
      .sort((a, b) => a.position[2] - b.position[2])
      .forEach(body => this.drawBody(body, time));

    this.drawStarSolid(time, params, teff, starColors);

    this.drawStarGlow(time, starColors);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);
    this.drawOrbitGuide(params, time);
    if (params.moonEnabled) {
      this.drawMoonOrbitGuide(planetVisual, params, time, phase);
      this.drawHierarchyArm(planetVisual.position, moonVisual.position);
    }
    this.drawAxes();
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    if (params.spotEnabled) {
      this.drawStarspot(params, time);
    }

    frontBodies
      .sort((a, b) => a.position[2] - b.position[2])
      .forEach(body => this.drawBody(body, time));
  }

  projectPlanet(planet, params) {
    const a = Math.max(1, params.aRs || 12);
    const phaseWindow = 0.085;
    const visualScaleX = 0.95 / Math.max(1.05, a * Math.sin(Math.PI * 2 * phaseWindow));
    const visualScaleY = 0.92;
    const zScale = 0.12;

    return {
      position: [
        clamp((planet.x || 0) * visualScaleX, -1.65, 1.65),
        clamp((planet.y || 0) * visualScaleY, -1.1, 1.1),
        clamp((planet.z || 0) * zScale, -0.55, 0.55)
      ],
      radius: Math.max(0.01, planet.radius || params.rpRs || 0.1)
    };
  }

  projectMoon(moon, planetPhysics, planetVisual, params) {
    const scale = 0.38;
    const local = Array.isArray(moon.vector) ? moon.vector : [
      Math.cos((params.moonPhaseDeg || 0) * Math.PI / 180) * (params.moonDistance || 0.55),
      Math.sin((params.moonPhaseDeg || 0) * Math.PI / 180) * (params.moonDistance || 0.55),
      0
    ];

    return {
      position: [
        planetVisual.position[0] + local[0] * scale,
        planetVisual.position[1] + local[1] * scale,
        planetVisual.position[2] + local[2] * scale * 0.65
      ],
      radius: Math.max(0.008, moon.radius || params.moonRadius || 0.025)
    };
  }

  drawBackgroundField(time) {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    this.drawLineMesh(this.meshes.axes, mat4Scale(mat4Identity(), [1.9, 1.9, 1]), [0.0, 0.94, 1.0], 0.045);
    gl.enable(gl.DEPTH_TEST);
  }

  drawStarSolid(time, params, teff, colors) {
    this.drawSphere({
      program: this.programs.star,
      mesh: this.meshes.sphere,
      model: mat4Scale(mat4RotateY(mat4RotateX(mat4Identity(), 0.03 * Math.sin(time * 0.13)), time * 0.040), [1, 1, 1]),
      uniforms: {
        uTime: time,
        uU1: params.u1 ?? 0.32,
        uU2: params.u2 ?? 0.28,
        uTeffNorm: clamp((teff - 2500) / 8500, 0, 1),
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
      model: mat4Scale(mat4Identity(), [1.19, 1.19, 1.19]),
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

  drawBody(body, time) {
    let model = mat4Translate(mat4Identity(), body.position);
    model = mat4Scale(model, [body.radius, body.radius, body.radius]);

    this.drawSphere({
      program: this.programs.body,
      mesh: this.meshes.sphere,
      model,
      uniforms: {
        uColor: body.color,
        uRimColor: body.rim,
        uDarkness: body.darkness,
        uTime: time
      }
    });
  }

  drawStarspot(params, time) {
    const x = clamp(params.spotX || 0, -0.96, 0.96);
    const y = clamp(params.spotY || 0, -0.96, 0.96);
    const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));

    if (z <= 0) return;

    const r = Math.max(0.012, params.spotRadius || 0.12);
    let model = mat4Translate(mat4Identity(), [x, y, z + 0.010]);
    model = mat4Scale(model, [r, r, 0.004]);

    this.drawSphere({
      program: this.programs.body,
      mesh: this.meshes.sphere,
      model,
      uniforms: {
        uColor: [0.030, 0.010, 0.004],
        uRimColor: [1.0, 0.32, 0.05],
        uDarkness: 0.0,
        uTime: time
      }
    });
  }

  drawOrbitGuide(params, time) {
    const a = 1.02;
    const b = Math.max(0.05, a * Math.cos((params.inclinationDeg || 88.5) * Math.PI / 180));
    let model = mat4RotateX(mat4Identity(), Math.PI / 2);
    model = mat4Scale(model, [a, a, b]);
    this.drawLineMesh(this.meshes.orbit, model, [0.0, 0.94, 1.0], 0.18);
  }

  drawMoonOrbitGuide(planetVisual, params, time, phase) {
    const d = (params.moonDistance || 0.55) * 0.38;
    let model = mat4Translate(mat4Identity(), planetVisual.position);
    model = mat4RotateZ(model, (params.moonNodeDeg || 0) * Math.PI / 180);
    model = mat4RotateX(model, (params.moonInclinationDeg || 0) * Math.PI / 180);
    model = mat4Scale(model, [d, d, d]);
    this.drawLineMesh(this.meshes.orbit, model, [1.0, 0.69, 0.0], 0.32);
  }

  drawAxes() {
    this.drawLineMesh(this.meshes.axes, mat4Identity(), [0.0, 0.94, 1.0], 0.10);
  }

  drawHierarchyArm(a, b) {
    const mesh = createLineMesh(this.gl, [
      a[0], a[1], a[2],
      b[0], b[1], b[2]
    ]);

    this.drawLineMesh(mesh, mat4Identity(), [1.0, 0.69, 0.0], 0.40);
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
    const pv = this.projectPlanet(p, params);

    ctx.fillStyle = "#02070a";
    ctx.strokeStyle = "#00f0ff";
    ctx.lineWidth = 2 * this.pixelRatio;
    ctx.beginPath();
    ctx.arc(cx + pv.position[0] * r, cy - pv.position[1] * r, Math.max(5, pv.radius * r), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (params.moonEnabled) {
      const m = sample.moon || moonState || {};
      const mv = this.projectMoon(m, p, pv, params);

      ctx.fillStyle = "#14191f";
      ctx.strokeStyle = "#ffb000";
      ctx.beginPath();
      ctx.arc(cx + mv.position[0] * r, cy - mv.position[1] * r, Math.max(3, mv.radius * r), 0, Math.PI * 2);
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
    return {
      hot: [1.0, .56, .29],
      cool: [.52, .10, .045],
      glow: [1.0, .26, .07]
    };
  }

  if (teff < 5000) {
    return {
      hot: [1.0, .74, .42],
      cool: [.76, .27, .08],
      glow: [1.0, .43, .08]
    };
  }

  if (teff < 6500) {
    return {
      hot: [1.0, .86, .56],
      cool: [.95, .47, .12],
      glow: [1.0, .58, .08]
    };
  }

  if (teff < 8500) {
    return {
      hot: [.86, .95, 1.0],
      cool: [.95, .67, .25],
      glow: [.46, .88, 1.0]
    };
  }

  return {
    hot: [.58, .78, 1.0],
    cool: [.72, .82, 1.0],
    glow: [.30, .68, 1.0]
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

  if (program._cached) {
    return program._locations;
  }

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
    const a = i / points * Math.PI * 2;
    const b = (i + 1) / points * Math.PI * 2;

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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
