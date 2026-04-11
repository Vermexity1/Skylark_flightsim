import * as THREE from 'three';
import { AIRCRAFT, CHALLENGE, RACE } from '../config.js';
import { AircraftModels } from '../aircraft/AircraftModels.js';

const AI_TYPES = ['prop', 'jet', 'fighter', 'stunt', 'mustang', 'glider', 'cargo', 'blackbird', 'concorde', 'raptor'];

export class RaceSystem {
  constructor(scene, world, careerSystem) {
    this.scene = scene;
    this.world = world;
    this.career = careerSystem;
    this.track = CHALLENGE.COURSES.air_race.map(point => new THREE.Vector3(point.x, point.y, point.z));
    this.active = false;
    this.mode = 'race_practice';
    this.aiRacers = [];
    this.finishOrder = [];
    this.playerGate = 0;
    this.playerLap = 1;
    this.playerProgress = 0;
    this.playerFinished = false;
    this.playerPlace = 1;
    this.playerStunTimer = 0;
    this.playerHitFlash = 0;
    this.countdown = 0;
    this.practiceRankIndex = 0;
    this._shotCooldown = 0;
    this._lastResult = null;
    this._playerPosition = new THREE.Vector3();
    this.offTrackTimer = 0;
    this._pendingRespawnTransform = null;
    this.playerSpawnSlot = 0;
  }

  start(mode, playerAircraftType, options = {}) {
    this.stop();
    this.active = true;
    this.mode = mode;
    this.playerGate = 0;
    this.playerLap = 1;
    this.playerProgress = 0;
    this.playerFinished = false;
    this.playerPlace = 1;
    this.playerStunTimer = 0;
    this.playerHitFlash = 0;
    this.countdown = 3.8;
    this.practiceRankIndex = options.practiceRankIndex ?? 0;
    this.playerSpawnSlot = options.spawnSlot ?? 0;
    this._lastResult = null;
    this.offTrackTimer = 0;
    this._pendingRespawnTransform = null;
    this.finishOrder = [];

    const difficulty = mode === 'race_practice'
      ? (RACE.RANKS[this.practiceRankIndex] ?? RACE.RANKS[0]).aiSkill
      : (this.career?.getDifficultyScale?.() ?? 0.82);
    for (let i = 1; i < RACE.RACER_COUNT; i++) {
      const type = AI_TYPES[(i + this.playerGate) % AI_TYPES.length] === playerAircraftType
        ? AI_TYPES[(i + 2) % AI_TYPES.length]
        : AI_TYPES[(i + this.playerGate) % AI_TYPES.length];
      const mesh = AircraftModels.create(type);
      this.scene.add(mesh);

      const start = RACE.START_POSITIONS[i];
      const position = new THREE.Vector3(start.x, start.y, start.z);
      position.y = Math.max(position.y, this.world.getSurfaceHeight(position.x, position.z) + 8);
      const nextGate = this.track[0].clone();
      const quaternion = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().lookAt(position, nextGate, new THREE.Vector3(0, 1, 0))
      );

      mesh.position.copy(position);
      mesh.quaternion.copy(quaternion);

      const cfg = AIRCRAFT[type];
      this.aiRacers.push({
        id: `ai-${i}`,
        type,
        mesh,
        position,
        quaternion,
        gateIndex: 0,
        lap: 1,
        progress: 0,
        currentSpeed: 0,
        baseSpeed: cfg.maxSpeed * (0.52 + difficulty * 0.22 + Math.random() * 0.08),
        acceleration: cfg.maxSpeed * (0.16 + difficulty * 0.06 + Math.random() * 0.04),
        integrity: 100,
        stunTimer: 0,
        fireCooldown: 1.2 + Math.random() * 1.8,
        finished: false,
        place: null,
      });
    }
  }

  stop() {
    this.aiRacers.forEach(racer => {
      racer.mesh?.traverse?.(node => {
        if (!node.isMesh) return;
        node.geometry?.dispose?.();
        if (Array.isArray(node.material)) node.material.forEach(material => material.dispose?.());
        else node.material?.dispose?.();
      });
      if (racer.mesh) this.scene.remove(racer.mesh);
    });
    this.aiRacers = [];
    this.active = false;
    this.finishOrder = [];
  }

  update(dt, playerState, shotPackets = [], gunProfile = null) {
    if (!this.active || !playerState) return this.getStatus();

    this.countdown = Math.max(0, this.countdown - dt);
    this._playerPosition.copy(playerState.position);
    this._handlePlayerShots(shotPackets, gunProfile);
    if (this.countdown <= 0) {
      this._updatePlayerProgress(playerState, dt);
    }
    this.playerStunTimer = Math.max(0, this.playerStunTimer - dt);
    this.playerHitFlash = Math.max(0, this.playerHitFlash - dt * 1.4);

    this.aiRacers.forEach(racer => this._updateAIRacer(racer, playerState, dt, gunProfile));
    this._updateStandings();

    return this.getStatus();
  }

  _updatePlayerProgress(playerState, dt) {
    if (this.playerFinished) return;
    const trackState = this.world.getRaceTrackState?.(playerState.position) ?? null;
    if (trackState && !trackState.inside) {
      this.offTrackTimer += dt;
      if (this.offTrackTimer >= 5) {
        this._queueRespawn();
        return;
      }
    } else {
      this.offTrackTimer = Math.max(0, this.offTrackTimer - dt * 2.2);
    }

    const targetGate = this.track[this.playerGate];
    if (playerState.position.distanceTo(targetGate) <= RACE.GATE_RADIUS) {
      this.playerGate++;
      if (this.playerGate >= this.track.length) {
        this.playerGate = 0;
        this.playerLap++;
        if (this.playerLap > RACE.LAP_COUNT) {
          this.playerFinished = true;
          this.finishOrder.push({ id: 'player', place: this.finishOrder.length + 1 });
        }
      }
    }
    const gateFraction = this._segmentFraction(
      playerState.position,
      (this.playerGate - 1 + this.track.length) % this.track.length,
      this.playerGate % this.track.length
    );
    this.playerProgress = (this.playerLap - 1) * this.track.length + this.playerGate + gateFraction;
  }

  _updateAIRacer(racer, playerState, dt, gunProfile) {
    if (racer.finished) return;

    racer.stunTimer = Math.max(0, racer.stunTimer - dt);
    racer.fireCooldown -= dt;

    const target = this.track[racer.gateIndex];
    const toTarget = target.clone().sub(racer.position);
    const distance = toTarget.length();
    const desiredForward = toTarget.normalize();
    const desiredQuaternion = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(racer.position, racer.position.clone().add(desiredForward), new THREE.Vector3(0, 1, 0))
    );
    racer.quaternion.slerp(desiredQuaternion, 1 - Math.exp(-dt * 2.4));

    const cfg = AIRCRAFT[racer.type];
    const damageFactor = THREE.MathUtils.lerp(0.72, 1, THREE.MathUtils.clamp(racer.integrity / 100, 0, 1));
    const speedTarget = this.countdown > 0
      ? 0
      : racer.stunTimer > 0
        ? cfg.stallSpeed * 0.6
        : racer.baseSpeed * damageFactor;
    const maxStep = racer.acceleration * dt;
    if (Math.abs(speedTarget - racer.currentSpeed) <= maxStep) racer.currentSpeed = speedTarget;
    else racer.currentSpeed += Math.sign(speedTarget - racer.currentSpeed) * maxStep;

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(racer.quaternion);
    racer.position.addScaledVector(forward, racer.currentSpeed * dt);
    racer.position.y = THREE.MathUtils.lerp(racer.position.y, target.y, 1 - Math.exp(-dt * 1.7));
    const floor = this.world.getSurfaceHeight(racer.position.x, racer.position.z) + 8;
    if (racer.position.y < floor) racer.position.y = floor;

    racer.mesh.position.copy(racer.position);
    racer.mesh.quaternion.copy(racer.quaternion);

    if (this.countdown <= 0 && distance <= RACE.GATE_RADIUS) {
      racer.gateIndex++;
      if (racer.gateIndex >= this.track.length) {
        racer.gateIndex = 0;
        racer.lap++;
        if (racer.lap > RACE.LAP_COUNT) {
          racer.finished = true;
          racer.place = this.finishOrder.length + 1;
          this.finishOrder.push({ id: racer.id, place: racer.place });
        }
      }
    }

    const gateFraction = this._segmentFraction(
      racer.position,
      (racer.gateIndex - 1 + this.track.length) % this.track.length,
      racer.gateIndex % this.track.length
    );
    racer.progress = (racer.lap - 1) * this.track.length + racer.gateIndex + gateFraction;

    const toPlayer = playerState.position.clone().sub(racer.position);
    const playerDistance = toPlayer.length();
    if (this.countdown <= 0 && playerDistance < 420 && racer.fireCooldown <= 0 && racer.stunTimer <= 0) {
      toPlayer.normalize();
      if (forward.dot(toPlayer) > 0.965) {
        const aiStun = RACE.GUNS.standard.stun * (0.92 + (this.career?.getDifficultyScale?.() ?? 0.82) * 0.08);
        this.playerStunTimer = Math.max(this.playerStunTimer, aiStun);
        this.playerHitFlash = 1;
        racer.fireCooldown = 1.35 + Math.random() * 1.2;
      }
    }
  }

  _handlePlayerShots(shotPackets, gunProfile) {
    if (!shotPackets?.length) return;

    for (const packet of shotPackets) {
      for (const racer of this.aiRacers) {
        if (racer.finished) continue;
        const start = packet.start ?? packet.origin;
        const end = packet.end ?? packet.origin?.clone?.().add(packet.velocity?.clone?.().multiplyScalar?.(0.016) ?? new THREE.Vector3());
        if (!start || !end) continue;
        const segment = end.clone().sub(start);
        const segmentLengthSq = Math.max(segment.lengthSq(), 0.0001);
        const toRacer = racer.position.clone().sub(start);
        const along = THREE.MathUtils.clamp(toRacer.dot(segment) / segmentLengthSq, 0, 1);
        const closestPoint = start.clone().lerp(end, along);
        const miss = closestPoint.distanceTo(racer.position);
        const hitRadius = packet.radius ?? 10;
        if (miss <= hitRadius) {
          racer.stunTimer = Math.max(racer.stunTimer, packet.stun ?? gunProfile?.stun ?? RACE.GUNS.standard.stun);
          racer.integrity = Math.max(30, racer.integrity - 11);
          racer.currentSpeed *= 0.82;
          break;
        }
      }
    }
  }

  _segmentFraction(position, previousIndex, currentIndex) {
    const current = this.track[currentIndex % this.track.length];
    const previous = this.track[(previousIndex + this.track.length) % this.track.length];
    const segment = current.clone().sub(previous);
    const total = Math.max(1, segment.length());
    const local = position.clone().sub(previous);
    return THREE.MathUtils.clamp(local.dot(segment.normalize()) / total, 0, 1);
  }

  _updateStandings() {
    const entries = [
      {
        id: 'player',
        progress: this.playerProgress,
        finished: this.playerFinished,
        place: this.finishOrder.find(entry => entry.id === 'player')?.place ?? null,
      },
      ...this.aiRacers.map(racer => ({
        id: racer.id,
        progress: racer.progress,
        finished: racer.finished,
        place: racer.place ?? this.finishOrder.find(entry => entry.id === racer.id)?.place ?? null,
      })),
    ];
    entries.sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished && a.place !== b.place) return (a.place ?? 999) - (b.place ?? 999);
      return b.progress - a.progress;
    });
    this.playerPlace = entries.findIndex(entry => entry.id === 'player') + 1;
  }

  _queueRespawn() {
    const spawn = this.world.getSpawnTransform?.(this.mode, this.playerSpawnSlot) ?? null;
    if (!spawn) return;
    this.playerGate = 0;
    this.playerProgress = (this.playerLap - 1) * this.track.length;
    this.offTrackTimer = 0;
    this._pendingRespawnTransform = {
      position: spawn.position.clone(),
      quaternion: spawn.quaternion.clone(),
      speed: 0,
      throttle: 0,
    };
  }

  clearRespawnRequest() {
    this._pendingRespawnTransform = null;
  }

  maybeFinalizeCareer(careerSystem) {
    if (!this.active || !this.playerFinished || this._lastResult) return this._lastResult;
    const result = careerSystem?.applyRaceResult?.(this.mode, this.playerPlace) ?? null;
    this._lastResult = result ? { ...result, place: this.playerPlace } : { place: this.playerPlace };
    return this._lastResult;
  }

  _getDirectionHint() {
    const next = this.track[this.playerGate % this.track.length];
    const after = this.track[(this.playerGate + 1) % this.track.length];
    const previous = this.track[(this.playerGate - 1 + this.track.length) % this.track.length];
    if (!next || !after || !previous) return 'Follow chevrons';

    const inDir = next.clone().sub(previous).setY(0).normalize();
    const outDir = after.clone().sub(next).setY(0).normalize();
    const cross = inDir.x * outDir.z - inDir.z * outDir.x;
    const dot = THREE.MathUtils.clamp(inDir.dot(outDir), -1, 1);
    const angle = Math.acos(dot) * THREE.MathUtils.RAD2DEG;

    if (angle < 16) return 'Full throttle';
    if (cross > 0) return angle > 42 ? 'Hard left ahead' : 'Left bend ahead';
    return angle > 42 ? 'Hard right ahead' : 'Right bend ahead';
  }

  getStatus() {
    const nextGate = this.track[this.playerGate % this.track.length];
    const raceNextGateDistance = nextGate ? this._playerPosition.distanceTo(nextGate) : 0;
    return {
      raceActive: this.active,
      racePlace: this.playerPlace,
      raceTotal: RACE.RACER_COUNT,
      raceLap: Math.min(this.playerLap, RACE.LAP_COUNT),
      raceTotalLaps: RACE.LAP_COUNT,
      raceFinished: this.playerFinished,
      racePlayerStunned: this.playerStunTimer > 0,
      racePlayerStunTimer: this.playerStunTimer,
      raceHitFlash: this.playerHitFlash,
      raceCountdown: this.countdown,
      raceCountdownActive: this.countdown > 0,
      racePracticeRankName: (RACE.RANKS[this.practiceRankIndex] ?? RACE.RANKS[0]).name,
      raceNextGate: this.playerGate + 1,
      raceNextGateIndex: this.playerGate,
      raceNextGateDistance,
      raceDirectionHint: this._getDirectionHint(),
      raceOffTrackTimer: this.offTrackTimer,
      raceOffTrackWarning: this.offTrackTimer > 0,
      raceRespawnTransform: this._pendingRespawnTransform,
      raceResult: this._lastResult,
    };
  }

  destroy() {
    this.stop();
  }
}
