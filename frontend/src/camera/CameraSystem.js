// ============================================================
// Camera System
// BUG FIXES:
//   - FIXED drifting camera: proper smooth follow with delta-time lerp
//   - TWO modes:
//       'follow'   — locked behind plane, always centered, smooth lag
//       'free'     — orbit camera, player rotates freely, plane moves independently
//       'cockpit'  — first-person view inside cockpit
//       'cinematic'— slow orbit around plane for screenshots
// ============================================================
import * as THREE from 'three';
import { CAMERA_CONFIG } from '../config.js';

export class CameraSystem {
  constructor(renderer) {
    this.renderer = renderer;
    this.camera   = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 14000);

    // Mode: 'cockpit' | 'follow' | 'free'
    this.mode  = 'follow';
    this.modes = ['cockpit', 'follow', 'free'];

    // Smoothed targets (FIX: initialized to avoid jump-on-first-frame)
    this._smoothPos  = new THREE.Vector3();
    this._smoothLook = new THREE.Vector3();
    this._initialized = false;
    this._targetPos = new THREE.Vector3();
    this._targetLook = new THREE.Vector3();
    this._upVector = new THREE.Vector3();
    this._rightVector = new THREE.Vector3();
    this._backVector = new THREE.Vector3();
    this._worldUp = new THREE.Vector3(0, 1, 0);
    this._cameraUp = new THREE.Vector3(0, 1, 0);
    this._currentFov = this.camera.fov;
    this._followZoom = 1;
    this._cockpitFovBias = 0;
    this._replayActive = false;
    this._replayProgress = 0;
    this._cinematicOrbit = 0;

    // Free camera orbit state
    this._freeYaw   = 0;    // horizontal orbit angle (radians)
    this._freePitch = 0.25; // vertical orbit angle
    this._freeDistance = 30;
    this._freeDragActive = false;
    this._freePrevMouse = { x: 0, y: 0 };

    // Shake
    this._shakeOffset = new THREE.Vector3();
    this._impactShake = 0;

    // Resize
    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
    this._onResize();

    // Mouse events for free-camera orbit
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp   = this._onMouseUp.bind(this);
    this._onWheel     = this._onWheel.bind(this);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseup',   this._onMouseUp);
    window.addEventListener('wheel',     this._onWheel, { passive: true });
  }

  // ── Public API ──────────────────────────────────────────────

  getCamera() { return this.camera; }

  getMode() { return this._replayActive ? 'cinematic' : this.mode; }

  setReplayActive(active, progress = 0) {
    this._replayActive = !!active;
    this._replayProgress = progress;
    if (!active) {
      this._initialized = false;
    }
  }

  addImpactShake(amount = 0.5) {
    this._impactShake = Math.min(1.6, this._impactShake + amount);
  }

  toggleMode() {
    const idx = this.modes.indexOf(this.mode);
    this.mode = this.modes[(idx + 1) % this.modes.length];
    const cfg = CAMERA_CONFIG[this.mode];
    if (cfg?.fov) {
      this.camera.fov = cfg.fov;
      this._currentFov = cfg.fov;
      this.camera.updateProjectionMatrix();
    }
    this._initialized = false;
    return this.mode;
  }

  // ── Main update ─────────────────────────────────────────────

  update(state, dt) {
    if (!state) return;
    const { position, forward, quaternion, speed, shakeIntensity, frameRadius } = state;
    const activeMode = this._replayActive ? 'cinematic' : this.mode;

    switch (activeMode) {
      case 'cockpit':   this._updateCockpit(position, quaternion, dt, frameRadius); break;
      case 'follow':    this._updateFollow(position, forward, quaternion, dt, speed, frameRadius); break;
      case 'free':      this._updateFree(position, dt); break;
      case 'cinematic': this._updateCinematic(position, forward, dt, speed, frameRadius, this._replayProgress); break;
    }

    // Camera shake
    this._impactShake = Math.max(0, this._impactShake - dt * 1.9);
    const totalShake = shakeIntensity + this._impactShake;
    if (totalShake > 0) {
      const s = totalShake * 0.35;
      this._shakeOffset.set(
        (Math.random() - 0.5) * s,
        (Math.random() - 0.5) * s * 0.5,
        0
      );
      this.camera.position.add(this._shakeOffset);
    }

    this._updateDynamicFov(speed, dt, activeMode);
  }

  // ── Cockpit ─────────────────────────────────────────────────
  // ── Locked Follow (FIX: no more drift) ───────────────────────
  _updateCockpit(position, quaternion, dt, frameRadius = 2.4) {
    const cfg = CAMERA_CONFIG.cockpit;
    this._rightVector.set(1, 0, 0).applyQuaternion(quaternion);
    this._upVector.set(0, 1, 0).applyQuaternion(quaternion);
    this._backVector.set(0, 0, -1).applyQuaternion(quaternion);
    this._cameraUp.copy(this._upVector).lerp(this._worldUp, 0.18).normalize();
    const cockpitHeight = cfg.offset.y + frameRadius * 0.34;
    const cockpitForward = cfg.offset.z + frameRadius * 0.58;

    this._targetPos.copy(position)
      .addScaledVector(this._rightVector, cfg.offset.x)
      .addScaledVector(this._upVector, cockpitHeight)
      .addScaledVector(this._backVector, cockpitForward);

    this._targetLook.copy(this._targetPos)
      .addScaledVector(this._backVector, cfg.lookAhead + frameRadius * 3.8)
      .addScaledVector(this._cameraUp, 0.18);

    if (!this._initialized) {
      this._smoothPos.copy(this._targetPos);
      this._smoothLook.copy(this._targetLook);
      this._initialized = true;
    }

    const factor = 1.0 - Math.pow(0.02, dt * 60);
    this._smoothPos.lerp(this._targetPos, factor);
    this._smoothLook.lerp(this._targetLook, factor);

    this.camera.position.copy(this._smoothPos);
    this.camera.up.copy(this._cameraUp);
    this.camera.lookAt(this._smoothLook);
  }

  _updateFollow(position, forward, quaternion, dt, speed, frameRadius = 2.4) {
    const cfg = CAMERA_CONFIG.follow;
    const zoom = THREE.MathUtils.clamp(this._followZoom, 0.68, 2.4);
    const followDistance = Math.max(cfg.distance * zoom, frameRadius * (3.6 + zoom * 1.1));
    const followHeight = Math.max(cfg.height * (0.82 + zoom * 0.16), frameRadius * 0.9 + 3.8);

    this._backVector.copy(forward).negate();
    this._upVector.set(0, 1, 0).applyQuaternion(quaternion).lerp(this._worldUp, 0.65).normalize();
    this._targetPos.copy(position)
      .addScaledVector(this._backVector, followDistance)
      .addScaledVector(this._upVector, followHeight);
    this._targetLook.copy(position)
      .addScaledVector(forward, Math.max(14, frameRadius * 3.2))
      .addScaledVector(this._upVector, Math.max(1.8, frameRadius * 0.5));

    if (!this._initialized) {
      this._smoothPos.copy(this._targetPos);
      this._smoothLook.copy(this._targetLook);
      this._initialized = true;
    }

    const factor = 1.0 - Math.pow(cfg.smoothing, dt * 60);
    this._smoothPos.lerp(this._targetPos, factor);
    this._smoothLook.lerp(this._targetLook, factor);

    this.camera.position.copy(this._smoothPos);
    this.camera.up.copy(this._worldUp);
    this.camera.lookAt(this._smoothLook);
  }

  // ── Free Orbit ───────────────────────────────────────────────
  // Plane moves independently; player rotates camera with mouse drag
  _updateFree(position, dt) {
    const cfg = CAMERA_CONFIG.free;

    const x = position.x + Math.sin(this._freeYaw) * Math.cos(this._freePitch) * this._freeDistance;
    const y = position.y + Math.sin(this._freePitch) * this._freeDistance + cfg.height * 0.5;
    const z = position.z + Math.cos(this._freeYaw) * Math.cos(this._freePitch) * this._freeDistance;

    if (!this._initialized) {
      this.camera.position.set(x, y, z);
      this._initialized = true;
    }

    // Smooth position chase
    const factor = 1.0 - Math.pow(0.08, dt * 60);
    this.camera.position.lerp(new THREE.Vector3(x, y, z), factor);
    this.camera.lookAt(position.x, position.y, position.z);
  }

  // ── Cinematic Orbit ──────────────────────────────────────────
  // ── Mouse events for free-camera orbit ─────────────────────
  _updateCinematic(position, forward, dt, speed, frameRadius = 2.4, progress = 0) {
    const cfg = CAMERA_CONFIG.cinematic;
    const orbitRadius = Math.max(cfg.distance, frameRadius * 6.2);
    this._cinematicOrbit += dt * (cfg.orbitSpeed + speed * 0.00018);
    const angle = this._cinematicOrbit + progress * Math.PI * 1.4;
    const verticalBias = 8 + Math.sin(progress * Math.PI) * 4 + frameRadius * 1.2;

    this._targetPos.set(
      position.x + Math.sin(angle) * orbitRadius,
      position.y + verticalBias,
      position.z + Math.cos(angle) * orbitRadius
    );
    this._targetLook.copy(position)
      .addScaledVector(forward, frameRadius * 1.8)
      .add(new THREE.Vector3(0, frameRadius * 0.55, 0));

    if (!this._initialized) {
      this._smoothPos.copy(this._targetPos);
      this._smoothLook.copy(this._targetLook);
      this._initialized = true;
    }

    const factor = 1.0 - Math.pow(cfg.smoothing, dt * 60);
    this._smoothPos.lerp(this._targetPos, factor);
    this._smoothLook.lerp(this._targetLook, factor);
    this.camera.position.copy(this._smoothPos);
    this.camera.up.copy(this._worldUp);
    this.camera.lookAt(this._smoothLook);
  }

  _onMouseDown(e) {
    if (this.mode !== 'free') return;
    if (e.button === 2 || e.button === 0) {
      this._freeDragActive = true;
      this._freePrevMouse = { x: e.clientX, y: e.clientY };
    }
  }
  _onMouseMove(e) {
    if (!this._freeDragActive || this.mode !== 'free') return;
    const dx = e.clientX - this._freePrevMouse.x;
    const dy = e.clientY - this._freePrevMouse.y;
    this._freeYaw   -= dx * 0.006;
    this._freePitch  = THREE.MathUtils.clamp(this._freePitch - dy * 0.005, -0.3, 1.4);
    this._freePrevMouse = { x: e.clientX, y: e.clientY };
  }
  _onMouseUp()    { this._freeDragActive = false; }
  _onWheel(e) {
    if (this.mode === 'free') {
      this._freeDistance = THREE.MathUtils.clamp(this._freeDistance + e.deltaY * 0.05, 10, 150);
      return;
    }
    if (this.mode === 'follow') {
      this._followZoom = THREE.MathUtils.clamp(this._followZoom + e.deltaY * 0.0014, 0.68, 2.4);
      return;
    }
    if (this.mode === 'cockpit') {
      this._cockpitFovBias = THREE.MathUtils.clamp(this._cockpitFovBias + e.deltaY * 0.02, -12, 10);
    }
  }

  _updateDynamicFov(speed, dt, mode = this.mode) {
    const cfg = CAMERA_CONFIG[mode] ?? CAMERA_CONFIG.follow;
    const baseFov = cfg.fov ?? 60;
    const maxSpeed = mode === 'cockpit' ? 280 : mode === 'free' ? 360 : 420;
    const speedRatio = THREE.MathUtils.clamp((speed ?? 0) / maxSpeed, 0, 1.25);
    const extraFov = mode === 'cockpit'
      ? speedRatio * 4
      : mode === 'free'
        ? speedRatio * 5
        : mode === 'cinematic'
          ? speedRatio * 2
        : speedRatio * 8;
    const targetFov = baseFov + extraFov + (mode === 'cockpit' ? this._cockpitFovBias : 0);
    const blend = 1 - Math.exp(-dt * 4.5);
    this._currentFov = THREE.MathUtils.lerp(this._currentFov, targetFov, blend);
    if (Math.abs(this.camera.fov - this._currentFov) > 0.01) {
      this.camera.fov = this._currentFov;
      this.camera.updateProjectionMatrix();
    }
  }

  // ── Utilities ───────────────────────────────────────────────
  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  destroy() {
    window.removeEventListener('resize',    this._onResize);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mouseup',   this._onMouseUp);
    window.removeEventListener('wheel',     this._onWheel);
  }
}
