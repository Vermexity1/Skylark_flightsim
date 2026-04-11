// ============================================================
// Aircraft Controller
// Integrates physics, handles input, manages state
// BUG FIXES:
//   - Aircraft stats now correctly read from config per type
//   - Terrain collision improved with smooth bounce
//   - Obstacle collision detection wired up
// ============================================================
import * as THREE from 'three';
import { AIRCRAFT, BOOST, PHYSICS, DEBUG, RENDER } from '../config.js';
import { FlightPhysics } from '../physics/FlightPhysics.js';
import { AircraftModels } from './AircraftModels.js';

export class AircraftController {
  constructor(scene) {
    this.scene = scene;

    // THREE objects
    this.mesh   = null;
    this.config = null;
    this.baseConfig = null;
    this.aircraftType = null;

    // State
    this.position  = new THREE.Vector3(0, 300, 0);
    this.velocity  = new THREE.Vector3(0, 0, -50);
    this.quaternion = new THREE.Quaternion();
    this.throttle  = 0.4;

    // Physics tracking
    this.isStalling   = false;
    this.gForce       = 1;
    this._prevVelocity = new THREE.Vector3();

    // Boost
    this.boostFuel     = BOOST.MAX_FUEL;
    this.boostActive   = false;
    this.boostCooldown = 0;

    // Ground
    this.getTerrainHeight  = null;
    this.checkObstacleHit  = null;
    this.checkObstacleSweep = null;
    this.waterLevel        = -200;
    this.landed            = null;
    this.landedTimer       = 0;
    this.nearGround        = false;

    // Camera shake
    this.shakeIntensity = 0;

    // Stats that the HUD shows — updated each loadAircraft call
    this.stats = { speed: 0, agility: 0, stability: 0 };
    this._forwardVector = new THREE.Vector3();
    this._upVector = new THREE.Vector3();
    this._projectedVelocity = new THREE.Vector3();
    this._lateralVelocity = new THREE.Vector3();
    this._desiredVelocity = new THREE.Vector3();
    this._rotationEuler = new THREE.Euler();
    this._rightVector = new THREE.Vector3();
    this._terrainProbe = new THREE.Vector3();
    this.collisionRadius = 2.2;
    this.collisionHalfExtents = new THREE.Vector3(1.2, 0.8, 1.2);
    this.collisionCenterOffset = new THREE.Vector3();
    this._collisionCenter = new THREE.Vector3();
    this._previousPosition = new THREE.Vector3();
    this._previousCollisionCenter = new THREE.Vector3();
    this.collisionBottomOffset = 0.8;
    this.condition = 100;
    this.damageState = 'excellent';
    this._impactEvents = [];
    this._impactCooldown = 0;
    this._controlState = { pitch: 0, roll: 0, yaw: 0 };
    this.stunTimer = 0;
    this.stabilityAssistEnabled = false;
    this.conditionPenaltiesEnabled = true;
    this.trickName = '';
    this.trickTimer = 0;
    this._trickState = null;
    this.isCrashed = false;
    this.isLanded = false;
  }

  // ── Load / switch aircraft ──────────────────────────────────
  loadAircraft(type) {
    if (this.mesh) {
      this.mesh.traverse(c => {
        if (c.isMesh) { c.geometry.dispose(); c.material.dispose?.(); }
      });
      this.scene.remove(this.mesh);
      this.mesh = null;
    }

    const sourceConfig = AIRCRAFT[type];
    if (!sourceConfig) { console.error('[Aircraft] Unknown type:', type); return; }
    this.baseConfig = JSON.parse(JSON.stringify(sourceConfig));
    this.config = {
      ...sourceConfig,
      stats: { ...sourceConfig.stats },
    };

    // FIX: always copy stats from config so HUD shows correct values
    this.stats = { ...this.config.stats };
    this.aircraftType = type;

    this.mesh = AircraftModels.create(type);
    const activeMesh = this.mesh;
    this.mesh.userData.onHydrated = () => {
      if (this.mesh !== activeMesh) return;
      activeMesh.position.copy(this.position);
      activeMesh.quaternion.copy(this.quaternion);
      this._updateCollisionBounds();
      this._refreshDamageVisuals();
    };
    this.scene.add(this.mesh);

    // Reset state
    this.position.set(0, this.config.startAltitude, 0);
    this.velocity.set(0, 0, -this.config.startSpeed);
    this.quaternion.identity();
    this.throttle     = 0.4;
    this.isStalling   = false;
    this.gForce       = 1;
    this.boostFuel    = BOOST.MAX_FUEL;
    this.boostActive  = false;
    this.boostCooldown = 0;
    this.landed       = null;
    this.landedTimer  = 0;
    this._impactCooldown = 0;
    this._impactEvents.length = 0;
    this._controlState.pitch = 0;
    this._controlState.roll = 0;
    this._controlState.yaw = 0;
    this.trickName = '';
    this.trickTimer = 0;
    this._trickState = null;
    this.isCrashed = false;
    this.isLanded = false;
    this._syncMotionToForward(this.config.startSpeed, 1);
    this.mesh.position.copy(this.position);
    this.mesh.quaternion.copy(this.quaternion);
    this._updateCollisionBounds();
    this._refreshDamageVisuals();
  }

  // ── Per-frame update ─────────────────────────────────────────
  update(input, dt) {
    if (!this.mesh || !this.config) return;

    this._prevVelocity.copy(this.velocity);
    this._impactCooldown = Math.max(0, this._impactCooldown - dt);
    this.stunTimer = Math.max(0, this.stunTimer - dt);

    // ── Throttle ────────────────────────────────────────────
    this.throttle = THREE.MathUtils.clamp(
      this.throttle + input.throttle * dt * 0.5, 0, 1
    );
    if (input.brake) {
      this.throttle = Math.max(0, this.throttle - dt * 3.4);
    }

    // ── Boost ────────────────────────────────────────────────
    if (input.boost && this.boostFuel > 0 && this.boostCooldown <= 0) {
      this.boostActive = true;
      this.boostFuel   = Math.max(0, this.boostFuel - BOOST.DRAIN_RATE * dt);
      if (this.boostFuel <= 0) this.boostCooldown = BOOST.RECHARGE_DELAY;
    } else {
      this.boostActive = false;
      if (this.boostCooldown > 0) {
        this.boostCooldown -= dt;
      } else {
        this.boostFuel = Math.min(BOOST.MAX_FUEL, this.boostFuel + BOOST.RECHARGE_RATE * dt);
      }
    }

    // ── Control authority (scales with speed) ──────────────
    const speed = this.velocity.length();
    const conditionFactor = this.conditionPenaltiesEnabled
      ? THREE.MathUtils.lerp(0.78, 1, this.condition / 100)
      : 1;
    const handlingFactor = this.conditionPenaltiesEnabled
      ? THREE.MathUtils.lerp(0.84, 1, this.condition / 100)
      : 1;
    const authority = THREE.MathUtils.clamp(speed / (this.config.stallSpeed * 0.9), 0, 1) * handlingFactor;
    const speedRatio = THREE.MathUtils.clamp(speed / Math.max(this.config.maxSpeed, 1), 0, 1);
    const pitchResponse = 1 - Math.exp(-dt * (2.8 + this.stats.agility * 0.72));
    const lateralResponse = 1 - Math.exp(-dt * (5.2 + this.stats.agility * 1.25));
    const trickInput = this._updateTrickState(dt);
    const assistedInput = this._applyAssistInput(this._applyStunInput(input));
    const rawPitch = trickInput?.pitch ?? assistedInput.pitch;
    const rawRoll = trickInput?.roll ?? assistedInput.roll;
    const rawYaw = trickInput?.yaw ?? assistedInput.yaw;
    const commandPitch = trickInput
      ? rawPitch
      : Math.sign(rawPitch) * Math.pow(Math.abs(rawPitch), 1.22) * 0.56;
    const commandRoll = trickInput
      ? rawRoll
      : Math.sign(rawRoll) * Math.pow(Math.abs(rawRoll), 1.12);
    const commandYaw = trickInput
      ? rawYaw
      : Math.sign(rawYaw) * Math.pow(Math.abs(rawYaw), 1.08) * 0.88;

    this._controlState.pitch = THREE.MathUtils.lerp(this._controlState.pitch, commandPitch, pitchResponse);
    this._controlState.roll = THREE.MathUtils.lerp(this._controlState.roll, commandRoll, lateralResponse);
    this._controlState.yaw = THREE.MathUtils.lerp(this._controlState.yaw, commandYaw, lateralResponse);

    // ── Rotation ────────────────────────────────────────────
    this._rotationEuler.setFromQuaternion(this.quaternion, 'YXZ');
    const bankAngle = -this._rotationEuler.z;
    const coordinatedTurn = Math.sin(bankAngle) * THREE.MathUtils.clamp(speed / Math.max(this.config.stallSpeed, 1), 0, 3.2) * 0.26 * handlingFactor;
    const rollRate  = this.config.rollRate  * this._controlState.roll  * dt * authority;
    const pitchAuthority = authority * THREE.MathUtils.lerp(0.58, 0.34, speedRatio);
    const pitchRate = this.config.pitchRate * this._controlState.pitch * dt * pitchAuthority;
    const yawRate   = (this.config.yawRate * this._controlState.yaw + coordinatedTurn) * dt * authority;

    const dq = new THREE.Quaternion();
    dq.setFromEuler(new THREE.Euler(-pitchRate, -yawRate, -rollRate, 'YXZ'));
    this.quaternion.multiply(dq).normalize();

    // Inertia — gradually level wings when no roll input
    if (Math.abs(input.roll) < 0.05 && !this.isStalling) {
      const euler = new THREE.Euler().setFromQuaternion(this.quaternion, 'YXZ');
      euler.z *= Math.pow(0.97, dt * 60); // decay roll
      this.quaternion.setFromEuler(euler);
    }

    // ── Physics forces ──────────────────────────────────────
    const forces = FlightPhysics.calculate(
      {
        position: this.position,
        velocity: this.velocity,
        quaternion: this.quaternion,
        throttle: this.throttle * conditionFactor,
        brake: !!input.brake,
      },
      this.config
    );

    // Boost adds extra thrust along forward
    if (this.boostActive) {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion);
      forces.addScaledVector(fwd, this.config.maxThrust * this.throttle * (BOOST.THRUST_MULTIPLIER - 1));
    }

    const accel = forces.divideScalar(this.config.mass);
    this.gForce = accel.length() / PHYSICS.GRAVITY;

    // Integrate
    this._previousPosition.copy(this.position);
    this._previousCollisionCenter.copy(this._getCollisionCenter());
    this.velocity.addScaledVector(accel, dt);
    this._alignVelocityToForward(dt, input);

    // Speed cap
    const maxSpd = this.boostActive ? this.config.maxSpeed * 1.5 : this.config.maxSpeed;
    const nextSpeed = this.velocity.length();
    if (nextSpeed > maxSpd) this.velocity.multiplyScalar(maxSpd / nextSpeed);

    this.position.addScaledVector(this.velocity, dt);

    // ── Stall detection ──────────────────────────────────────
    if (speed > 1) {
      const fwd = this._forwardVector.set(0, 0, -1).applyQuaternion(this.quaternion);
      const velDir = this._projectedVelocity.copy(this.velocity).normalize();
      const aoa = Math.acos(THREE.MathUtils.clamp(fwd.dot(velDir), -1, 1));
      this.isStalling = aoa > PHYSICS.STALL_ANGLE && speed < this.config.stallSpeed * 1.5;
    } else {
      this.isStalling = false;
    }

    // ── World boundary ───────────────────────────────────────
    const WORLD_HALF = RENDER.TERRAIN_SIZE * 0.72;
    if (Math.abs(this.position.x) > WORLD_HALF) {
      this.position.x = Math.sign(this.position.x) * WORLD_HALF;
      this.velocity.x *= -0.5;
    }
    if (Math.abs(this.position.z) > WORLD_HALF) {
      this.position.z = Math.sign(this.position.z) * WORLD_HALF;
      this.velocity.z *= -0.5;
    }

    // ── Terrain collision (FIX: robust ground level) ─────────
    const terrainH = this._sampleGroundHeight();
    let groundLevel = terrainH + 0.04;
    const aircraftBottomY = this.position.y - this.collisionBottomOffset;
    this.nearGround = aircraftBottomY < groundLevel + 30;
    const clearance = aircraftBottomY - groundLevel;
    const waterSurface = this.waterLevel + 0.5;
    const waterOnlyHere = terrainH < this.waterLevel - 1.5;

    if (!this.isCrashed && clearance > 0 && clearance < 18 && speed > this.config.stallSpeed * 0.85) {
      const groundEffect = (1 - THREE.MathUtils.clamp(clearance / 18, 0, 1))
        * THREE.MathUtils.clamp(speed / Math.max(this.config.maxSpeed, 1), 0, 1);
      this.velocity.y += groundEffect * dt * 12;
    }

    if (clearance > 8) {
      this.isLanded = false;
      if (this.landed !== 'crash' && this.landedTimer <= 0) {
        this.landed = null;
      }
    }

    // Landing / crash
    if (this.landedTimer > 0) {
      this.landedTimer -= dt;
      if (this.landedTimer <= 0) this.landed = null;
    }

    if (aircraftBottomY <= groundLevel) {
      this.position.y = groundLevel + this.collisionBottomOffset;
      const impactSpeed = Math.abs(this._prevVelocity.y);

      if (impactSpeed > 8) {
        if (!this.isCrashed) {
          this.landed = 'crash';
          this.landedTimer = 2.5;
          this._registerImpact('crash', THREE.MathUtils.clamp(impactSpeed * 2.1, 12, 32), THREE.MathUtils.clamp(impactSpeed / 14, 0.8, 1.6));
        }
        this.isCrashed = true;
        this.isLanded = false;
        this.velocity.multiplyScalar(0.15);
        this.velocity.y  = 0;
      } else if (impactSpeed > 0.5) {
        if (!this.isLanded && !this.isCrashed) {
          this.landed = impactSpeed < 3 ? 'smooth' : 'hard';
          this.landedTimer = 2;
          if (impactSpeed >= 3) {
            this._registerImpact('hard_landing', THREE.MathUtils.clamp(impactSpeed * 0.9, 3, 10), THREE.MathUtils.clamp(impactSpeed / 18, 0.25, 0.65));
          }
        }
        this.isLanded = true;
        this.velocity.y  = 0;
        this.velocity.multiplyScalar(0.90);
      } else {
        if (this.velocity.y < 0) this.velocity.y = 0;
      }
    } else if (waterOnlyHere && aircraftBottomY <= waterSurface) {
      this.position.y = waterSurface + this.collisionBottomOffset;
      if (!this.isCrashed) {
        this.landed = 'crash';
        this.landedTimer = 2.5;
        this._registerImpact('water', 20, 1.05);
      }
      this.isCrashed = true;
      this.isLanded = false;
      this.velocity.multiplyScalar(0.18);
      this.velocity.y = 0;
    }

    if (
      !this.isCrashed &&
      this.isLanded &&
      this.nearGround &&
      this.throttle < 0.04 &&
      !input.boost &&
      Math.abs(input.throttle) < 0.05 &&
      speed < Math.max(0.8, this.config.stallSpeed * 0.06)
    ) {
      this.position.y = groundLevel + this.collisionBottomOffset;
      this.velocity.set(0, 0, 0);
    }

    if (input.brake && this.nearGround) {
      const surfaceSpeed = Math.hypot(this.velocity.x, this.velocity.z);
      const brakingAccel = PHYSICS.GRAVITY * (this.isLanded ? 0.72 : 0.34) + Math.max(2, this.config.stallSpeed * 0.08);
      const nextSurfaceSpeed = Math.max(0, surfaceSpeed - brakingAccel * dt);
      const scale = surfaceSpeed > 0.0001 ? nextSurfaceSpeed / surfaceSpeed : 0;
      this.velocity.x *= scale;
      this.velocity.z *= scale;
      this.velocity.y = Math.min(this.velocity.y, 0);
      if (this.isLanded && this.throttle < 0.02 && nextSurfaceSpeed < Math.max(0.03, this.config.stallSpeed * 0.0015)) {
        this.velocity.set(0, 0, 0);
      }
    }

    // Altitude ceiling
    if (this.position.y > 5000) {
      this.position.y = 5000;
      if (this.velocity.y > 0) this.velocity.y *= 0.4;
    }

    // ── Obstacle collision ───────────────────────────────────
    const currentCollisionCenter = this._getCollisionCenter();
    const obstacleHit = !this.isCrashed && (
      (this.checkObstacleSweep && this.checkObstacleSweep(this._previousCollisionCenter, currentCollisionCenter, this.collisionRadius, this.collisionHalfExtents))
      || (this.checkObstacleHit && this.checkObstacleHit(currentCollisionCenter, this.collisionRadius, this.collisionHalfExtents))
    );
    if (obstacleHit) {
      this.position.copy(this._previousPosition);
      this.landed      = 'crash';
      this.landedTimer = 2.5;
      this.isCrashed   = true;
      this.isLanded    = false;
      this.velocity.set(0, 0, 0);
      this._registerImpact('obstacle', 22, 1.25);
    }

    // ── Camera shake at high speed ───────────────────────────
    const speedFraction = speed / this.config.maxSpeed;
    let targetShake = speedFraction > 0.82
      ? (speedFraction - 0.82) * 0.92
      : 0;
    if (this.isStalling) targetShake = Math.max(targetShake, 0.25);
    if (this.nearGround && speedFraction > 0.55) {
      const runwayBuffet = 0.05 + (1 - THREE.MathUtils.clamp(clearance / 26, 0, 1)) * 0.09;
      targetShake = Math.max(targetShake, runwayBuffet);
    }
    this.shakeIntensity = THREE.MathUtils.lerp(this.shakeIntensity, targetShake, 1 - Math.exp(-dt * 8));

    // ── Update mesh ──────────────────────────────────────────
    this.mesh.position.copy(this.position);
    this.mesh.quaternion.copy(this.quaternion);

    // Propeller spin
    this.mesh.traverse(child => {
      if (child.name && child.name.startsWith('propeller')) {
        child.rotation.z += this.throttle * dt * 85;
      }
    });

    // Afterburner
    const ab = this.mesh.getObjectByName('afterburner');
    if (ab) {
      ab.visible = this.throttle > 0.3 || this.boostActive;
      const scale = this.boostActive ? 1.6 : 0.4 + this.throttle * 0.9;
      ab.scale.setScalar(scale);
      ab.material.opacity = this.boostActive ? 0.85 : 0.2 + this.throttle * 0.5;
    }

    if (DEBUG && Math.random() < 0.02) {
      console.log('[Aircraft]', { type: this.aircraftType, speed: speed.toFixed(1), alt: this.position.y.toFixed(0), stall: this.isStalling });
    }
  }

  // ── Public state getter (used by HUD & camera) ──────────────
  getState() {
    const fwd     = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion);
    const speed   = this.velocity.length();
    const heading = Math.atan2(fwd.x, -fwd.z) * (180 / Math.PI);
    return {
      position:     this.position.clone(),
      velocity:     this.velocity.clone(),
      quaternion:   this.quaternion.clone(),
      forward:      fwd,
      speed,
      altitude:     this.position.y,
      heading:      (heading % 360 + 360) % 360,
      throttle:     this.throttle,
      verticalSpeed: this.velocity.y,
      gForce:       this.gForce,
      isStalling:   this.isStalling,
      aircraftType: this.aircraftType,
      aircraftName: this.config?.name ?? '',
      stats:        this.stats,         // FIX: expose stats for HUD
      maxSpeed:     this.config?.maxSpeed ?? 0,
      stallSpeed:   this.config?.stallSpeed ?? 0,
      boostFuel:    this.boostFuel,
      boostActive:  this.boostActive,
      landed:       this.landed,
      nearGround:   this.nearGround,
      frameRadius:  Math.max(this.collisionHalfExtents.x, this.collisionHalfExtents.y, this.collisionHalfExtents.z),
      collisionBottomOffset: this.collisionBottomOffset,
      assistEnabled: this.stabilityAssistEnabled,
      trickName:    this.trickName,
      trickTimer:   this.trickTimer,
      condition:    this.condition,
      damageState:  this.damageState,
      shakeIntensity: this.shakeIntensity,
      isCrashed:    this.isCrashed,
      isLanded:     this.isLanded,
      stunTimer:    this.stunTimer,
    };
  }

  getObject() { return this.mesh; }

  consumeEvents() {
    return this._impactEvents.splice(0, this._impactEvents.length);
  }

  setCondition(condition) {
    this.condition = THREE.MathUtils.clamp(condition ?? 100, 0, 100);
    this.damageState = this._getDamageState(this.condition);
    this._refreshDamageVisuals();
  }

  repair() {
    this.setCondition(100);
    this.landed = null;
    this.landedTimer = 0;
    this.trickName = '';
    this.trickTimer = 0;
    this._trickState = null;
    this.isCrashed = false;
    this.isLanded = false;
    this._impactCooldown = 0;
  }

  setFlightState({ position, quaternion, speed, throttle, preserveExactSpeed = false }) {
    if (position) this.position.copy(position);
    if (quaternion) this.quaternion.copy(quaternion).normalize();
    if (typeof throttle === 'number') this.throttle = THREE.MathUtils.clamp(throttle, 0, 1);

    const maxSpeed = this.boostActive ? this.config.maxSpeed * 1.5 : this.config.maxSpeed;
    const targetSpeed = THREE.MathUtils.clamp(
      speed ?? this.config.startSpeed,
      preserveExactSpeed ? 0 : Math.max(8, this.config.stallSpeed * 0.7),
      maxSpeed
    );

    if (targetSpeed <= 0.0001) {
      this.velocity.set(0, 0, 0);
    } else {
      this._syncMotionToForward(targetSpeed, 1);
    }

    if (this.mesh) {
      this.mesh.position.copy(this.position);
      this.mesh.quaternion.copy(this.quaternion);
      this._updateCollisionBounds();
    }

    this.landed = null;
    this.landedTimer = 0;
    this.trickName = '';
    this.trickTimer = 0;
    this._trickState = null;
    this.isCrashed = false;
    this.isLanded = targetSpeed <= 0.0001;
  }

  applyExternalFlightState({ position, quaternion, velocity, throttle, landed = false, landedLabel = 'smooth' }) {
    if (position) this.position.copy(position);
    if (quaternion) this.quaternion.copy(quaternion).normalize();
    if (velocity) this.velocity.copy(velocity);
    else this.velocity.set(0, 0, 0);
    if (typeof throttle === 'number') this.throttle = THREE.MathUtils.clamp(throttle, 0, 1);

    if (this.mesh) {
      this.mesh.position.copy(this.position);
      this.mesh.quaternion.copy(this.quaternion);
      this._updateCollisionBounds();
    }

    this._controlState.pitch = 0;
    this._controlState.roll = 0;
    this._controlState.yaw = 0;
    this.trickName = '';
    this.trickTimer = 0;
    this._trickState = null;
    this.isCrashed = false;
    this.isLanded = !!landed;

    if (landed) {
      if (this.landed !== landedLabel) {
        this.landed = landedLabel;
        this.landedTimer = 1.8;
      }
    } else if (this.landed !== 'crash') {
      this.landed = null;
      this.landedTimer = 0;
    }
  }

  toggleStabilityAssist() {
    this.stabilityAssistEnabled = !this.stabilityAssistEnabled;
    return this.stabilityAssistEnabled;
  }

  setConditionPenaltyEnabled(enabled) {
    this.conditionPenaltiesEnabled = !!enabled;
  }

  applyStun(duration = 1.2) {
    this.stunTimer = Math.max(this.stunTimer, duration);
  }

  triggerRandomTrick() {
    if (this.isCrashed || !this.config) return null;
    const terrainH = this.getTerrainHeight ? this.getTerrainHeight(this.position.x, this.position.z) : 0;
    const altitudeClearance = this.position.y - terrainH;
    if (altitudeClearance < 90 || this.velocity.length() < this.config.stallSpeed * 1.15) return null;

    const variants = [
      { id: 'barrel_left', name: 'BARREL LEFT', duration: 1.4 },
      { id: 'barrel_right', name: 'BARREL RIGHT', duration: 1.4 },
      { id: 'victory_roll', name: 'VICTORY ROLL', duration: 1.2 },
      { id: 'pitch_pop', name: 'PITCH POP', duration: 0.95 },
    ];
    const choice = variants[Math.floor(Math.random() * variants.length)];
    this._trickState = { ...choice, elapsed: 0 };
    this.trickName = choice.name;
    this.trickTimer = choice.duration;
    this.isLanded = false;
    this.landed = null;
    return choice.name;
  }

  _alignVelocityToForward(dt, input = null) {
    const speed = this.velocity.length();
    if (speed < 0.001) return;

    if ((this.isLanded || this.landed === 'smooth' || this.landed === 'hard') && (input?.brake || this.throttle < 0.06)) {
      const damping = Math.exp(-dt * (input?.brake ? 4.8 : 3.4));
      this.velocity.x *= damping;
      this.velocity.z *= damping;
      if (Math.hypot(this.velocity.x, this.velocity.z) < Math.max(0.04, this.config.stallSpeed * 0.002)) {
        this.velocity.x = 0;
        this.velocity.z = 0;
      }
      return;
    }

    this._forwardVector.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
    const minSpeed = Math.max(this.config.stallSpeed * 0.72, 8);
    const targetSpeed = Math.max(speed, minSpeed);
    const alignmentFactor = 1 - Math.exp(-dt * (18 + this.stats.agility * 2.8));

    this._projectedVelocity.copy(this.velocity).normalize();
    this._projectedVelocity.lerp(this._forwardVector, alignmentFactor).normalize();
    this._desiredVelocity.copy(this._projectedVelocity).multiplyScalar(targetSpeed);
    this.velocity.copy(this._desiredVelocity);
  }

  _syncMotionToForward(speed, verticalBlend = 0.35) {
    this._forwardVector.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
    this.velocity.copy(this._forwardVector).multiplyScalar(speed);
    this.velocity.y = THREE.MathUtils.lerp(this.velocity.y, this._forwardVector.y * speed, verticalBlend);
  }

  _applyAssistInput(input) {
    if (!this.stabilityAssistEnabled || this._trickState || this.isCrashed) return input;

    const euler = this._rotationEuler.setFromQuaternion(this.quaternion, 'YXZ');
    const rollTrim = THREE.MathUtils.clamp(-euler.z * 1.45, -1, 1);
    const pitchTrim = THREE.MathUtils.clamp(-euler.x * 0.95 - this.velocity.y * 0.014, -1, 1);

    return {
      ...input,
      pitch: Math.abs(input.pitch) > 0.08 ? input.pitch : pitchTrim,
      roll: Math.abs(input.roll) > 0.08 ? input.roll : rollTrim,
      yaw: Math.abs(input.yaw) > 0.08 ? input.yaw : input.yaw * 0.35,
    };
  }

  _updateTrickState(dt) {
    if (!this._trickState) {
      this.trickTimer = 0;
      this.trickName = '';
      return null;
    }

    this._trickState.elapsed += dt;
    const progress = THREE.MathUtils.clamp(this._trickState.elapsed / this._trickState.duration, 0, 1);
    this.trickTimer = Math.max(0, this._trickState.duration - this._trickState.elapsed);

    let control;
    switch (this._trickState.id) {
      case 'barrel_left':
        control = { pitch: progress < 0.35 ? 0.26 : -0.08, roll: -1, yaw: -0.1 };
        break;
      case 'barrel_right':
        control = { pitch: progress < 0.35 ? 0.26 : -0.08, roll: 1, yaw: 0.1 };
        break;
      case 'victory_roll':
        control = { pitch: 0.08, roll: progress < 0.5 ? 1 : -1, yaw: 0.18 };
        break;
      case 'pitch_pop':
        control = { pitch: progress < 0.55 ? 1 : -0.45, roll: 0, yaw: 0 };
        break;
      default:
        control = null;
        break;
    }

    if (this._trickState.elapsed >= this._trickState.duration) {
      this._trickState = null;
      this.trickTimer = 0;
    }

    return control;
  }

  _applyStunInput(input) {
    if (this.stunTimer <= 0) return input;
    const wobble = Math.sin(performance.now() * 0.015) * 0.35;
    return {
      ...input,
      pitch: wobble * 0.4,
      roll: wobble,
      yaw: wobble * 0.5,
      throttle: Math.min(input.throttle ?? 0, -0.2),
      boost: false,
      brake: false,
    };
  }

  _updateCollisionBounds() {
    if (!this.mesh) return;
    this.mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.mesh);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    this.collisionHalfExtents.set(
      Math.max(0.9, size.x * 0.5),
      Math.max(0.6, size.y * 0.5),
      Math.max(0.9, size.z * 0.5)
    );
    this.collisionRadius = Math.max(1.2, Math.max(size.x, size.z) * 0.5);
    this.collisionCenterOffset.copy(center).sub(this.position);
    this.collisionBottomOffset = Math.max(0.6, this.position.y - box.min.y);
  }

  _getCollisionCenter() {
    return this._collisionCenter.copy(this.position).add(this.collisionCenterOffset);
  }

  _sampleGroundHeight() {
    if (!this.getTerrainHeight) return this.waterLevel - 20;

    this._forwardVector.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
    this._rightVector.set(1, 0, 0).applyQuaternion(this.quaternion).normalize();
    const samples = [
      [0, 0],
      [this.collisionHalfExtents.x * 0.9, 0],
      [-this.collisionHalfExtents.x * 0.9, 0],
      [0, this.collisionHalfExtents.z * 0.95],
      [0, -this.collisionHalfExtents.z * 0.95],
      [this.collisionHalfExtents.x * 0.55, this.collisionHalfExtents.z * 0.7],
      [-this.collisionHalfExtents.x * 0.55, this.collisionHalfExtents.z * 0.7],
    ];

    let maxHeight = this.getTerrainHeight(this.position.x, this.position.z);
    for (const [sideOffset, forwardOffset] of samples) {
      this._terrainProbe.copy(this.position)
        .addScaledVector(this._rightVector, sideOffset)
        .addScaledVector(this._forwardVector, forwardOffset);
      maxHeight = Math.max(maxHeight, this.getTerrainHeight(this._terrainProbe.x, this._terrainProbe.z));
    }
    return maxHeight;
  }

  _registerImpact(kind, damage, intensity) {
    if (this._impactCooldown > 0) return;
    this._impactCooldown = 0.85;
    this._impactEvents.push({
      kind,
      damage: Math.round(damage),
      intensity,
      aircraftType: this.aircraftType,
      position: this.position.clone(),
    });
  }

  _getDamageState(condition) {
    if (condition >= 90) return 'excellent';
    if (condition >= 70) return 'good';
    if (condition >= 45) return 'worn';
    if (condition >= 20) return 'damaged';
    return 'critical';
  }

  _refreshDamageVisuals() {
    if (!this.mesh) return;
    const wear = 1 - this.condition / 100;

    this.mesh.traverse(node => {
      if (!node.isMesh || !node.material) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach(material => {
        if (material.userData.originalColor === undefined && material.color) {
          material.userData.originalColor = material.color.clone();
        }
        if (material.userData.originalRoughness === undefined && 'roughness' in material) {
          material.userData.originalRoughness = material.roughness ?? 0.6;
        }
        if (material.color && material.userData.originalColor) {
          material.color.copy(material.userData.originalColor);
          material.color.lerp(new THREE.Color(0x251714), wear * 0.6);
        }
        if ('emissive' in material) {
          material.emissive.setRGB(0.08 * wear, 0.03 * wear, 0.02 * wear);
        }
        if ('roughness' in material) {
          material.roughness = THREE.MathUtils.clamp((material.userData.originalRoughness ?? 0.6) + wear * 0.18, 0, 1);
        }
        material.needsUpdate = true;
      });
    });
  }

  destroy() {
    if (this.mesh) {
      this.mesh.traverse(c => {
        if (c.isMesh) { c.geometry.dispose(); c.material?.dispose(); }
      });
      this.scene.remove(this.mesh);
      this.mesh = null;
    }
  }
}
