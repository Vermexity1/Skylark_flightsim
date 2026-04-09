// ============================================================
// Weather System — Rain / Snow particle effects
// Cheap THREE.Points rendered in camera space
// ============================================================
import * as THREE from 'three';

const RAIN_COUNT  = 2000;
const SNOW_COUNT  = 800;
const RAIN_SPEED  = 80;   // m/s fall rate
const SNOW_SPEED  = 8;

export class WeatherSystem {
  /**
   * @param {THREE.Scene}  scene
   * @param {'none'|'rain'|'snow'|'storm'} type
   */
  constructor(scene, type = 'none') {
    this.scene   = scene;
    this._type   = 'none';
    this._rain   = null;
    this._snow   = null;
    this._camera = null;
    this._bounds = 400; // particle spawn radius around camera

    this.setType(type);
  }

  /** Attach camera reference so particles move with player */
  setCamera(camera) { this._camera = camera; }

  setType(type) {
    if (type === this._type) return;
    this._cleanup();
    this._type = type;

    if (type === 'rain' || type === 'storm') {
      this._rain = this._makeRain(type === 'storm' ? RAIN_COUNT * 2 : RAIN_COUNT);
    }
    if (type === 'snow') {
      this._snow = this._makeSnow();
    }
  }

  getType() { return this._type; }

  // ── Rain ────────────────────────────────────────────────
  _makeRain(count) {
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count);   // horizontal drift per particle

    for (let i = 0; i < count; i++) {
      const b = this._bounds;
      pos[i * 3    ] = (Math.random() - 0.5) * b * 2;
      pos[i * 3 + 1] = (Math.random() - 0.5) * b;
      pos[i * 3 + 2] = (Math.random() - 0.5) * b * 2;
      vel[i] = (Math.random() - 0.5) * 6;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    const mat = new THREE.PointsMaterial({
      color:       0x99ccff,
      size:        0.35,
      transparent: true,
      opacity:     0.55,
      depthWrite:  false,
      sizeAttenuation: true,
    });

    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.scene.add(pts);

    return { pts, geo, mat, pos, vel, count };
  }

  // ── Snow ────────────────────────────────────────────────
  _makeSnow() {
    const count = SNOW_COUNT;
    const pos   = new Float32Array(count * 3);
    const drift = new Float32Array(count * 2); // x/z drift speeds

    for (let i = 0; i < count; i++) {
      const b = this._bounds;
      pos[i * 3    ] = (Math.random() - 0.5) * b * 2;
      pos[i * 3 + 1] = (Math.random() - 0.5) * b;
      pos[i * 3 + 2] = (Math.random() - 0.5) * b * 2;
      drift[i * 2    ] = (Math.random() - 0.5) * 2.5;
      drift[i * 2 + 1] = (Math.random() - 0.5) * 2.5;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    const mat = new THREE.PointsMaterial({
      color:           0xffffff,
      size:            1.8,
      transparent:     true,
      opacity:         0.7,
      depthWrite:      false,
      sizeAttenuation: true,
    });

    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.scene.add(pts);

    return { pts, geo, mat, pos, drift, count };
  }

  // ── Update ───────────────────────────────────────────────
  update(dt, aircraftPos) {
    if (!aircraftPos) return;
    const b = this._bounds;

    if (this._rain) {
      const { pos, vel, count, geo } = this._rain;
      for (let i = 0; i < count; i++) {
        const yi = i * 3 + 1;
        pos[i * 3 + 2] += vel[i] * dt;   // slight horizontal drift
        pos[yi] -= RAIN_SPEED * dt;

        // Wrap around camera
        if (pos[yi] < -b * 0.5) {
          pos[i * 3    ] = aircraftPos.x + (Math.random() - 0.5) * b * 2;
          pos[yi]         = aircraftPos.y + b * 0.5;
          pos[i * 3 + 2] = aircraftPos.z + (Math.random() - 0.5) * b * 2;
        }
      }
      this._rain.pts.position.set(0, 0, 0); // particles in world space
      geo.attributes.position.needsUpdate = true;
    }

    if (this._snow) {
      const { pos, drift, count, geo } = this._snow;
      const t = performance.now() * 0.001;
      for (let i = 0; i < count; i++) {
        const xi = i * 3, yi = xi + 1, zi = xi + 2;
        pos[xi] += drift[i * 2]     * dt + Math.sin(t + i) * 0.4 * dt;
        pos[yi] -= (SNOW_SPEED + Math.cos(t * 0.5 + i) * 2) * dt;
        pos[zi] += drift[i * 2 + 1] * dt;

        if (pos[yi] < aircraftPos.y - b * 0.5) {
          pos[xi] = aircraftPos.x + (Math.random() - 0.5) * b * 2;
          pos[yi] = aircraftPos.y + b * 0.5;
          pos[zi] = aircraftPos.z + (Math.random() - 0.5) * b * 2;
        }
      }
      geo.attributes.position.needsUpdate = true;
    }
  }

  _cleanup() {
    const dispose = obj => {
      if (!obj) return;
      this.scene.remove(obj.pts);
      obj.geo.dispose();
      obj.mat.dispose();
    };
    dispose(this._rain); this._rain = null;
    dispose(this._snow); this._snow = null;
  }

  destroy() { this._cleanup(); }
}
