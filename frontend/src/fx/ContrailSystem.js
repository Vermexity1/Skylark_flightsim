// ============================================================
// Contrail System — Exhaust vapour trail behind aircraft
// Uses THREE.Points with custom shader for soft fade-out
// Emits particles from engine position, fades over time
// ============================================================
import * as THREE from 'three';

const TRAIL_VERT = `
attribute float alpha;
attribute float size;
varying float vAlpha;
void main() {
  vAlpha = alpha;
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * (300.0 / -mvPos.z);
  gl_PointSize = clamp(gl_PointSize, 1.0, 64.0);
  gl_Position = projectionMatrix * mvPos;
}
`;

const TRAIL_FRAG = `
varying float vAlpha;
void main() {
  // Soft circular point
  vec2 uv = gl_PointCoord - 0.5;
  float r = dot(uv, uv);
  if (r > 0.25) discard;
  float edge = 1.0 - smoothstep(0.15, 0.25, r);
  gl_FragColor = vec4(0.9, 0.92, 0.95, vAlpha * edge);
}
`;

const MAX_PARTICLES = 1200;
const LIFETIME      = 4.5;   // seconds a particle lives
const EMIT_RATE     = 0.018; // seconds between emissions

export class ContrailSystem {
  constructor(scene) {
    this.scene    = scene;
    this.enabled  = true;

    this._positions = new Float32Array(MAX_PARTICLES * 3);
    this._alphas    = new Float32Array(MAX_PARTICLES);
    this._sizes     = new Float32Array(MAX_PARTICLES);
    this._ages      = new Float32Array(MAX_PARTICLES);
    this._alive     = new Uint8Array(MAX_PARTICLES);
    this._nextSlot  = 0;
    this._emitTimer = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this._positions, 3));
    geo.setAttribute('alpha',    new THREE.BufferAttribute(this._alphas,    1));
    geo.setAttribute('size',     new THREE.BufferAttribute(this._sizes,     1));
    geo.setDrawRange(0, 0);

    const mat = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader:   TRAIL_VERT,
      fragmentShader: TRAIL_FRAG,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.AdditiveBlending,
    });

    this._points = new THREE.Points(geo, mat);
    this._points.frustumCulled = false;
    this.scene.add(this._points);

    this._geo = geo;
    this._mat = mat;
  }

  /**
   * Update contrail each physics tick.
   * @param {THREE.Vector3} position   - engine exhaust position (world)
   * @param {number}        throttle   - 0..1
   * @param {number}        speed      - m/s
   * @param {number}        altitude   - metres (contrails only form above ~2000m IRL, but we show lightly always)
   * @param {number}        dt
   */
  update(position, throttle, speed, altitude, dt) {
    if (!this.enabled) return;

    // ── Age existing particles ──────────────────────────────
    let maxAlive = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (!this._alive[i]) continue;
      this._ages[i] += dt;

      if (this._ages[i] >= LIFETIME) {
        this._alive[i] = 0;
        this._alphas[i] = 0;
        this._sizes[i]  = 0;
      } else {
        const t = this._ages[i] / LIFETIME;
        // Fade out over lifetime; fade in for first 5%
        const fadeIn  = Math.min(1, t / 0.05);
        const fadeOut = 1 - Math.pow(t, 1.4);
        this._alphas[i] = fadeIn * fadeOut * 0.38;
        this._sizes[i]  = 4 + t * 18; // expand as they age
        maxAlive = Math.max(maxAlive, i + 1);
      }
    }

    // ── Emit new particles ──────────────────────────────────
    this._emitTimer -= dt;

    // Emit rate increases with speed; only emit when throttle high enough
    const shouldEmit = throttle > 0.15 || speed > 20;
    if (shouldEmit && this._emitTimer <= 0) {
      const rate = EMIT_RATE / Math.max(1, speed / 25);
      this._emitTimer = rate;

      // Find a free slot
      for (let attempt = 0; attempt < MAX_PARTICLES; attempt++) {
        const slot = this._nextSlot % MAX_PARTICLES;
        this._nextSlot = (this._nextSlot + 1) % MAX_PARTICLES;
        if (!this._alive[slot]) {
          this._alive[slot] = 1;
          this._ages[slot]  = 0;
          this._alphas[slot] = 0;
          this._sizes[slot]  = 4;

          const si = slot * 3;
          // Slight spread for engine exhaust position
          this._positions[si    ] = position.x + (Math.random() - 0.5) * 1.2;
          this._positions[si + 1] = position.y + (Math.random() - 0.5) * 0.6;
          this._positions[si + 2] = position.z + (Math.random() - 0.5) * 1.2;

          maxAlive = Math.max(maxAlive, slot + 1);
          break;
        }
      }
    }

    // ── Upload to GPU ───────────────────────────────────────
    this._geo.attributes.position.needsUpdate = true;
    this._geo.attributes.alpha.needsUpdate    = true;
    this._geo.attributes.size.needsUpdate     = true;
    this._geo.setDrawRange(0, maxAlive);
  }

  setEnabled(enabled) { this.enabled = enabled; }

  destroy() {
    this.scene.remove(this._points);
    this._geo.dispose();
    this._mat.dispose();
  }
}
