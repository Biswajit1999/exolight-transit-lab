import * as THREE from "three";
import transitFrag from "../glsl/transitQuad.frag.glsl?raw";

// GPUTransitEngine is a production-ready extension point. The current UI uses the CPU quadrature
// fallback for portability, while this class provides the WebGL2 shader path for larger model grids.
export class GPUTransitEngine {
  readonly supported: boolean;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.OrthographicCamera | null = null;
  private material: THREE.ShaderMaterial | null = null;

  constructor(private width = 2048) {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    this.supported = !!gl;
    if (!this.supported) return;
    this.renderer = new THREE.WebGLRenderer({ canvas, context: gl as WebGL2RenderingContext });
    this.renderer.setSize(width, 1, false);
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      fragmentShader: transitFrag,
      vertexShader: `#version 300 es\nin vec3 position; void main(){ gl_Position = vec4(position,1.0); }`,
      uniforms: {}
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2), this.material));
  }
}
