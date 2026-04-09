import * as THREE from 'three';

function cloneStateSnapshot(state) {
  return {
    position: state.position.clone(),
    quaternion: state.quaternion.clone(),
    velocity: state.velocity.clone(),
    forward: state.forward.clone(),
    speed: state.speed,
    altitude: state.altitude,
    verticalSpeed: state.verticalSpeed,
    heading: state.heading,
    throttle: state.throttle,
    boostFuel: state.boostFuel,
    boostActive: state.boostActive,
    gForce: state.gForce,
    isStalling: state.isStalling,
    aircraftType: state.aircraftType,
    aircraftName: state.aircraftName,
    frameRadius: state.frameRadius,
    condition: state.condition,
    damageState: state.damageState,
    stats: state.stats ? { ...state.stats } : null,
    maxSpeed: state.maxSpeed,
    stallSpeed: state.stallSpeed,
    nearGround: state.nearGround,
    landed: state.landed,
    shakeIntensity: state.shakeIntensity ?? 0,
    replayGhost: true,
  };
}

export class ReplaySystem {
  constructor({ sampleRate = 1 / 15, maxSeconds = 28 } = {}) {
    this.sampleRate = sampleRate;
    this.maxSeconds = maxSeconds;
    this._sampleTimer = 0;
    this._frames = [];
    this._playFrames = [];
    this._playTime = 0;
    this._playing = false;
    this._duration = 0;
    this._interpPos = new THREE.Vector3();
    this._interpQuat = new THREE.Quaternion();
    this._interpVel = new THREE.Vector3();
    this._interpForward = new THREE.Vector3();
  }

  reset() {
    this._sampleTimer = 0;
    this._frames.length = 0;
    this._playFrames.length = 0;
    this._playTime = 0;
    this._playing = false;
    this._duration = 0;
  }

  record(state, dt) {
    if (this._playing || !state?.position || !state?.quaternion || !state?.velocity || !state?.forward) {
      return;
    }

    this._sampleTimer += dt;
    if (this._sampleTimer < this.sampleRate && this._frames.length > 0) return;
    this._sampleTimer = 0;

    this._frames.push({
      time: this._frames.length ? this._frames[this._frames.length - 1].time + this.sampleRate : 0,
      state: cloneStateSnapshot(state),
    });

    const maxFrames = Math.ceil(this.maxSeconds / this.sampleRate);
    if (this._frames.length > maxFrames) {
      this._frames.splice(0, this._frames.length - maxFrames);
    }
  }

  startFinishReplay(seconds = 5.2) {
    if (this._frames.length < 3) return false;
    const needed = Math.max(3, Math.ceil(seconds / this.sampleRate));
    this._playFrames = this._frames.slice(Math.max(0, this._frames.length - needed));
    this._playTime = 0;
    this._duration = Math.max(this.sampleRate, (this._playFrames.length - 1) * this.sampleRate);
    this._playing = this._playFrames.length >= 2;
    return this._playing;
  }

  isPlaying() {
    return this._playing;
  }

  update(dt) {
    if (!this._playing || this._playFrames.length < 2) return null;

    this._playTime = Math.min(this._duration, this._playTime + dt);
    const progress = this._duration <= 0 ? 1 : this._playTime / this._duration;
    const rawIndex = progress * (this._playFrames.length - 1);
    const index = Math.min(this._playFrames.length - 2, Math.floor(rawIndex));
    const alpha = rawIndex - index;
    const a = this._playFrames[index].state;
    const b = this._playFrames[index + 1].state;

    this._interpPos.copy(a.position).lerp(b.position, alpha);
    this._interpQuat.copy(a.quaternion).slerp(b.quaternion, alpha);
    this._interpVel.copy(a.velocity).lerp(b.velocity, alpha);
    this._interpForward.copy(a.forward).lerp(b.forward, alpha).normalize();

    const snapshot = {
      ...a,
      position: this._interpPos.clone(),
      quaternion: this._interpQuat.clone(),
      velocity: this._interpVel.clone(),
      forward: this._interpForward.clone(),
      speed: THREE.MathUtils.lerp(a.speed, b.speed, alpha),
      altitude: THREE.MathUtils.lerp(a.altitude, b.altitude, alpha),
      verticalSpeed: THREE.MathUtils.lerp(a.verticalSpeed, b.verticalSpeed, alpha),
      heading: THREE.MathUtils.lerp(a.heading, b.heading, alpha),
      throttle: THREE.MathUtils.lerp(a.throttle, b.throttle, alpha),
      boostFuel: THREE.MathUtils.lerp(a.boostFuel ?? 0, b.boostFuel ?? 0, alpha),
      gForce: THREE.MathUtils.lerp(a.gForce ?? 1, b.gForce ?? 1, alpha),
      shakeIntensity: 0,
    };

    const finished = this._playTime >= this._duration - 1e-4;
    if (finished) {
      this._playing = false;
    }

    return { snapshot, finished, progress };
  }

  getStatus() {
    return {
      replayActive: this._playing,
      replayProgress: this._duration <= 0 ? 0 : THREE.MathUtils.clamp(this._playTime / this._duration, 0, 1),
    };
  }

  destroy() {
    this.reset();
  }
}
