import * as THREE from "three";
import type { ExoTarget, FitParameters } from "../types";
import starFrag from "../glsl/star.frag.glsl?raw";
import starVert from "../glsl/star.vert.glsl?raw";
import { projectedOrbitRs } from "../physics/orbit";

function teffColor(k: number): THREE.Color {
  const t = Math.max(2400, Math.min(11000, k)) / 100;
  let r: number, g: number, b: number;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307; }
  else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); b = 255; }
  return new THREE.Color(Math.max(0, Math.min(255, r))/255, Math.max(0, Math.min(255, g))/255, Math.max(0, Math.min(255, b))/255);
}

export class OrreryView {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.01, 1000);
  private star: THREE.Mesh;
  private planet: THREE.Mesh;
  private orbitLine: THREE.Line;
  private target: ExoTarget | null = null;
  private fit: FitParameters | null = null;
  private raf = 0;
  private start = performance.now();

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.camera.position.set(0, 0.72, 5.8);
    this.scene.add(new THREE.AmbientLight(0x9edfff, 0.42));
    const lamp = new THREE.PointLight(0xffbd6a, 8, 80); lamp.position.set(0, 0, 3); this.scene.add(lamp);

    const starMat = new THREE.ShaderMaterial({
      vertexShader: starVert,
      fragmentShader: starFrag,
      uniforms: {
        uStarColor: { value: new THREE.Color(1, 0.75, 0.36) },
        uTime: { value: 0 },
        uLimb: { value: new THREE.Vector4(0.45, 0.18, 0.12, 0.04) },
        uActiveRegions: { value: 0 },
        uSpotA: { value: new THREE.Vector4(0.4, 0.15, 0.18, 0.45) },
        uSpotB: { value: new THREE.Vector4(2.2, -0.22, 0.12, 0.30) },
        uSpotC: { value: new THREE.Vector4(4.0, 0.34, 0.10, 0.25) }
      }
    });
    this.star = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 128), starMat);
    this.scene.add(this.star);
    this.planet = new THREE.Mesh(new THREE.SphereGeometry(0.1, 64, 64), new THREE.MeshStandardMaterial({ color: 0x050a12, roughness: 0.82, metalness: 0.08 }));
    this.scene.add(this.planet);
    this.orbitLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x35f2d0, transparent: true, opacity: 0.28 }));
    this.scene.add(this.orbitLine);
    this.addBackground();
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.animate();
  }

  setTarget(target: ExoTarget, fit: FitParameters) {
    this.target = target; this.fit = fit;
    (this.star.material as THREE.ShaderMaterial).uniforms.uStarColor.value = teffColor(target.stellar_teff_k);
    this.planet.scale.setScalar(Math.max(0.04, Math.min(0.35, fit.rpRs)));
    this.updateOrbitLine();
  }

  updateFit(fit: FitParameters) { this.fit = fit; this.planet.scale.setScalar(Math.max(0.04, Math.min(0.35, fit.rpRs))); this.updateOrbitLine(); }

  setPhase(phase: number) {
    if (!this.fit) return;
    const t = phase * this.fit.period;
    const o = projectedOrbitRs({ timeDays: t, t0Days: this.fit.t0, periodDays: this.fit.period, aRs: this.fit.aRs, inclinationRad: this.fit.inclinationDeg * Math.PI/180, eccentricity: this.fit.eccentricity, omegaRad: this.fit.omegaDeg * Math.PI/180 });
    const scale = 2.2 / Math.max(2, this.fit.aRs);
    this.planet.position.set(o.xRs * scale, o.yRs * scale, 0.95 + o.zRs * scale * 0.12);
  }

  private updateOrbitLine() {
    if (!this.fit) return;
    const pts: THREE.Vector3[] = [];
    const scale = 2.2 / Math.max(2, this.fit.aRs);
    for (let i=0;i<=360;i++) {
      const phase = i / 360;
      const o = projectedOrbitRs({ timeDays: phase * this.fit.period, t0Days: this.fit.t0, periodDays: this.fit.period, aRs: this.fit.aRs, inclinationRad: this.fit.inclinationDeg * Math.PI/180, eccentricity: this.fit.eccentricity, omegaRad: this.fit.omegaDeg * Math.PI/180 });
      pts.push(new THREE.Vector3(o.xRs * scale, o.yRs * scale, 0.95 + o.zRs * scale * 0.12));
    }
    this.orbitLine.geometry.dispose();
    this.orbitLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  }

  private addBackground() {
    const n = 2200, pos = new Float32Array(n*3);
    for (let i=0;i<n;i++) { const r=40+Math.random()*180, a=Math.random()*Math.PI*2, z=(Math.random()-0.5)*90; pos[i*3]=Math.cos(a)*r; pos[i*3+1]=Math.sin(a)*r; pos[i*3+2]=z; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ size:0.035, color:0x9edfff, transparent:true, opacity:0.45, blending:THREE.AdditiveBlending, depthWrite:false })));
  }

  resize() { const r=this.canvas.getBoundingClientRect(); this.camera.aspect = Math.max(1,r.width)/Math.max(1,r.height); this.camera.updateProjectionMatrix(); this.renderer.setSize(Math.max(1,r.width), Math.max(1,r.height), false); }
  dispose() { cancelAnimationFrame(this.raf); this.renderer.dispose(); }
  private animate = () => { this.raf = requestAnimationFrame(this.animate); const t=(performance.now()-this.start)/1000; const mat=this.star.material as THREE.ShaderMaterial; mat.uniforms.uTime.value=t; mat.uniforms.uActiveRegions.value=this.fit?.starspotEnabled ? 1 : 0; this.star.rotation.y += 0.0013; this.renderer.render(this.scene, this.camera); };
}
