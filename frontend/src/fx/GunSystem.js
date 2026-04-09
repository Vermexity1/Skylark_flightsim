import * as THREE from 'three';
export class GunSystem {
  constructor(scene) {
    this.scene = scene;
    this.projectiles = [];
    this.flashes = [];
    this._collisionPackets = [];
    this.cooldown = 0;
    this.reloadTimer = 0;
    this._reloadPending = false;
    this.aimMode = 'follow';
    this.activeProfile = {
      cooldown: 0.075,
      speed: 980,
      color: 0x8edbff,
      stun: 1.1,
      magazine: 36,
      reloadTime: 1.7,
      radius: 9,
    };
    this.magazineSize = this.activeProfile.magazine;
    this.ammoInMagazine = this.magazineSize;
    this.reserveAmmo = Infinity;
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._velocity = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
    this._segmentDirection = new THREE.Vector3();
    this._projectileGeometry = new THREE.CylinderGeometry(0.045, 0.045, 6, 6);
    this._projectileMaterial = new THREE.MeshBasicMaterial({
      color: 0x8edbff,
      transparent: true,
      opacity: 0.96,
    });
    this._flashGeometry = new THREE.SphereGeometry(0.42, 8, 8);
    this._flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xbdf3ff,
      transparent: true,
      opacity: 0.85,
    });
  }

  canFire(aircraftType, gunProfile = null) {
    if (!aircraftType) return false;
    const profile = gunProfile ?? this.activeProfile;
    return !!profile;
  }

  setAimMode(mode) {
    this.aimMode = mode === 'free' ? 'free' : 'follow';
    return this.aimMode;
  }

  toggleAimMode() {
    return this.setAimMode(this.aimMode === 'follow' ? 'free' : 'follow');
  }

  syncProfile(gunProfile = null) {
    const profile = gunProfile ?? this.activeProfile;
    this.activeProfile = {
      ...this.activeProfile,
      ...(profile ?? {}),
    };
    const nextMagazine = Math.max(8, this.activeProfile.magazine ?? 30);
    if (nextMagazine !== this.magazineSize) {
      const ammoRatio = this.magazineSize > 0 ? this.ammoInMagazine / this.magazineSize : 1;
      this.magazineSize = nextMagazine;
      this.ammoInMagazine = Math.max(0, Math.min(this.magazineSize, Math.round(this.magazineSize * ammoRatio)));
      if (this.ammoInMagazine === 0 && this.reloadTimer <= 0) {
        this.ammoInMagazine = this.magazineSize;
      }
    }
    return this.activeProfile;
  }

  reload(gunProfile = null) {
    this.syncProfile(gunProfile);
    if (this.reloadTimer > 0) return false;
    if (this.ammoInMagazine >= this.magazineSize) return false;
    this.reloadTimer = Math.max(0.6, this.activeProfile.reloadTime ?? 1.7);
    this._reloadPending = true;
    return true;
  }

  tryFire(flightState, aim = { x: 0, y: 0 }, gunProfile = null) {
    if (!flightState || !this.canFire(flightState.aircraftType, gunProfile) || flightState.isCrashed) return false;
    this.syncProfile(gunProfile);
    if (this.cooldown > 0) return false;
    if (this.reloadTimer > 0) return false;
    if (this.ammoInMagazine <= 0) return false;

    const profile = this.activeProfile;
    this.cooldown = profile.cooldown;
    this.ammoInMagazine = Math.max(0, this.ammoInMagazine - 1);
    this._forward.copy(flightState.forward).normalize();
    this._right.set(1, 0, 0).applyQuaternion(flightState.quaternion).normalize();
    this._up.set(0, 1, 0).applyQuaternion(flightState.quaternion).normalize();
    const freeAim = this.aimMode === 'free';
    const aimDirection = this._forward.clone()
      .addScaledVector(this._right, freeAim ? (aim.x ?? 0) * 0.18 : 0)
      .addScaledVector(this._up, freeAim ? (aim.y ?? 0) * 0.14 : 0)
      .normalize();
    this._quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), aimDirection);
    this._velocity.copy(aimDirection).multiplyScalar(profile.speed).add(flightState.velocity);

    const muzzleOffsets = [-0.75, 0.75];
    const muzzleDistance = flightState.frameRadius * 1.45 + 2.8;
    const shotPackets = [];
    for (const side of muzzleOffsets) {
      const origin = flightState.position.clone()
        .addScaledVector(aimDirection, muzzleDistance)
        .addScaledVector(this._right, side)
        .addScaledVector(this._up, -0.2);

      const tracer = new THREE.Mesh(this._projectileGeometry, this._projectileMaterial.clone());
      tracer.material.color.set(profile.color);
      tracer.position.copy(origin);
      tracer.quaternion.copy(this._quaternion);
      tracer.castShadow = false;
      this.scene.add(tracer);
      this.projectiles.push({
        mesh: tracer,
        velocity: this._velocity.clone(),
        previousPosition: origin.clone(),
        life: 1.15,
        gravity: 12 + profile.speed * 0.008,
        drag: 0.09,
        color: profile.color,
        stun: profile.stun ?? 1.1,
        radius: profile.radius ?? 9,
      });
      shotPackets.push({
        origin: origin.clone(),
        velocity: this._velocity.clone(),
        life: 1.15,
        radius: profile.radius ?? 9,
        color: profile.color,
        stun: profile.stun ?? 1.1,
      });

      const flash = new THREE.Mesh(this._flashGeometry, this._flashMaterial.clone());
      flash.material.color.set(profile.color);
      flash.position.copy(origin);
      this.scene.add(flash);
      this.flashes.push({ mesh: flash, life: 0.08 });
    }

    return shotPackets;
  }

  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.reloadTimer = Math.max(0, this.reloadTimer - dt);
    if (this.reloadTimer <= 0 && this._reloadPending) {
      this.ammoInMagazine = this.magazineSize;
      this._reloadPending = false;
    }
    this._collisionPackets.length = 0;

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const shot = this.projectiles[i];
      shot.life -= dt;
      shot.previousPosition.copy(shot.mesh.position);
      shot.velocity.multiplyScalar(Math.max(0.86, 1 - shot.drag * dt));
      shot.velocity.y -= shot.gravity * dt;
      shot.mesh.position.addScaledVector(shot.velocity, dt);
      shot.mesh.material.opacity = Math.max(0.2, shot.life / 1.15);
      this._segmentDirection.copy(shot.mesh.position).sub(shot.previousPosition);
      const segmentLength = this._segmentDirection.length();
      if (segmentLength > 0.001) {
        this._segmentDirection.normalize();
      }
      shot.mesh.position.addScaledVector(this._segmentDirection, 0);
      shot.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), segmentLength > 0.001 ? this._segmentDirection : shot.velocity.clone().normalize());
      this._collisionPackets.push({
        start: shot.previousPosition.clone(),
        end: shot.mesh.position.clone(),
        radius: shot.radius ?? 9,
        color: shot.color,
        stun: shot.stun,
      });

      if (shot.life <= 0) {
        this.scene.remove(shot.mesh);
        shot.mesh.material?.dispose?.();
        this.projectiles.splice(i, 1);
      }
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const flash = this.flashes[i];
      flash.life -= dt;
      const alpha = Math.max(0, flash.life / 0.08);
      flash.mesh.material.opacity = alpha * 0.85;
      flash.mesh.scale.setScalar(1 + (1 - alpha) * 1.6);

      if (flash.life <= 0) {
        this.scene.remove(flash.mesh);
        flash.mesh.material?.dispose?.();
        this.flashes.splice(i, 1);
      }
    }
  }

  getCollisionPackets() {
    return this._collisionPackets.map(packet => ({
      start: packet.start.clone(),
      end: packet.end.clone(),
      radius: packet.radius,
      color: packet.color,
      stun: packet.stun,
    }));
  }

  getStatus() {
    const reserveLabel = Number.isFinite(this.reserveAmmo) ? this.reserveAmmo : 'INF';
    return {
      gunAvailable: true,
      gunAimMode: this.aimMode,
      gunAmmo: this.ammoInMagazine,
      gunMagazineSize: this.magazineSize,
      gunReserveAmmo: reserveLabel,
      gunReloading: this.reloadTimer > 0,
      gunReloadProgress: this.reloadTimer > 0
        ? 1 - this.reloadTimer / Math.max(0.6, this.activeProfile.reloadTime ?? 1.7)
        : 1,
      gunProfileName: this.activeProfile.name ?? 'Cannons',
    };
  }

  destroy() {
    this.projectiles.forEach(shot => {
      this.scene.remove(shot.mesh);
      shot.mesh.material?.dispose?.();
    });
    this.projectiles = [];

    this.flashes.forEach(flash => {
      this.scene.remove(flash.mesh);
      flash.mesh.material?.dispose?.();
    });
    this.flashes = [];

    this._projectileGeometry.dispose();
    this._projectileMaterial.dispose();
    this._flashGeometry.dispose();
    this._flashMaterial.dispose();
  }
}
