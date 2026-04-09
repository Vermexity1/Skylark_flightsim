// ============================================================
// Post-Processing — Manual bloom pipeline
// No external addons required — pure Three.js WebGLRenderTarget
//
// Pipeline:
//   1. Render scene  → sceneTarget
//   2. Threshold     → brightTarget  (bright pixels only)
//   3. Blur H        → blurH
//   4. Blur V        → blurV
//   5. Composite     → screen  (scene + bloom additive)
// ============================================================
import * as THREE from 'three';

// ── Shaders ────────────────────────────────────────────────

const THRESHOLD_VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
`;

const THRESHOLD_FRAG = `
uniform sampler2D tScene;
uniform float threshold;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tScene, vUv);
  float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  gl_FragColor = lum > threshold ? c : vec4(0.0);
}
`;

const BLUR_VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
`;

const BLUR_H_FRAG = `
uniform sampler2D tInput;
uniform vec2 resolution;
varying vec2 vUv;
void main() {
  float px = 1.0 / resolution.x;
  vec4 c = vec4(0.0);
  c += texture2D(tInput, vUv + vec2(-4.0*px, 0.0)) * 0.051;
  c += texture2D(tInput, vUv + vec2(-3.0*px, 0.0)) * 0.0918;
  c += texture2D(tInput, vUv + vec2(-2.0*px, 0.0)) * 0.1238;
  c += texture2D(tInput, vUv + vec2(-1.0*px, 0.0)) * 0.1531;
  c += texture2D(tInput, vUv)                        * 0.1658;
  c += texture2D(tInput, vUv + vec2( 1.0*px, 0.0)) * 0.1531;
  c += texture2D(tInput, vUv + vec2( 2.0*px, 0.0)) * 0.1238;
  c += texture2D(tInput, vUv + vec2( 3.0*px, 0.0)) * 0.0918;
  c += texture2D(tInput, vUv + vec2( 4.0*px, 0.0)) * 0.051;
  gl_FragColor = c;
}
`;

const BLUR_V_FRAG = `
uniform sampler2D tInput;
uniform vec2 resolution;
varying vec2 vUv;
void main() {
  float py = 1.0 / resolution.y;
  vec4 c = vec4(0.0);
  c += texture2D(tInput, vUv + vec2(0.0, -4.0*py)) * 0.051;
  c += texture2D(tInput, vUv + vec2(0.0, -3.0*py)) * 0.0918;
  c += texture2D(tInput, vUv + vec2(0.0, -2.0*py)) * 0.1238;
  c += texture2D(tInput, vUv + vec2(0.0, -1.0*py)) * 0.1531;
  c += texture2D(tInput, vUv)                        * 0.1658;
  c += texture2D(tInput, vUv + vec2(0.0,  1.0*py)) * 0.1531;
  c += texture2D(tInput, vUv + vec2(0.0,  2.0*py)) * 0.1238;
  c += texture2D(tInput, vUv + vec2(0.0,  3.0*py)) * 0.0918;
  c += texture2D(tInput, vUv + vec2(0.0,  4.0*py)) * 0.051;
  gl_FragColor = c;
}
`;

const COMPOSITE_FRAG = `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float bloomStrength;
uniform float exposure;
varying vec2 vUv;
void main() {
  vec4 scene = texture2D(tScene, vUv);
  vec4 bloom = texture2D(tBloom, vUv);
  // Additive bloom + basic tone-mapping
  vec3 mapped = scene.rgb + bloom.rgb * bloomStrength;
  // Reinhard tone-map
  mapped = mapped / (mapped + vec3(1.0));
  mapped = pow(mapped, vec3(1.0 / 2.2));  // gamma
  gl_FragColor = vec4(mapped * exposure, 1.0);
}
`;

// ── PostProcessor ──────────────────────────────────────────

export class PostProcessor {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} opts
   *   threshold    - luminance cutoff for bloom  (default 0.75)
   *   bloomStr     - additive bloom multiplier   (default 0.45)
   *   exposure     - final brightness            (default 1.0)
   */
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this.enabled  = true;

    this._threshold  = opts.threshold ?? 0.75;
    this._bloomStr   = opts.bloomStr  ?? 0.45;
    this._exposure   = opts.exposure  ?? 1.0;
    this._bloomScale = opts.bloomScale ?? 0.25;

    const { width: W, height: H } = renderer.domElement;
    const rtOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat };
    const bloomW = Math.max(1, Math.floor(W * this._bloomScale));
    const bloomH = Math.max(1, Math.floor(H * this._bloomScale));

    this._sceneRT  = new THREE.WebGLRenderTarget(W, H, rtOpts);
    this._brightRT = new THREE.WebGLRenderTarget(bloomW, bloomH, rtOpts);
    this._blurHRT  = new THREE.WebGLRenderTarget(bloomW, bloomH, rtOpts);
    this._blurVRT  = new THREE.WebGLRenderTarget(bloomW, bloomH, rtOpts);
    this._blackTexture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
    this._blackTexture.needsUpdate = true;

    const res = new THREE.Vector2(bloomW, bloomH);

    // Fullscreen quad
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array([-1,-1,0, 1,-1,0, -1,1,0, 1,1,0]);
    const uvs = new Float32Array([0,0, 1,0, 0,1, 1,1]);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv',       new THREE.BufferAttribute(uvs, 2));
    geo.setIndex([0,1,2, 1,3,2]);

    this._threshMat = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: null }, threshold: { value: this._threshold } },
      vertexShader: THRESHOLD_VERT, fragmentShader: THRESHOLD_FRAG, depthTest: false, depthWrite: false,
    });

    this._blurHMat = new THREE.ShaderMaterial({
      uniforms: { tInput: { value: null }, resolution: { value: res } },
      vertexShader: BLUR_VERT, fragmentShader: BLUR_H_FRAG, depthTest: false, depthWrite: false,
    });

    this._blurVMat = new THREE.ShaderMaterial({
      uniforms: { tInput: { value: null }, resolution: { value: res } },
      vertexShader: BLUR_VERT, fragmentShader: BLUR_V_FRAG, depthTest: false, depthWrite: false,
    });

    this._compMat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null }, tBloom: { value: null },
        bloomStrength: { value: this._bloomStr }, exposure: { value: this._exposure },
      },
      vertexShader: THRESHOLD_VERT, fragmentShader: COMPOSITE_FRAG, depthTest: false, depthWrite: false,
    });

    this._quadScene  = new THREE.Scene();
    this._quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._quad       = new THREE.Mesh(geo, null);
    this._quadScene.add(this._quad);

    // Handle resize
    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
  }

  /** Render scene + post effects */
  render(scene, camera) {
    if (!this.enabled) {
      this.renderer.render(scene, camera);
      return;
    }

    // 1. Scene → sceneRT
    this.renderer.setRenderTarget(this._sceneRT);
    this.renderer.render(scene, camera);

    if (this._compMat.uniforms.bloomStrength.value <= 0.001) {
      this._compMat.uniforms.tScene.value = this._sceneRT.texture;
      this._compMat.uniforms.tBloom.value = this._blackTexture;
      this._quad.material = this._compMat;
      this.renderer.setRenderTarget(null);
      this.renderer.render(this._quadScene, this._quadCamera);
      return;
    }

    // 2. Threshold bright pixels → brightRT
    this._threshMat.uniforms.tScene.value = this._sceneRT.texture;
    this._quad.material = this._threshMat;
    this.renderer.setRenderTarget(this._brightRT);
    this.renderer.render(this._quadScene, this._quadCamera);

    // 3. Horizontal blur → blurHRT
    this._blurHMat.uniforms.tInput.value = this._brightRT.texture;
    this._quad.material = this._blurHMat;
    this.renderer.setRenderTarget(this._blurHRT);
    this.renderer.render(this._quadScene, this._quadCamera);

    // 4. Vertical blur → blurVRT
    this._blurVMat.uniforms.tInput.value = this._blurHRT.texture;
    this._quad.material = this._blurVMat;
    this.renderer.setRenderTarget(this._blurVRT);
    this.renderer.render(this._quadScene, this._quadCamera);

    // 5. Composite scene + bloom → screen
    this._compMat.uniforms.tScene.value = this._sceneRT.texture;
    this._compMat.uniforms.tBloom.value = this._blurVRT.texture;
    this._quad.material = this._compMat;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this._quadScene, this._quadCamera);
  }

  /** Dynamically adjust bloom at runtime (call from engine based on speed) */
  setBloom(strength, threshold) {
    if (strength !== undefined) this._compMat.uniforms.bloomStrength.value = strength;
    if (threshold !== undefined) this._threshMat.uniforms.threshold.value = threshold;
  }

  _onResize() {
    this.resize(window.innerWidth, window.innerHeight);
  }

  resize(width, height) {
    const W = width;
    const H = height;
    const bloomW = Math.max(1, Math.floor(W * this._bloomScale));
    const bloomH = Math.max(1, Math.floor(H * this._bloomScale));
    this._sceneRT.setSize(W, H);
    this._brightRT.setSize(bloomW, bloomH);
    this._blurHRT.setSize(bloomW, bloomH);
    this._blurVRT.setSize(bloomW, bloomH);
    const res = new THREE.Vector2(bloomW, bloomH);
    this._blurHMat.uniforms.resolution.value = res;
    this._blurVMat.uniforms.resolution.value = res;
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    [this._sceneRT, this._brightRT, this._blurHRT, this._blurVRT].forEach(rt => rt.dispose());
    this._blackTexture.dispose();
    [this._threshMat, this._blurHMat, this._blurVMat, this._compMat].forEach(m => m.dispose());
  }
}
