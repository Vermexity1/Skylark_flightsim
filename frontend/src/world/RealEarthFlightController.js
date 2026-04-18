const EARTH_RADIUS_METERS = 6378137;

export class RealEarthFlightController {
  constructor(viewer, callbacks = {}) {
    this.viewer = viewer;
    this.callbacks = callbacks;
    this.active = false;
    this.frameHandle = 0;
    this.lastTime = 0;
    this.keys = new Set();
    this.bindings = null;
    this.aircraft = null;
    this.state = null;

    this._onKeyDown = this._handleKeyDown.bind(this);
    this._onKeyUp = this._handleKeyUp.bind(this);
  }

  async start({ aircraft, bindings, spawn }) {
    const Cesium = globalThis.Cesium;
    if (!Cesium || !this.viewer) {
      throw new Error('Real Earth flight is unavailable because the globe viewer is not ready.');
    }

    this.stop();
    this.aircraft = aircraft;
    this.bindings = bindings;

    const spawnCartographic = Cesium.Cartographic.fromDegrees(
      Number(spawn.lon),
      Number(spawn.lat),
      0
    );

    let groundHeight = Number(this.viewer.scene.globe.getHeight(spawnCartographic));
    if (!Number.isFinite(groundHeight)) {
      try {
        const [sampled] = await Cesium.sampleTerrainMostDetailed(this.viewer.terrainProvider, [spawnCartographic]);
        groundHeight = Number(sampled?.height);
      } catch {
        groundHeight = 0;
      }
    }
    if (!Number.isFinite(groundHeight)) groundHeight = 0;

    const spawnAltitude = Math.max(
      groundHeight + Math.max(220, Number(aircraft.startAltitude) || 600),
      Number(spawn.altitude) || 1200
    );

    this.state = {
      lon: Cesium.Math.toRadians(Number(spawn.lon)),
      lat: Cesium.Math.toRadians(Number(spawn.lat)),
      altitudeMeters: spawnAltitude,
      groundHeight,
      speedMps: Math.max(45, Number(aircraft.startSpeed) || 90),
      throttle: 0.72,
      heading: 0,
      pitch: Cesium.Math.toRadians(-2),
      roll: 0,
      verticalSpeed: 0,
      aircraftName: aircraft.name,
      maxSpeed: Math.max(120, Number(aircraft.maxSpeed) || 320),
      stallSpeed: Math.max(25, Number(aircraft.stallSpeed) || 60),
    };

    this.active = true;
    this.lastTime = performance.now();
    this._bindInputs();
    this._setCameraControls(false);
    this._applyCamera();
    this.callbacks.onFlightState?.(this.getState());
    this.frameHandle = requestAnimationFrame(this._tick.bind(this));
  }

  stop() {
    if (this.frameHandle) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = 0;
    }
    this.active = false;
    this.lastTime = 0;
    this.keys.clear();
    this._unbindInputs();
    this._setCameraControls(true);
    this.callbacks.onFlightState?.(null);
  }

  isActive() {
    return this.active;
  }

  getState() {
    if (!this.state) return null;
    const Cesium = globalThis.Cesium;
    const headingDeg = Cesium ? Cesium.Math.toDegrees(this.state.heading) : 0;
    const pitchDeg = Cesium ? Cesium.Math.toDegrees(this.state.pitch) : 0;
    const rollDeg = Cesium ? Cesium.Math.toDegrees(this.state.roll) : 0;
    return {
      ...this.state,
      headingDeg,
      pitchDeg,
      rollDeg,
      throttlePercent: Math.round(this.state.throttle * 100),
      altitudeFeet: Math.round(this.state.altitudeMeters * 3.28084),
      speedKnots: Math.round(this.state.speedMps * 1.94384),
    };
  }

  _bindInputs() {
    window.addEventListener('keydown', this._onKeyDown, true);
    window.addEventListener('keyup', this._onKeyUp, true);
  }

  _unbindInputs() {
    window.removeEventListener('keydown', this._onKeyDown, true);
    window.removeEventListener('keyup', this._onKeyUp, true);
  }

  _handleKeyDown(event) {
    this.keys.add(event.code);
    if (this._usesFlightBinding(event.code)) event.preventDefault();
  }

  _handleKeyUp(event) {
    this.keys.delete(event.code);
    if (this._usesFlightBinding(event.code)) event.preventDefault();
  }

  _usesFlightBinding(code) {
    if (!this.bindings) return false;
    return Object.values(this.bindings)
      .filter(value => Array.isArray(value))
      .some(list => list.includes(code));
  }

  _isPressed(action) {
    const codes = this.bindings?.[action] ?? [];
    return codes.some(code => this.keys.has(code));
  }

  _setCameraControls(enabled) {
    const controller = this.viewer?.scene?.screenSpaceCameraController;
    if (!controller) return;
    controller.enableRotate = enabled;
    controller.enableTranslate = enabled;
    controller.enableZoom = enabled;
    controller.enableTilt = enabled;
    controller.enableLook = enabled;
  }

  _tick(now) {
    if (!this.active || !this.state) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;

    this._updateFlight(dt);
    this._applyCamera();
    this.callbacks.onFlightState?.(this.getState());
    this.frameHandle = requestAnimationFrame(this._tick.bind(this));
  }

  _updateFlight(dt) {
    const Cesium = globalThis.Cesium;
    const aircraft = this.aircraft;
    const state = this.state;
    const pitchInput = (this._isPressed('pitchUp') ? 1 : 0) - (this._isPressed('pitchDown') ? 1 : 0);
    const rollInput = (this._isPressed('rollRight') ? 1 : 0) - (this._isPressed('rollLeft') ? 1 : 0);
    const yawInput = (this._isPressed('yawRight') ? 1 : 0) - (this._isPressed('yawLeft') ? 1 : 0);
    const throttleInput = (this._isPressed('throttleUp') ? 1 : 0) - (this._isPressed('throttleDown') ? 1 : 0);
    const braking = this._isPressed('brake');
    const boosting = this._isPressed('boost');

    state.throttle = Cesium.Math.clamp(state.throttle + throttleInput * 0.42 * dt, 0, 1);

    const maxCruise = Math.max(90, aircraft.maxSpeed * (boosting ? 1.22 : 1));
    const targetSpeed = Cesium.Math.lerp(
      Math.max(30, aircraft.stallSpeed * 1.12),
      maxCruise,
      state.throttle
    );
    const brakeDecel = braking ? Math.max(42, state.speedMps * 0.55) : 0;
    state.speedMps += ((targetSpeed - state.speedMps) * 0.82 - brakeDecel) * dt;
    state.speedMps = Math.max(0, state.speedMps);

    const targetRoll = Cesium.Math.toRadians(rollInput * 55);
    state.roll += (targetRoll - state.roll) * Math.min(1, dt * 2.9);
    const pitchRate = Cesium.Math.toRadians((aircraft.pitchRate || 1.2) * 18);
    state.pitch += pitchInput * pitchRate * dt;
    state.pitch = Cesium.Math.clamp(state.pitch, Cesium.Math.toRadians(-38), Cesium.Math.toRadians(38));

    if (!pitchInput) {
      state.pitch *= (1 - Math.min(0.9, dt * 0.55));
    }

    const yawRate = Cesium.Math.toRadians((aircraft.yawRate || 0.7) * 24);
    const bankTurnRate = Math.sin(state.roll) * (state.speedMps / Math.max(80, aircraft.maxSpeed)) * 1.3;
    state.heading += (yawInput * yawRate + bankTurnRate) * dt;

    const horizontalDistance = Math.cos(state.pitch) * state.speedMps * dt;
    const verticalDistance = Math.sin(state.pitch) * state.speedMps * dt;
    const north = Math.cos(state.heading) * horizontalDistance;
    const east = Math.sin(state.heading) * horizontalDistance;
    const radius = EARTH_RADIUS_METERS + state.altitudeMeters;
    state.lat += north / radius;
    state.lon += east / Math.max(1, radius * Math.cos(state.lat));
    state.altitudeMeters += verticalDistance;

    const probe = Cesium.Cartographic.fromRadians(state.lon, state.lat, 0);
    let groundHeight = Number(this.viewer.scene.globe.getHeight(probe));
    if (!Number.isFinite(groundHeight)) groundHeight = state.groundHeight || 0;
    state.groundHeight = groundHeight;
    const minAltitude = groundHeight + 35;
    if (state.altitudeMeters < minAltitude) {
      state.altitudeMeters = minAltitude;
      state.pitch = Math.max(state.pitch, Cesium.Math.toRadians(-2));
      state.speedMps *= braking ? 0.94 : 0.985;
    }
  }

  _applyCamera() {
    const Cesium = globalThis.Cesium;
    if (!Cesium || !this.viewer || !this.state) return;
    this.viewer.camera.setView({
      destination: Cesium.Cartesian3.fromRadians(
        this.state.lon,
        this.state.lat,
        this.state.altitudeMeters
      ),
      orientation: {
        heading: this.state.heading,
        pitch: this.state.pitch,
        roll: this.state.roll,
      },
    });
    this.viewer.scene.requestRender?.();
  }
}
