import * as THREE from 'three';
import { CHALLENGE, RACE } from '../config.js';
import { AircraftModels } from '../aircraft/AircraftModels.js';

const API_BASE = `${window.location.origin}/api`;

export class OnlineRaceSystem {
  constructor(scene, world, careerSystem) {
    this.scene = scene;
    this.world = world;
    this.career = careerSystem;
    this.track = CHALLENGE.COURSES.air_race.map(point => new THREE.Vector3(point.x, point.y, point.z));
    this.active = false;
    this.mode = 'race_online_casual';
    this.room = null;
    this.rules = {
      speedMultiplier: 1,
      physicsPreset: 'sim',
      autoLandAllowed: false,
    };
    this.playerId = null;
    this.playerFinished = false;
    this.playerGate = 0;
    this.playerLap = 1;
    this.playerProgress = 0;
    this.playerPlace = 1;
    this.remotePlayers = new Map();
    this._lastResult = null;
    this._pollAccumulator = 0;
    this._pollInterval = 0.16;
    this._syncInFlight = false;
    this._playerPosition = new THREE.Vector3();
    this._directionHint = 'Hold the lane';
    this._roomStatus = 'waiting';
    this._countdown = 0;
    this._authToken = null;
  }

  async start(mode, aircraftType, options = {}) {
    this.stop();
    this.active = true;
    this.mode = mode;
    this.playerFinished = false;
    this.playerGate = 0;
    this.playerLap = 1;
    this.playerProgress = 0;
    this.playerPlace = 1;
    this._lastResult = null;
    this._pollAccumulator = 0;
    this._syncInFlight = false;
    this._authToken = options.authToken ?? null;
    this.playerId = options.userId ?? null;
    this.room = options.roomSession?.room ?? null;
    this.rules = { ...this.rules, ...(this.room?.rules ?? {}) };
    this._roomStatus = this.room?.status ?? 'waiting';
    this._countdown = this.room?.countdownRemaining ?? 0;
    this._applySnapshot(options.roomSession);
    return this.getStatus();
  }

  stop() {
    if (this.room?.id && this._authToken) {
      fetch(`${API_BASE}/race/rooms/${this.room.id}/leave`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this._authToken}`,
        },
      }).catch(() => {});
    }

    this.remotePlayers.forEach(player => {
      if (player.mesh) this.scene.remove(player.mesh);
    });
    this.remotePlayers.clear();
    this.active = false;
    this.room = null;
    this.playerId = null;
  }

  update(dt, playerState) {
    if (!this.active || !this.room || !playerState) return this.getStatus();

    this._playerPosition.copy(playerState.position);
    this._pollAccumulator += dt;
    this._directionHint = this._getDirectionHint();

    if (this._roomStatus === 'live') {
      this._updatePlayerProgress(playerState);
    }

    if (this._pollAccumulator >= this._pollInterval && !this._syncInFlight) {
      this._pollAccumulator = 0;
      this._syncInFlight = true;
      this._syncState(playerState).finally(() => {
        this._syncInFlight = false;
      });
    }

    this._updateRemoteVisuals(dt);
    this._updatePlaces();
    return this.getStatus();
  }

  _updatePlayerProgress(playerState) {
    if (this.playerFinished) return;
    const targetGate = this.track[this.playerGate];
    if (targetGate && playerState.position.distanceTo(targetGate) <= RACE.GATE_RADIUS) {
      this.playerGate += 1;
      if (this.playerGate >= this.track.length) {
        this.playerGate = 0;
        this.playerLap += 1;
        if (this.playerLap > RACE.LAP_COUNT) {
          this.playerFinished = true;
        }
      }
    }
    const gateFraction = this._gateFraction(playerState.position, this.playerGate);
    this.playerProgress = (this.playerLap - 1) * this.track.length + this.playerGate + gateFraction;
  }

  _gateFraction(position, gateIndex) {
    const current = this.track[gateIndex % this.track.length];
    const previous = this.track[(gateIndex - 1 + this.track.length) % this.track.length];
    if (!current || !previous) return 0;
    const segment = current.clone().sub(previous);
    const total = Math.max(1, segment.length());
    const local = position.clone().sub(previous);
    return THREE.MathUtils.clamp(local.dot(segment.normalize()) / total, 0, 1);
  }

  _getDirectionHint() {
    const next = this.track[this.playerGate % this.track.length];
    const after = this.track[(this.playerGate + 1) % this.track.length];
    const previous = this.track[(this.playerGate - 1 + this.track.length) % this.track.length];
    if (!next || !after || !previous) return 'Follow checkpoint arrows';

    const inDir = next.clone().sub(previous).setY(0).normalize();
    const outDir = after.clone().sub(next).setY(0).normalize();
    const cross = inDir.x * outDir.z - inDir.z * outDir.x;
    const dot = THREE.MathUtils.clamp(inDir.dot(outDir), -1, 1);
    const angle = Math.acos(dot) * THREE.MathUtils.RAD2DEG;

    if (angle < 14) return 'Full throttle';
    if (cross > 0) return angle > 40 ? 'Hard left ahead' : 'Left bend ahead';
    return angle > 40 ? 'Hard right ahead' : 'Right bend ahead';
  }

  async _syncState(playerState) {
    if (!this.room?.id || !this._authToken) return;
    try {
      const response = await fetch(`${API_BASE}/race/rooms/${this.room.id}/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this._authToken}`,
        },
        body: JSON.stringify({
          aircraftType: playerState.aircraftType,
          progress: this.playerProgress,
          lap: this.playerLap,
          gate: this.playerGate,
          finished: this.playerFinished,
          state: {
            position: playerState.position,
            quaternion: playerState.quaternion,
            speed: playerState.speed,
            throttle: playerState.throttle,
          },
        }),
      });
      const snapshot = await response.json();
      if (!response.ok) throw new Error(snapshot?.error || 'Room sync failed');
      this._applySnapshot(snapshot);
    } catch {
      this._roomStatus = 'waiting';
    }
  }

  _applySnapshot(snapshot) {
    if (!snapshot?.room) return;
    this.room = snapshot.room;
    this.rules = { ...this.rules, ...(snapshot.room.rules ?? {}) };
    this._roomStatus = snapshot.room.status ?? 'waiting';
    this._countdown = snapshot.room.countdownRemaining ?? 0;

    const seen = new Set();
    (snapshot.players ?? []).forEach(player => {
      if (player.isSelf) {
        this.playerPlace = player.place ?? this.playerPlace;
        if (Number.isFinite(player.progress)) this.playerProgress = player.progress;
        if (Number.isFinite(player.lap)) this.playerLap = player.lap;
        if (Number.isFinite(player.gate)) this.playerGate = player.gate;
        this.playerFinished = !!player.finished;
        return;
      }

      seen.add(player.userId);
      let remote = this.remotePlayers.get(player.userId);
      if (!remote) {
        const mesh = AircraftModels.create(player.aircraftType);
        mesh.traverse?.(node => {
          if (!node.isMesh || !node.material) return;
          const materials = Array.isArray(node.material) ? node.material : [node.material];
          materials.forEach(material => {
            if ('transparent' in material) material.transparent = true;
            if ('opacity' in material) material.opacity = 0.92;
            if ('emissive' in material) material.emissive?.setHex?.(0x0f3d68);
            if ('emissiveIntensity' in material) material.emissiveIntensity = 0.35;
          });
        });
        this.scene.add(mesh);
        remote = {
          mesh,
          targetPosition: new THREE.Vector3(),
          targetQuaternion: new THREE.Quaternion(),
          progress: 0,
          lap: 1,
          place: null,
          finished: false,
          username: player.username,
        };
        this.remotePlayers.set(player.userId, remote);
      }

      remote.progress = player.progress ?? 0;
      remote.lap = player.lap ?? 1;
      remote.place = player.place ?? null;
      remote.finished = !!player.finished;
      remote.username = player.username;
      remote.targetPosition.set(
        player.state?.position?.x ?? 0,
        player.state?.position?.y ?? 0,
        player.state?.position?.z ?? 0
      );
      remote.targetQuaternion.set(
        player.state?.quaternion?.x ?? 0,
        player.state?.quaternion?.y ?? 0,
        player.state?.quaternion?.z ?? 0,
        player.state?.quaternion?.w ?? 1
      );
      if (!remote.mesh.userData.onlineInitialized) {
        remote.mesh.position.copy(remote.targetPosition);
        remote.mesh.quaternion.copy(remote.targetQuaternion);
        remote.mesh.userData.onlineInitialized = true;
      }
    });

    this.remotePlayers.forEach((remote, userId) => {
      if (!seen.has(userId)) {
        this.scene.remove(remote.mesh);
        this.remotePlayers.delete(userId);
      }
    });
  }

  _updateRemoteVisuals(dt) {
    this.remotePlayers.forEach(remote => {
      remote.mesh.position.lerp(remote.targetPosition, 1 - Math.exp(-dt * 8));
      remote.mesh.quaternion.slerp(remote.targetQuaternion, 1 - Math.exp(-dt * 8));
    });
  }

  _updatePlaces() {
    const entries = [
      {
        id: this.playerId ?? 'self',
        progress: this.playerProgress,
        finished: this.playerFinished,
        place: this.playerFinished ? this.playerPlace : null,
      },
      ...[...this.remotePlayers.entries()].map(([id, remote]) => ({
        id,
        progress: remote.progress,
        finished: remote.finished,
        place: remote.place,
      })),
    ];

    entries.sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished && a.place !== b.place) return (a.place ?? 999) - (b.place ?? 999);
      return (b.progress ?? 0) - (a.progress ?? 0);
    });
    this.playerPlace = entries.findIndex(entry => entry.id === (this.playerId ?? 'self')) + 1;
  }

  maybeFinalizeCareer(careerSystem) {
    if (!this.active || !this.playerFinished || this._lastResult) return this._lastResult;
    const result = careerSystem?.applyRaceResult?.(this.mode, this.playerPlace) ?? null;
    this._lastResult = result ? { ...result, place: this.playerPlace } : { place: this.playerPlace };
    return this._lastResult;
  }

  getStatus() {
    const nextGate = this.track[this.playerGate % this.track.length];
    const raceNextGateDistance = nextGate ? this._playerPosition.distanceTo(nextGate) : 0;
    return {
      raceActive: this.active,
      raceOnline: true,
      racePlace: this.playerPlace,
      raceTotal: Math.max(2, (this.room?.playerCount ?? 1)),
      raceLap: Math.min(this.playerLap, RACE.LAP_COUNT),
      raceTotalLaps: RACE.LAP_COUNT,
      raceFinished: this.playerFinished,
      raceCountdown: this._countdown,
      raceCountdownActive: this._roomStatus === 'countdown',
      raceWaitingForPlayers: this._roomStatus === 'waiting',
      raceRoomCode: this.room?.code ?? '',
      raceRoomName: this.room?.name ?? '',
      raceRoomStatus: this._roomStatus,
      raceNextGate: this.playerGate + 1,
      raceNextGateDistance,
      raceDirectionHint: this._directionHint,
      raceResult: this._lastResult,
      raceRules: { ...this.rules },
    };
  }

  destroy() {
    this.stop();
  }
}
