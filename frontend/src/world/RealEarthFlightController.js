import * as THREE from 'three';
import { BOOST, PHYSICS } from '../config.js';
import { FlightPhysics } from '../physics/FlightPhysics.js';
import { ASSET_SOURCES } from '../assets/AssetCatalog.js';

const EARTH_RADIUS_METERS = 6378137;
const GROUND_CLEARANCE_METERS = 2.4;
const FLIGHT_CLEARANCE_METERS = 5.5;

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

const _forward = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _velocityDir = new THREE.Vector3();
const _desiredVelocity = new THREE.Vector3();
const _cameraOffset = new THREE.Vector3();
const _rotationEuler = new THREE.Euler();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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
    this.modelSource = null;
    this.planeEntity = null;
    this.boostFuel = BOOST.MAX_FUEL;
    this.boostCooldown = 0;
    this.boostActive = false;
    this.throttle = 0;
    this.gForce = 1;
    this.landed = null;
    this.nearGround = false;
    this.gearDeployed = true;
    this.grounded = true;
    this.warning = 'Holding short';
    this.launchLabel = 'Earth ground start';
    this.controlState = { pitch: 0, roll: 0, yaw: 0 };
    this.quaternion = new THREE.Quaternion();
    this.position = new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.prevVelocity = new THREE.Vector3();
    this.lat = 0;
    this.lon = 0;
    this.terrainHeight = 0;
    this.surfaceHeight = 0;
    this.surfaceClearance = GROUND_CLEARANCE_METERS;
    this.cameraZoom = 1;
    this.impactFlash = 0;
    this.cameraJolt = 0;
    this._lastImpactTime = 0;
    this._cameraDestination = null;

    this._onKeyDown = this._handleKeyDown.bind(this);
    this._onKeyUp = this._handleKeyUp.bind(this);
    this._onWheel = this._handleWheel.bind(this);
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

    const sampled = await this._sampleSurface(lonDeg, latDeg);
    const modelOffset = Math.max(0, Number(this.modelSource?.offsetY) || 0);
    this.surfaceClearance = GROUND_CLEARANCE_METERS + modelOffset;
    this.lat = Cesium.Math.toRadians(latDeg);
    this.lon = Cesium.Math.toRadians(lonDeg);
    this.terrainHeight = sampled.terrainHeight;
    this.surfaceHeight = sampled.surfaceHeight;
    this.position.set(0, this.surfaceHeight + this.surfaceClearance, 0);
    this.velocity.set(0, 0, 0);
    this.prevVelocity.set(0, 0, 0);
    this.throttle = 0;
    this.boostFuel = BOOST.MAX_FUEL;
    this.boostCooldown = 0;
    this.boostActive = false;
    this.grounded = true;
    this.gearDeployed = true;
    this.warning = 'Holding short';
    this.launchLabel = spawn?.launchLabel ?? 'Earth ground start';
    this.landed = null;
    this.gForce = 1;
    this.cameraZoom = 1;
    this.impactFlash = 0;
    this.cameraJolt = 0;
    this.controlState.pitch = 0;
    this.controlState.roll = 0;
    this.controlState.yaw = 0;
    this.quaternion.identity();
    this.quaternion.setFromEuler(
      new THREE.Euler(0, -THREE.MathUtils.degToRad(Number(spawn?.headingDeg) || 0), 0, 'YXZ')
    );

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
    this.aircraft = null;
    this.modelSource = null;
    this._cameraDestination = null;
    this.callbacks.onFlightState?.(null);
  }

  isActive() {
    return this.active;
  }

  getState() {
    if (!this.aircraft) return null;
    const orientation = this._getOrientationState();
    const speed = this.velocity.length();
    return {
      aircraftName: this.aircraft.name,
      throttle: this.throttle,
      throttlePercent: Math.round(this.throttle * 100),
      boostFuel: this.boostFuel,
      boostActive: this.boostActive,
      speed,
      speedKnots: Math.round(speed * 1.94384),
      altitude: this.position.y,
      altitudeMeters: this.position.y,
      altitudeFeet: Math.round(this.position.y * 3.28084),
      verticalSpeed: this.velocity.y,
      heading: orientation.headingDeg,
      headingDeg: orientation.headingDeg,
      pitchDeg: orientation.pitchDeg,
      rollDeg: orientation.rollDeg,
      gForce: this.gForce,
      isStalling: this.velocity.length() < this.aircraft.stallSpeed * 1.05 && !this.grounded,
      maxSpeed: this.aircraft.maxSpeed,
      stallSpeed: this.aircraft.stallSpeed,
      gearDeployed: this.gearDeployed,
      gearProgress: this.gearDeployed ? 1 : 0,
      grounded: this.grounded,
      onGround: this.grounded,
      landed: this.landed,
      nearGround: this.nearGround,
      launchLabel: this.launchLabel,
      warning: this.warning,
      zoomPercent: Math.round(this.cameraZoom * 100),
      impactFlash: this.impactFlash,
      latitude: THREE.MathUtils.radToDeg(this.lat),
      longitude: THREE.MathUtils.radToDeg(this.lon),
    };
  }

  _bindInputs() {
    window.addEventListener('keydown', this._onKeyDown, true);
    window.addEventListener('keyup', this._onKeyUp, true);
    this.viewer?.canvas?.addEventListener('wheel', this._onWheel, { passive: false });
  }

  _unbindInputs() {
    window.removeEventListener('keydown', this._onKeyDown, true);
    window.removeEventListener('keyup', this._onKeyUp, true);
    this.viewer?.canvas?.removeEventListener('wheel', this._onWheel, { passive: false });
  }

  _handleKeyDown(event) {
    this.keys.add(event.code);
    if (this._usesFlightBinding(event.code)) event.preventDefault();
  }

  _handleKeyUp(event) {
    this.keys.delete(event.code);
    if (this._usesFlightBinding(event.code)) event.preventDefault();
  }

  _handleWheel(event) {
    if (!this.active) return;
    this.adjustZoom(event.deltaY * 0.0014);
    event.preventDefault();
  }

  adjustZoom(delta = 0) {
    this.cameraZoom = clamp(this.cameraZoom + delta, 0.72, 2.25);
    this._applyCamera();
    return this.cameraZoom;
  }

  resetZoom() {
    this.cameraZoom = 1;
    this._applyCamera();
    return this.cameraZoom;
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
    if (!this.active || !this.aircraft) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;

    this._updateFlight(dt);
    this.impactFlash = Math.max(0, this.impactFlash - dt * 1.8);
    this.cameraJolt = Math.max(0, this.cameraJolt - dt * 2.2);
    const Cesium = globalThis.Cesium;
    if (Cesium) this._syncAircraftEntity(Cesium);
    this._applyCamera();
    this.callbacks.onFlightState?.(this.getState());
    this.frameHandle = requestAnimationFrame(this._tick.bind(this));
  }

  _updateFlight(dt) {
    const speed = this.velocity.length();
    this.prevVelocity.copy(this.velocity);

    this._updateThrottleAndBoost(dt);

    const pitchInput = (this._isPressed('pitchUp') ? 1 : 0) - (this._isPressed('pitchDown') ? 1 : 0);
    const rollInput = (this._isPressed('rollRight') ? 1 : 0) - (this._isPressed('rollLeft') ? 1 : 0);
    const yawInput = (this._isPressed('yawRight') ? 1 : 0) - (this._isPressed('yawLeft') ? 1 : 0);
    const braking = this._isPressed('brake');

    const stats = this.aircraft.stats ?? { agility: 3 };
    const authority = clamp(speed / Math.max(this.aircraft.stallSpeed * 0.9, 1), 0, 1);
    const speedRatio = clamp(speed / Math.max(this.aircraft.maxSpeed, 1), 0, 1);
    const pitchResponse = 1 - Math.exp(-dt * (2.8 + stats.agility * 0.72));
    const lateralResponse = 1 - Math.exp(-dt * (5.2 + stats.agility * 1.25));
    const commandPitch = Math.sign(pitchInput) * Math.pow(Math.abs(pitchInput), 1.22) * 0.56;
    const commandRoll = Math.sign(rollInput) * Math.pow(Math.abs(rollInput), 1.12);
    const commandYaw = Math.sign(yawInput) * Math.pow(Math.abs(yawInput), 1.08) * 0.88;

    this.controlState.pitch = THREE.MathUtils.lerp(this.controlState.pitch, commandPitch, pitchResponse);
    this.controlState.roll = THREE.MathUtils.lerp(this.controlState.roll, commandRoll, lateralResponse);
    this.controlState.yaw = THREE.MathUtils.lerp(this.controlState.yaw, commandYaw, lateralResponse);

    _rotationEuler.setFromQuaternion(this.quaternion, 'YXZ');
    const bankAngle = -_rotationEuler.z;
    const coordinatedTurn = Math.sin(bankAngle) * clamp(speed / Math.max(this.aircraft.stallSpeed, 1), 0, 3.2) * 0.26;
    const rollRate = this.aircraft.rollRate * this.controlState.roll * dt * authority;
    const pitchAuthority = authority * THREE.MathUtils.lerp(0.58, 0.34, speedRatio);
    const pitchRate = this.aircraft.pitchRate * this.controlState.pitch * dt * pitchAuthority;
    const yawRate = (this.aircraft.yawRate * this.controlState.yaw + coordinatedTurn) * dt * authority;

    const dq = new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitchRate, -yawRate, -rollRate, 'YXZ'));
    this.quaternion.multiply(dq).normalize();

    if (Math.abs(rollInput) < 0.05 && speed > this.aircraft.stallSpeed * 0.5) {
      _rotationEuler.setFromQuaternion(this.quaternion, 'YXZ');
      _rotationEuler.z *= Math.pow(0.97, dt * 60);
      this.quaternion.setFromEuler(_rotationEuler);
    }

    const forces = FlightPhysics.calculate(
      {
        position: this.position,
        velocity: this.velocity,
        quaternion: this.quaternion,
        throttle: this.throttle,
        brake: braking,
      },
      this.aircraft
    );

    if (this.boostActive) {
      _forward.set(0, 0, -1).applyQuaternion(this.quaternion);
      forces.addScaledVector(_forward, this.aircraft.maxThrust * this.throttle * (BOOST.THRUST_MULTIPLIER - 1));
    }

    const accel = forces.divideScalar(this.aircraft.mass);
    this.gForce = accel.length() / PHYSICS.GRAVITY;

    this.velocity.addScaledVector(accel, dt);
    this._alignVelocityToForward(dt, braking);

    const maxSpeed = this.boostActive ? this.aircraft.maxSpeed * 1.5 : this.aircraft.maxSpeed;
    const nextSpeed = this.velocity.length();
    if (nextSpeed > maxSpeed) {
      this.velocity.multiplyScalar(maxSpeed / nextSpeed);
    }

    this._advanceOnGlobe(dt);
    this.position.y += this.velocity.y * dt;
    const currentSpeed = this.velocity.length();

    const surface = this._sampleSurfaceSync(THREE.MathUtils.radToDeg(this.lon), THREE.MathUtils.radToDeg(this.lat));
    this.terrainHeight = surface.terrainHeight;
    this.surfaceHeight = surface.surfaceHeight;
    const clearance = this.position.y - this.surfaceHeight;
    this.nearGround = clearance < 30;
    this.gearDeployed = this.grounded || clearance < 220 || currentSpeed < this.aircraft.stallSpeed * 1.5;

    const obstacleCollision = surface.obstacleHeight > 4 && this.position.y < this.surfaceHeight + FLIGHT_CLEARANCE_METERS;
    if (!this.grounded && obstacleCollision) {
      this.position.y = this.surfaceHeight + FLIGHT_CLEARANCE_METERS;
      this.velocity.multiplyScalar(0.16);
      this.velocity.y = 0;
      this.warning = 'Obstacle strike';
      this._signalImpact('Obstacle impact');
    }

    const groundLevel = this.surfaceHeight + this.surfaceClearance;
    if (this.position.y <= groundLevel) {
      const impactSpeed = Math.abs(this.prevVelocity.y);
      this.position.y = groundLevel;
      this.grounded = true;
      this.velocity.y = 0;

      if (impactSpeed > 8) {
        this.landed = 'crash';
        this.velocity.multiplyScalar(0.2);
        this.warning = 'Crash landing';
        this._signalImpact('Hard impact');
      } else if (impactSpeed > 2.4) {
        this.landed = 'hard';
        this.velocity.multiplyScalar(0.84);
        this.warning = 'Hard landing';
      } else {
        this.landed = 'smooth';
        this.warning = braking ? 'Braking on rollout' : currentSpeed > 3 ? 'Rolling runway' : 'Holding short';
      }

      if (braking) {
        const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
        const brakingAccel = PHYSICS.GRAVITY * 0.74 + Math.max(2, this.aircraft.stallSpeed * 0.08);
        const nextHorizontal = Math.max(0, horizontalSpeed - brakingAccel * dt);
        const scale = horizontalSpeed > 0.0001 ? nextHorizontal / horizontalSpeed : 0;
        this.velocity.x *= scale;
        this.velocity.z *= scale;
      }

      if (this.throttle < 0.04 && !this.boostActive && Math.hypot(this.velocity.x, this.velocity.z) < Math.max(0.12, this.aircraft.stallSpeed * 0.004)) {
        this.velocity.set(0, 0, 0);
      }
    } else {
      this.grounded = false;
      this.landed = null;
      if (currentSpeed < this.aircraft.stallSpeed * 0.96) {
        this.warning = 'Approaching stall';
      } else if (braking) {
        this.warning = 'Air brake';
      } else if (this.boostActive) {
        this.warning = 'Boost engaged';
      } else {
        this.warning = 'In flight';
      }
    }
  }

  _updateThrottleAndBoost(dt) {
    const throttleInput = (this._isPressed('throttleUp') ? 1 : 0) - (this._isPressed('throttleDown') ? 1 : 0);
    this.throttle = clamp(this.throttle + throttleInput * dt * 0.5, 0, 1);

    const wantsBoost = this._isPressed('boost');
    if (wantsBoost && this.boostFuel > 0 && this.boostCooldown <= 0) {
      this.boostActive = true;
      this.boostFuel = Math.max(0, this.boostFuel - BOOST.DRAIN_RATE * dt);
      if (this.boostFuel <= 0) {
        this.boostCooldown = BOOST.RECHARGE_DELAY;
      }
    } else {
      this.boostActive = false;
      if (this.boostCooldown > 0) {
        this.boostCooldown = Math.max(0, this.boostCooldown - dt);
      } else {
        this.boostFuel = Math.min(BOOST.MAX_FUEL, this.boostFuel + BOOST.RECHARGE_RATE * dt);
      }
    }
  }

  _advanceOnGlobe(dt) {
    const east = this.velocity.x * dt;
    const north = -this.velocity.z * dt;
    const radius = EARTH_RADIUS_METERS + this.position.y;
    this.lat = clamp(this.lat + north / radius, -Math.PI / 2 + 0.0015, Math.PI / 2 - 0.0015);
    this.lon = wrapLongitude(this.lon + east / Math.max(1, radius * Math.cos(this.lat)));
  }

  _alignVelocityToForward(dt, braking) {
    const speed = this.velocity.length();
    if (speed < 0.001) return;

    if (this.grounded && (braking || this.throttle < 0.06)) {
      const damping = Math.exp(-dt * (braking ? 4.8 : 3.4));
      this.velocity.x *= damping;
      this.velocity.z *= damping;
      return;
    }

    _forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
    const minSpeed = Math.max(this.aircraft.stallSpeed * 0.72, 8);
    const targetSpeed = Math.max(speed, minSpeed);
    const agility = this.aircraft.stats?.agility ?? 3;
    const alignmentFactor = 1 - Math.exp(-dt * (18 + agility * 2.8));

    _velocityDir.copy(this.velocity).normalize();
    _velocityDir.lerp(_forward, alignmentFactor).normalize();
    _desiredVelocity.copy(_velocityDir).multiplyScalar(targetSpeed);
    this.velocity.copy(_desiredVelocity);
  }

  _getOrientationState() {
    _forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
    _rotationEuler.setFromQuaternion(this.quaternion, 'YXZ');
    const heading = Math.atan2(_forward.x, -_forward.z);
    const pitch = Math.asin(clamp(_forward.y, -1, 1));
    const roll = -_rotationEuler.z;
    return {
      heading,
      headingDeg: (THREE.MathUtils.radToDeg(heading) % 360 + 360) % 360,
      pitch,
      pitchDeg: THREE.MathUtils.radToDeg(pitch),
      roll,
      rollDeg: THREE.MathUtils.radToDeg(roll),
    };
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
        // Ignore sample failures.
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
    if (!Number.isFinite(terrainHeight)) terrainHeight = this.terrainHeight || 0;

    let surfaceHeight = terrainHeight;
    if (this.viewer.scene.sampleHeightSupported && typeof this.viewer.scene.sampleHeight === 'function') {
      try {
        const sceneHeight = Number(this.viewer.scene.sampleHeight(cartographic, this._collisionExclusions()));
        if (Number.isFinite(sceneHeight)) surfaceHeight = Math.max(surfaceHeight, sceneHeight);
      } catch {
        // Ignore sample failures.
      }
    }

    return {
      terrainHeight,
      surfaceHeight,
      obstacleHeight: Math.max(0, surfaceHeight - terrainHeight),
    };
  }

  _collisionExclusions() {
    return this.planeEntity ? [this.planeEntity] : [];
  }

  _ensurePlaneEntity(Cesium) {
    if (!this.viewer || this.planeEntity) return;
    const uri = this.modelSource?.file || '/assets/Models/private_jet.glb';
    const sizeHint = Math.max(8, Number(this.modelSource?.targetLength) || 16);
    this.planeEntity = this.viewer.entities.add({
      id: `earth-flight-${Date.now()}`,
      position: Cesium.Cartesian3.fromRadians(this.lon, this.lat, this.position.y),
      model: {
        uri,
        minimumPixelSize: clamp(sizeHint * 0.28, 10, 22),
        maximumScale: clamp(sizeHint * 6.5, 90, 340),
        scale: Number(this.modelSource?.earthScale) || 1,
        shadows: Cesium.ShadowMode.ENABLED,
        runAnimations: true,
      },
    });
  }

  _removePlaneEntity() {
    if (this.viewer && this.planeEntity) {
      this.viewer.entities.remove(this.planeEntity);
    }
    this.planeEntity = null;
  }

  _syncAircraftEntity(Cesium) {
    if (!this.planeEntity) return;
    const position = Cesium.Cartesian3.fromRadians(this.lon, this.lat, this.position.y);
    const orientation = this._getOrientationState();
    const yawOffset = Cesium.Math.toRadians(Number(this.modelSource?.rotationY) || 0);
    this.planeEntity.position = position;
    this.planeEntity.orientation = Cesium.Transforms.headingPitchRollQuaternion(
      position,
      new Cesium.HeadingPitchRoll(
        orientation.heading + yawOffset,
        orientation.pitch,
        orientation.roll
      )
    );
  }

  _applyCamera() {
    const Cesium = globalThis.Cesium;
    if (!Cesium || !this.viewer || !this.aircraft) return;

    const position = Cesium.Cartesian3.fromRadians(this.lon, this.lat, this.position.y);
    const orientation = this._getOrientationState();
    const speed = this.velocity.length();
    const sizeHint = Math.max(10, Number(this.modelSource?.targetLength) || 16);
    const zoom = clamp(this.cameraZoom, 0.72, 2.25);
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(position);

    _forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
    _up.set(0, 1, 0).applyQuaternion(this.quaternion).lerp(_worldUp, 0.42).normalize();
    _right.set(1, 0, 0).applyQuaternion(this.quaternion).normalize();

    const chaseDistance = clamp(sizeHint * (1.12 + zoom * 0.9), 16, 132);
    const chaseHeight = clamp(sizeHint * (0.18 + zoom * 0.11), 4.5, 24) + clamp(speed * 0.008, 0, 10);
    _cameraOffset.copy(_forward).multiplyScalar(-chaseDistance).addScaledVector(_up, chaseHeight);
    if (this.cameraJolt > 0.02) {
      _cameraOffset.addScaledVector(_right, (Math.random() - 0.5) * this.cameraJolt * 2.6);
      _cameraOffset.addScaledVector(_up, Math.random() * this.cameraJolt * 1.2);
    }

    const localOffset = new Cesium.Cartesian3(
      _cameraOffset.x,
      -_cameraOffset.z,
      _cameraOffset.y
    );
    const targetDestination = Cesium.Matrix4.multiplyByPoint(enu, localOffset, new Cesium.Cartesian3());
    if (!this._cameraDestination) {
      this._cameraDestination = Cesium.Cartesian3.clone(targetDestination);
    } else {
      Cesium.Cartesian3.lerp(this._cameraDestination, targetDestination, 0.12, this._cameraDestination);
    }

    this.viewer.camera.setView({
      destination: this._cameraDestination,
      orientation: {
        heading: orientation.heading,
        pitch: Cesium.Math.toRadians(-13) + orientation.pitch * 0.16,
        roll: orientation.roll * 0.08,
      },
    });
    this.viewer.scene.requestRender?.();
  }

  _signalImpact(message) {
    const now = performance.now();
    if (now - this._lastImpactTime < 900) return;
    this._lastImpactTime = now;
    this.impactFlash = 1;
    this.cameraJolt = Math.min(1, this.cameraJolt + 0.9);
    this.callbacks.onImpact?.(message);
  }
}
