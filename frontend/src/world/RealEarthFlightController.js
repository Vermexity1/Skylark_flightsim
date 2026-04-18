import { ASSET_SOURCES } from '../assets/AssetCatalog.js';

const EARTH_RADIUS_METERS = 6378137;
const GROUND_CLEARANCE_METERS = 2.8;
const FLIGHT_CLEARANCE_METERS = 8;

const MODEL_FALLBACKS = {
  prop: 'mustang',
  glider: 'mustang',
  jet: 'jet',
  fighter: 'fighter',
  stunt: 'stunt',
  cargo: 'cargo',
  airliner: 'airliner',
  raptor: 'raptor',
  mustang: 'mustang',
  concorde: 'concorde',
  blackbird: 'blackbird',
  stealth_bomber: 'stealth_bomber',
  custom_upload: 'custom_upload',
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function damp(current, target, rate, dt) {
  return current + (target - current) * Math.min(1, rate * dt);
}

function wrapLongitude(lon) {
  const twoPi = Math.PI * 2;
  let value = lon;
  while (value > Math.PI) value -= twoPi;
  while (value < -Math.PI) value += twoPi;
  return value;
}

function wrapAngle(angle) {
  const twoPi = Math.PI * 2;
  let value = angle;
  while (value > Math.PI) value -= twoPi;
  while (value < -Math.PI) value += twoPi;
  return value;
}

function resolveModelSource(type) {
  const aircraftSources = ASSET_SOURCES?.aircraft ?? {};
  if (aircraftSources[type]?.file) return aircraftSources[type];
  const fallback = MODEL_FALLBACKS[type] ?? 'jet';
  if (aircraftSources[fallback]?.file) return aircraftSources[fallback];
  const first = Object.values(aircraftSources).find(entry => entry?.file);
  return first ?? null;
}

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
    this.planeEntity = null;
    this.modelSource = null;
    this._lastImpactTime = 0;

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
    this.modelSource = resolveModelSource(aircraft?.type);

    const lonDeg = Number(spawn?.lon);
    const latDeg = Number(spawn?.lat);
    if (!Number.isFinite(lonDeg) || !Number.isFinite(latDeg)) {
      throw new Error('A valid airport launch point is required for Earth flight.');
    }

    const surface = await this._sampleSurface(lonDeg, latDeg);
    const surfaceHeight = Number.isFinite(surface.surfaceHeight) ? surface.surfaceHeight : 0;
    const clearance = GROUND_CLEARANCE_METERS + Math.max(0, Number(this.modelSource?.offsetY) || 0);

    this.state = {
      lon: Cesium.Math.toRadians(lonDeg),
      lat: Cesium.Math.toRadians(latDeg),
      altitudeMeters: surfaceHeight + clearance,
      terrainHeight: surface.terrainHeight,
      surfaceHeight,
      speedMps: 0,
      throttle: 0,
      heading: Cesium.Math.toRadians(Number(spawn?.headingDeg) || 0),
      pitch: 0,
      roll: 0,
      verticalSpeed: 0,
      grounded: true,
      gearDeployed: true,
      aircraftName: aircraft?.name ?? 'Aircraft',
      launchLabel: spawn?.launchLabel ?? 'Earth airport spawn',
      maxSpeed: Math.max(120, Number(aircraft?.maxSpeed) || 320),
      stallSpeed: Math.max(22, Number(aircraft?.stallSpeed) || 60),
      modelYawOffset: Cesium.Math.toRadians(Number(this.modelSource?.rotationY) || 0),
      warning: 'Holding short',
    };

    this._ensurePlaneEntity(Cesium);
    this._syncAircraftEntity(Cesium);

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
    this._removePlaneEntity();
    this.state = null;
    this.aircraft = null;
    this.modelSource = null;
    this.callbacks.onFlightState?.(null);
  }

  isActive() {
    return this.active;
  }

  getState() {
    if (!this.state) return null;
    const Cesium = globalThis.Cesium;
    return {
      ...this.state,
      latitude: Cesium ? Cesium.Math.toDegrees(this.state.lat) : null,
      longitude: Cesium ? Cesium.Math.toDegrees(this.state.lon) : null,
      headingDeg: Cesium ? Cesium.Math.toDegrees(this.state.heading) : 0,
      pitchDeg: Cesium ? Cesium.Math.toDegrees(this.state.pitch) : 0,
      rollDeg: Cesium ? Cesium.Math.toDegrees(this.state.roll) : 0,
      throttlePercent: Math.round((this.state.throttle ?? 0) * 100),
      altitudeFeet: Math.round((this.state.altitudeMeters ?? 0) * 3.28084),
      speedKnots: Math.round((this.state.speedMps ?? 0) * 1.94384),
      onGround: !!this.state.grounded,
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

  _ensurePlaneEntity(Cesium) {
    if (!this.viewer || this.planeEntity) return;
    const uri = this.modelSource?.file || '/assets/Models/private_jet.glb';
    this.planeEntity = this.viewer.entities.add({
      id: `earth-flight-${Date.now()}`,
      position: Cesium.Cartesian3.fromRadians(this.state.lon, this.state.lat, this.state.altitudeMeters),
      orientation: Cesium.Transforms.headingPitchRollQuaternion(
        Cesium.Cartesian3.fromRadians(this.state.lon, this.state.lat, this.state.altitudeMeters),
        new Cesium.HeadingPitchRoll(
          this.state.heading + this.state.modelYawOffset,
          this.state.pitch,
          this.state.roll
        )
      ),
      model: {
        uri,
        minimumPixelSize: Math.max(54, (Number(this.modelSource?.targetLength) || 16) * 4.4),
        maximumScale: 20000,
        scale: 1,
        silhouetteColor: Cesium.Color.fromCssColorString('#8fd6ff'),
        silhouetteSize: 0.18,
      },
    });
  }

  _removePlaneEntity() {
    if (this.viewer && this.planeEntity) {
      this.viewer.entities.remove(this.planeEntity);
    }
    this.planeEntity = null;
  }

  _tick(now) {
    if (!this.active || !this.state) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;

    this._updateFlight(dt);
    const Cesium = globalThis.Cesium;
    if (Cesium) this._syncAircraftEntity(Cesium);
    this._applyCamera();
    this.callbacks.onFlightState?.(this.getState());
    this.frameHandle = requestAnimationFrame(this._tick.bind(this));
  }

  _updateFlight(dt) {
    const Cesium = globalThis.Cesium;
    if (!Cesium || !this.state || !this.aircraft) return;

    const state = this.state;
    const previous = {
      lon: state.lon,
      lat: state.lat,
      altitudeMeters: state.altitudeMeters,
      terrainHeight: state.terrainHeight,
      surfaceHeight: state.surfaceHeight,
    };

    const pitchInput = (this._isPressed('pitchUp') ? 1 : 0) - (this._isPressed('pitchDown') ? 1 : 0);
    const rollInput = (this._isPressed('rollRight') ? 1 : 0) - (this._isPressed('rollLeft') ? 1 : 0);
    const yawInput = (this._isPressed('yawRight') ? 1 : 0) - (this._isPressed('yawLeft') ? 1 : 0);
    const throttleInput = (this._isPressed('throttleUp') ? 1 : 0) - (this._isPressed('throttleDown') ? 1 : 0);
    const braking = this._isPressed('brake');
    const boosting = this._isPressed('boost');

    state.throttle = clamp(state.throttle + throttleInput * 0.48 * dt, 0, 1);
    state.gearDeployed = state.grounded || (state.altitudeMeters - state.surfaceHeight) < 180;

    if (state.grounded) {
      this._updateGroundFlight(dt, { pitchInput, rollInput, yawInput, braking, boosting });
    } else {
      this._updateAirFlight(dt, { pitchInput, rollInput, yawInput, braking, boosting });
    }

    this._advancePosition(dt);

    const surface = this._sampleSurfaceSync(Cesium.Math.toDegrees(state.lon), Cesium.Math.toDegrees(state.lat));
    state.terrainHeight = surface.terrainHeight;
    state.surfaceHeight = surface.surfaceHeight;

    const obstacleCollision = surface.obstacleHeight > 12 && state.altitudeMeters < surface.surfaceHeight + FLIGHT_CLEARANCE_METERS;
    if (obstacleCollision) {
      state.lon = previous.lon;
      state.lat = previous.lat;
      state.altitudeMeters = previous.altitudeMeters;
      state.terrainHeight = previous.terrainHeight;
      state.surfaceHeight = previous.surfaceHeight;
      state.speedMps = Math.min(state.speedMps, 10);
      state.verticalSpeed = 0;
      state.warning = 'Obstacle collision';
      this._signalImpact('Obstacle impact');
      state.grounded = state.altitudeMeters <= state.surfaceHeight + GROUND_CLEARANCE_METERS + 1;
    }

    const terrainClearance = state.grounded ? GROUND_CLEARANCE_METERS : FLIGHT_CLEARANCE_METERS;
    const minAltitude = state.surfaceHeight + terrainClearance;
    if (state.altitudeMeters <= minAltitude) {
      const impactHard = !state.grounded && (Math.abs(state.verticalSpeed) > 6 || state.speedMps > state.stallSpeed * 1.35 || Math.abs(state.roll) > Cesium.Math.toRadians(22));
      if (impactHard) {
        state.warning = 'Hard landing';
        this._signalImpact('Hard landing on terrain');
      }
      state.altitudeMeters = minAltitude;
      state.grounded = true;
      state.verticalSpeed = 0;
      state.pitch = damp(state.pitch, 0, 5.4, dt);
      state.roll = damp(state.roll, 0, 5.8, dt);
      state.speedMps *= braking ? 0.92 : 0.985;
      if (!impactHard && state.speedMps < 4) {
        state.warning = 'On runway';
      }
    } else {
      state.grounded = false;
    }
  }

  _updateGroundFlight(dt, { pitchInput, rollInput, yawInput, braking, boosting }) {
    const Cesium = globalThis.Cesium;
    const state = this.state;
    const aircraft = this.aircraft;

    const thrustAccel = 2.8 + state.throttle * Math.max(4.5, aircraft.maxThrust / Math.max(aircraft.mass, 1) * 0.085);
    const boostAccel = boosting ? Math.max(2.5, aircraft.maxSpeed * 0.018) : 0;
    const rollingDrag = 1.2 + state.speedMps * 0.038 + (braking ? 12.5 : 0);
    state.speedMps += (thrustAccel + boostAccel - rollingDrag) * dt;
    if (state.throttle < 0.04 && !boosting) state.speedMps -= 1.2 * dt;
    state.speedMps = clamp(state.speedMps, 0, Math.max(34, Math.min(aircraft.maxSpeed * 0.46, 138)));

    const steerRate = Cesium.Math.toRadians(12 + clamp(state.speedMps, 0, 40) * 0.28);
    state.heading = wrapAngle(state.heading + (yawInput + rollInput * 0.24) * steerRate * dt);
    state.pitch = damp(
      state.pitch,
      pitchInput > 0 ? Cesium.Math.toRadians(6.5) : pitchInput < 0 ? Cesium.Math.toRadians(-3) : 0,
      3.1,
      dt
    );
    state.roll = damp(state.roll, Cesium.Math.toRadians(rollInput * 5), 3.6, dt);
    state.verticalSpeed = 0;

    const takeoffWindow = clamp((state.speedMps - aircraft.stallSpeed * 0.92) / Math.max(10, aircraft.stallSpeed * 0.48), 0, 1);
    if (pitchInput > 0 && takeoffWindow > 0.12 && !braking) {
      state.grounded = false;
      state.verticalSpeed = Math.max(2, takeoffWindow * (8 + state.speedMps * 0.06));
      state.warning = 'Rotate';
    } else {
      state.warning = braking
        ? 'Braking on rollout'
        : state.speedMps > 4
          ? 'Taxi / takeoff roll'
          : 'Holding short';
    }
  }

  _updateAirFlight(dt, { pitchInput, rollInput, yawInput, braking, boosting }) {
    const Cesium = globalThis.Cesium;
    const state = this.state;
    const aircraft = this.aircraft;

    const maxCruise = Math.max(90, aircraft.maxSpeed * (boosting ? 1.16 : 1));
    const throttleTarget = Cesium.Math.lerp(
      Math.max(aircraft.stallSpeed * 0.92, 34),
      maxCruise,
      state.throttle
    );
    const drag = state.speedMps * 0.08 + Math.abs(state.roll) * 1.4 + (braking ? 14.5 : 0);
    const noseUpPenalty = Math.max(0, Math.sin(Math.max(0, state.pitch))) * 8.5;
    state.speedMps += ((throttleTarget - state.speedMps) * 0.72 - drag - noseUpPenalty) * dt;
    state.speedMps = Math.max(aircraft.stallSpeed * 0.52, state.speedMps);

    const targetRoll = Cesium.Math.toRadians(rollInput * 62);
    state.roll = damp(state.roll, targetRoll, 3.25, dt);

    const pitchAuthority = Cesium.Math.toRadians((aircraft.pitchRate || 1.2) * 17);
    state.pitch += pitchInput * pitchAuthority * dt;
    if (!pitchInput) {
      const trimPitch = Cesium.Math.toRadians(clamp((state.speedMps - aircraft.stallSpeed) / Math.max(aircraft.maxSpeed * 0.12, 25), -2, 4));
      state.pitch = damp(state.pitch, trimPitch, 0.5, dt);
    }
    state.pitch = clamp(state.pitch, Cesium.Math.toRadians(-24), Cesium.Math.toRadians(34));

    const yawRate = Cesium.Math.toRadians((aircraft.yawRate || 0.8) * 20);
    const bankTurnRate = Math.sin(state.roll) * clamp(state.speedMps / Math.max(aircraft.maxSpeed * 0.42, 60), 0, 2.2) * 1.08;
    state.heading = wrapAngle(state.heading + (yawInput * yawRate + bankTurnRate) * dt);

    const liftFactor = clamp((state.speedMps - aircraft.stallSpeed) / Math.max(aircraft.maxSpeed * 0.34, 45), -0.6, 1.3);
    state.verticalSpeed = Math.sin(state.pitch) * state.speedMps + liftFactor * (11 + state.speedMps * 0.02) - 9.4;
    if (state.speedMps < aircraft.stallSpeed * 0.96) {
      state.verticalSpeed -= 14 * (1 - clamp(liftFactor, 0, 1));
      state.warning = 'Stall margin low';
    } else {
      state.warning = braking
        ? 'Air brake'
        : boosting
          ? 'Boost engaged'
          : 'Climb / cruise';
    }
    state.altitudeMeters += state.verticalSpeed * dt;
  }

  _advancePosition(dt) {
    const state = this.state;
    const horizontalDistance = Math.max(0, Math.cos(state.pitch) * state.speedMps * dt);
    const north = Math.cos(state.heading) * horizontalDistance;
    const east = Math.sin(state.heading) * horizontalDistance;
    const radius = EARTH_RADIUS_METERS + Math.max(0, state.altitudeMeters);
    state.lat = clamp(state.lat + north / radius, -Math.PI / 2 + 0.0015, Math.PI / 2 - 0.0015);
    state.lon = wrapLongitude(state.lon + east / Math.max(1, radius * Math.cos(state.lat)));
  }

  async _sampleSurface(lonDeg, latDeg) {
    const Cesium = globalThis.Cesium;
    const cartographic = Cesium.Cartographic.fromDegrees(Number(lonDeg), Number(latDeg), 0);
    let terrainHeight = Number(this.viewer.scene.globe.getHeight(cartographic));
    if (!Number.isFinite(terrainHeight)) {
      try {
        const [sampled] = await Cesium.sampleTerrainMostDetailed(this.viewer.terrainProvider, [cartographic]);
        terrainHeight = Number(sampled?.height);
      } catch {
        terrainHeight = 0;
      }
    }
    if (!Number.isFinite(terrainHeight)) terrainHeight = 0;

    let surfaceHeight = terrainHeight;
    if (this.viewer.scene.sampleHeightSupported && typeof this.viewer.scene.sampleHeight === 'function') {
      try {
        const sceneHeight = Number(this.viewer.scene.sampleHeight(cartographic, this._collisionExclusions()));
        if (Number.isFinite(sceneHeight)) surfaceHeight = Math.max(surfaceHeight, sceneHeight);
      } catch {
        // Ignore scene height failures and keep terrain fallback.
      }
    }
    return {
      terrainHeight,
      surfaceHeight,
      obstacleHeight: Math.max(0, surfaceHeight - terrainHeight),
    };
  }

  _sampleSurfaceSync(lonDeg, latDeg) {
    const Cesium = globalThis.Cesium;
    const cartographic = Cesium.Cartographic.fromDegrees(Number(lonDeg), Number(latDeg), 0);
    let terrainHeight = Number(this.viewer.scene.globe.getHeight(cartographic));
    if (!Number.isFinite(terrainHeight)) terrainHeight = this.state?.terrainHeight ?? 0;

    let surfaceHeight = terrainHeight;
    if (this.viewer.scene.sampleHeightSupported && typeof this.viewer.scene.sampleHeight === 'function') {
      try {
        const sceneHeight = Number(this.viewer.scene.sampleHeight(cartographic, this._collisionExclusions()));
        if (Number.isFinite(sceneHeight)) surfaceHeight = Math.max(surfaceHeight, sceneHeight);
      } catch {
        // Ignore scene height failures and keep terrain fallback.
      }
    }
    return {
      terrainHeight,
      surfaceHeight,
      obstacleHeight: Math.max(0, surfaceHeight - terrainHeight),
    };
  }

  _collisionExclusions() {
    const excluded = [];
    if (this.planeEntity) excluded.push(this.planeEntity);
    return excluded;
  }

  _syncAircraftEntity(Cesium) {
    if (!this.planeEntity || !this.state) return;
    const position = Cesium.Cartesian3.fromRadians(
      this.state.lon,
      this.state.lat,
      this.state.altitudeMeters
    );
    const hpr = new Cesium.HeadingPitchRoll(
      this.state.heading + this.state.modelYawOffset,
      this.state.pitch,
      this.state.roll
    );
    this.planeEntity.position = position;
    this.planeEntity.orientation = Cesium.Transforms.headingPitchRollQuaternion(position, hpr);
  }

  _applyCamera() {
    const Cesium = globalThis.Cesium;
    if (!Cesium || !this.viewer || !this.state) return;

    const position = Cesium.Cartesian3.fromRadians(
      this.state.lon,
      this.state.lat,
      this.state.altitudeMeters
    );
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(position);
    const chaseDistance = clamp((Number(this.modelSource?.targetLength) || 16) * 2.8, 28, 120);
    const chaseHeight = clamp((Number(this.modelSource?.targetLength) || 16) * 0.75, 8, 34);
    const cameraOffsetLocal = new Cesium.Cartesian3(
      -Math.sin(this.state.heading) * chaseDistance,
      -Math.cos(this.state.heading) * chaseDistance,
      chaseHeight + clamp(this.state.speedMps * 0.015, 0, 18)
    );
    const cameraDestination = Cesium.Matrix4.multiplyByPoint(enu, cameraOffsetLocal, new Cesium.Cartesian3());

    this.viewer.camera.setView({
      destination: cameraDestination,
      orientation: {
        heading: this.state.heading,
        pitch: Cesium.Math.toRadians(-12) + this.state.pitch * 0.2,
        roll: this.state.roll * 0.08,
      },
    });
    this.viewer.scene.requestRender?.();
  }

  _signalImpact(message) {
    const now = performance.now();
    if (now - this._lastImpactTime < 900) return;
    this._lastImpactTime = now;
    this.callbacks.onImpact?.(message);
  }
}
