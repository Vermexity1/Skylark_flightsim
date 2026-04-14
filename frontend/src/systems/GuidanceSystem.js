import * as THREE from 'three';

const GLIDE_ANGLE_RAD = THREE.MathUtils.degToRad(3.2);

export class GuidanceSystem {
  constructor(scene, world, camera, canvas) {
    this.scene = scene;
    this.world = world;
    this.camera = camera;
    this.canvas = canvas;

    this.enabled = true;
    this.autoLandAllowed = true;
    this.autoLandEnabled = false;
    this.awaitingTargetSelection = false;
    this.landingTarget = null;
    this.previewTarget = null;
    this.lastState = null;
    this.autoStage = 'idle';
    this.autoPlan = null;
    this.status = {
      landingAdvice: 'CLICK TERRAIN TO PICK LANDING POINT',
      landingAdviceTone: 'info',
      guidanceEnabled: true,
      autoLandEnabled: false,
      landingTargetSelected: false,
      awaitingLandingTarget: false,
      autoLandStage: 'IDLE',
      autoLandAllowed: true,
    };

    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this.externalPointClickHandler = null;
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._tempA = new THREE.Vector3();
    this._tempB = new THREE.Vector3();
    this._tempC = new THREE.Vector3();
    this._tempD = new THREE.Vector3();
    this._worldUp = new THREE.Vector3(0, 1, 0);
    this._beamMid = new THREE.Vector3();
    this._beamDir = new THREE.Vector3();
    this._beamQuat = new THREE.Quaternion();
    this._lookMatrix = new THREE.Matrix4();
    this._autoQuatA = new THREE.Quaternion();
    this._autoQuatB = new THREE.Quaternion();
    this._autoVelocity = new THREE.Vector3();
    this._curvePoints = [];
    this._curvePointCount = 32;

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this._approachBeam = this._makeBeam(0.13, 0x4ac6ff, 0.98, 0.16);
    this._leftWingBeam = this._makeBeam(0.1, 0xff9d3a, 0.94, 0.12);
    this._rightWingBeam = this._makeBeam(0.1, 0xff9d3a, 0.94, 0.12);
    this._targetBeam = this._makeBeam(0.1, 0x56ff8a, 0.92, 0.12);
    this._raceBeam = this._makeBeam(0.11, 0x7df0ff, 0.94, 0.14);
    this._futurePathLine = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -10)]), 8, 0.22, 8, false),
      new THREE.MeshBasicMaterial({
        color: 0xffeb57,
        transparent: true,
        opacity: 0.86,
        depthWrite: false,
      })
    );
    this._futurePathGlow = new THREE.Mesh(
      this._futurePathLine.geometry.clone(),
      new THREE.MeshBasicMaterial({
        color: 0xffe57f,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
      })
    );
    this._targetRing = new THREE.Mesh(
      new THREE.RingGeometry(5.4, 8.2, 40),
      new THREE.MeshBasicMaterial({
        color: 0x56ff8a,
        transparent: true,
        opacity: 0.84,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this._targetRing.rotation.x = -Math.PI / 2;

    this.group.add(
      this._approachBeam,
      this._leftWingBeam,
      this._rightWingBeam,
      this._targetBeam,
      this._raceBeam,
      this._futurePathGlow,
      this._futurePathLine,
      this._targetRing
    );

    this._onMouseMove = this._onMouseMove.bind(this);
    this._onClick = this._onClick.bind(this);
    this.canvas.addEventListener('mousemove', this._onMouseMove);
    this.canvas.addEventListener('click', this._onClick);
    this._hideAllGuides();
  }

  _makeBeam(radius, color, coreOpacity, glowOpacity) {
    const group = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, 1, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: coreOpacity,
        depthWrite: false,
      })
    );
    const glow = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 2.15, radius * 2.15, 1, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: glowOpacity,
        depthWrite: false,
      })
    );
    group.userData = { core, glow, radius };
    group.add(glow, core);
    return group;
  }

  _setBeamPoints(beam, start, end, pulse = 1) {
    if (!beam?.userData?.core) return;
    const { core, glow, radius } = beam.userData;
    this._beamDir.copy(end).sub(start);
    const length = Math.max(1, this._beamDir.length());
    const direction = this._beamDir.normalize();
    this._beamMid.copy(start).lerp(end, 0.5);
    this._beamQuat.setFromUnitVectors(this._worldUp, direction);

    beam.position.copy(this._beamMid);
    beam.quaternion.copy(this._beamQuat);
    core.scale.set(1, length, 1);
    glow.scale.set(1, length, 1);
    core.material.opacity = core.material.opacity;
    glow.material.opacity = glow.material.opacity;
    core.scale.x = pulse;
    core.scale.z = pulse;
    glow.scale.x = pulse;
    glow.scale.z = pulse;
    beam.visible = true;
  }

  _setBeamHidden(beam) {
    if (beam) beam.visible = false;
  }

  _hideAllGuides() {
    this._setBeamHidden(this._approachBeam);
    this._setBeamHidden(this._leftWingBeam);
    this._setBeamHidden(this._rightWingBeam);
    this._setBeamHidden(this._targetBeam);
    this._setBeamHidden(this._raceBeam);
    this._futurePathLine.visible = false;
    this._futurePathGlow.visible = false;
    this._targetRing.visible = false;
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    this.group.visible = this.enabled;
    this.status.guidanceEnabled = this.enabled;
    if (!this.enabled) {
      this.setAutoLandEnabled(false);
      this.awaitingTargetSelection = false;
      this.previewTarget = null;
      this._hideAllGuides();
    }
    return this.enabled;
  }

  setAutoLandAllowed(enabled) {
    this.autoLandAllowed = enabled !== false;
    this.status.autoLandAllowed = this.autoLandAllowed;
    if (!this.autoLandAllowed) this.setAutoLandEnabled(false);
    return this.autoLandAllowed;
  }

  isEnabled() {
    return this.enabled;
  }

  setAutoLandEnabled(enabled) {
    if (!this.autoLandAllowed) {
      this.autoLandEnabled = false;
      this.awaitingTargetSelection = false;
      this.status.autoLandEnabled = false;
      this.status.awaitingLandingTarget = false;
      this.status.autoLandStage = 'LOCKED';
      this.status.landingAdvice = 'AUTOLAND DISABLED FOR THIS SESSION';
      this.status.landingAdviceTone = 'warn';
      return false;
    }

    const next = !!enabled;
    if (!next) {
      this.autoLandEnabled = false;
      this.awaitingTargetSelection = false;
      this.autoStage = 'idle';
      this.autoPlan = null;
      this.status.autoLandEnabled = false;
      this.status.awaitingLandingTarget = false;
      this.status.autoLandStage = 'IDLE';
      this.status.autoLandAllowed = this.autoLandAllowed;
      return false;
    }

    if (!this.landingTarget) {
      this.awaitingTargetSelection = true;
      this.autoLandEnabled = false;
      this.status.autoLandEnabled = false;
      this.status.awaitingLandingTarget = true;
      this.status.autoLandStage = 'SELECT TARGET';
      this.status.landingAdvice = 'CLICK TERRAIN TO ARM AUTOLAND';
      this.status.landingAdviceTone = 'info';
      return false;
    }

    if (this.lastState) {
      this._buildAutolandPlan(this.lastState, this.landingTarget);
    }
    this.autoLandEnabled = true;
    this.awaitingTargetSelection = false;
    this.status.autoLandEnabled = true;
    this.status.awaitingLandingTarget = false;
    return true;
  }

  toggleAutoLand() {
    return this.setAutoLandEnabled(!this.autoLandEnabled && !this.awaitingTargetSelection);
  }

  resetForEnvironment() {
    this.previewTarget = null;
    this.landingTarget = null;
    this.autoLandEnabled = false;
    this.awaitingTargetSelection = false;
    this.autoStage = 'idle';
    this.autoPlan = null;
    this.lastState = null;
    this._hideAllGuides();
    this.status.landingTargetSelected = false;
    this.status.autoLandEnabled = false;
    this.status.awaitingLandingTarget = false;
    this.status.autoLandStage = 'IDLE';
    this.status.autoLandAllowed = this.autoLandAllowed;
    this.status.landingAdvice = 'CLICK TERRAIN TO PICK LANDING POINT';
    this.status.landingAdviceTone = 'info';
  }

  getStatus() {
    return { ...this.status };
  }

  _buildAutolandPlan(flightState, target, preserveDirection = null) {
    const touchdown = target.clone();
    touchdown.y = this.world.getSurfaceHeight(touchdown.x, touchdown.z) + 0.38;
    const landingDirection = preserveDirection?.clone?.() ?? touchdown.clone().sub(flightState.position).setY(0);
    if (landingDirection.lengthSq() < 0.0001) landingDirection.set(0, 0, -1);
    else landingDirection.normalize();

    const horizontalDistance = Math.max(1, Math.hypot(flightState.position.x - touchdown.x, flightState.position.z - touchdown.z));
    const haltPosition = flightState.position.clone();
    const haltAltitude = Math.max(flightState.position.y, touchdown.y + Math.min(110, Math.max(18, horizontalDistance * 0.06)));
    haltPosition.y = haltAltitude;

    this.autoPlan = {
      touchdown,
      landingDirection,
      haltPosition,
      haltAltitude,
      targetCenterHeight: Math.max(0.9, Number(flightState.collisionBottomOffset) || 0.9),
      desiredHeading: Math.atan2(landingDirection.x, landingDirection.z),
      lastDistance: horizontalDistance,
      targetSpeed: {
        stabilize: THREE.MathUtils.clamp((flightState.stallSpeed ?? 20) * 0.82, 14, 34),
        halt: 0,
        align: 0,
        approach: THREE.MathUtils.clamp((flightState.stallSpeed ?? 20) * 0.9, 20, 48),
        flare: THREE.MathUtils.clamp((flightState.stallSpeed ?? 20) * 0.62, 9, 22),
      },
      armedAt: this.autoPlan?.armedAt ?? performance.now(),
      lastRefreshPosition: flightState.position.clone(),
    };

    this.autoStage = 'halt';
    this.status.autoLandStage = this.autoStage.toUpperCase();
    this.status.landingAdvice = 'AUTOLAND ARMED';
    this.status.landingAdviceTone = 'ok';
  }

  _refreshAutolandPlan(flightState, forceHeadingRefresh = false) {
    if (!this.landingTarget || !flightState) return;
    const stage = this.autoStage;
    const storedDirection = forceHeadingRefresh ? null : this.autoPlan?.landingDirection;
    this._buildAutolandPlan(flightState, this.landingTarget, storedDirection);
    if (stage && stage !== 'idle') {
      this.autoStage = stage;
      this.status.autoLandStage = stage.toUpperCase();
    }
  }

  _makeAutoQuaternion(direction, pitch = 0) {
    const flatDirection = this._tempC.copy(direction).setY(0);
    if (flatDirection.lengthSq() < 0.0001) flatDirection.set(0, 0, -1);
    else flatDirection.normalize();
    this._lookMatrix.lookAt(new THREE.Vector3(0, 0, 0), flatDirection, this._worldUp);
    this._autoQuatA.setFromRotationMatrix(this._lookMatrix);
    if (pitch !== 0) {
      this._autoQuatB.setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch);
      this._autoQuatA.multiply(this._autoQuatB);
    }
    return this._autoQuatA.clone();
  }

  getAutolandOverride(flightState, dt) {
    if (flightState) this.lastState = flightState;
    if (!this.autoLandEnabled || !this.landingTarget || !flightState) return null;
    if (!this.autoPlan) this._buildAutolandPlan(flightState, this.landingTarget);

    const touchdown = this.autoPlan.touchdown.clone();
    touchdown.y = this.world.getSurfaceHeight(touchdown.x, touchdown.z) + 0.38;
    this.autoPlan.touchdown.copy(touchdown);

    const current = flightState.position.clone();
    const horizontal = this._tempA.copy(touchdown).sub(current).setY(0);
    const horizontalDistance = Math.max(0.001, horizontal.length());
    const horizontalDirection = horizontalDistance > 0.001 ? horizontal.normalize() : this.autoPlan.landingDirection.clone();
    const finalCenterY = touchdown.y + this.autoPlan.targetCenterHeight;
    const currentYawDirection = this._tempB.copy(flightState.forward).setY(0);
    if (currentYawDirection.lengthSq() < 0.0001) currentYawDirection.set(0, 0, -1);
    else currentYawDirection.normalize();
    const headingError = Math.atan2(
      currentYawDirection.x * horizontalDirection.z - currentYawDirection.z * horizontalDirection.x,
      THREE.MathUtils.clamp(currentYawDirection.dot(horizontalDirection), -1, 1)
    );
    const alignedQuaternion = this._makeAutoQuaternion(horizontalDirection, 0);
    const haltElapsed = performance.now() - (this.autoPlan.armedAt ?? 0);

    let nextPosition = current.clone();
    let nextQuaternion = flightState.quaternion.clone();
    let throttle = 0;
    let landed = false;
    let landedLabel = 'smooth';

    if (this.autoStage === 'halt') {
      nextPosition.copy(this.autoPlan.haltPosition);
      nextQuaternion.slerp(alignedQuaternion, 1 - Math.exp(-dt * 4.6));
      if (haltElapsed > 650) this.autoStage = 'align';
    }

    if (this.autoStage === 'align') {
      nextPosition.copy(this.autoPlan.haltPosition);
      nextQuaternion.slerp(alignedQuaternion, 1 - Math.exp(-dt * 5.4));
      if (Math.abs(headingError) < THREE.MathUtils.degToRad(1.8)) {
        this.autoStage = 'approach';
      }
    }

    if (this.autoStage === 'approach') {
      const forwardSpeed = THREE.MathUtils.clamp(14 + horizontalDistance * 0.16, this.autoPlan.targetSpeed.approach * 0.75, this.autoPlan.targetSpeed.approach);
      const timeToTarget = Math.max(0.4, horizontalDistance / Math.max(1, forwardSpeed));
      const desiredCenterY = finalCenterY + THREE.MathUtils.clamp(horizontalDistance * 0.045, 2.2, 34);
      const requestedVerticalSpeed = (desiredCenterY - current.y) / timeToTarget;
      const verticalSpeed = THREE.MathUtils.clamp(Math.min(0, requestedVerticalSpeed), -12, -1.2);
      nextPosition.addScaledVector(horizontalDirection, forwardSpeed * dt);
      nextPosition.y = Math.max(finalCenterY + 1.8, current.y + verticalSpeed * dt);
      nextQuaternion.slerp(this._makeAutoQuaternion(horizontalDirection, THREE.MathUtils.clamp(Math.atan2(verticalSpeed, Math.max(1, forwardSpeed)), -0.12, 0.03)), 1 - Math.exp(-dt * 4.2));
      throttle = 0.18;
      if (horizontalDistance < 24 || nextPosition.y - finalCenterY < 6.5) {
        this.autoStage = 'flare';
      }
    }

    if (this.autoStage === 'flare') {
      const flareDirection = horizontalDistance > 0.001 ? horizontalDirection : currentYawDirection;
      const forwardSpeed = THREE.MathUtils.clamp(8 + horizontalDistance * 0.12, 5.5, this.autoPlan.targetSpeed.flare);
      const remainingY = Math.max(0, current.y - finalCenterY);
      const descent = THREE.MathUtils.clamp(remainingY * 1.8, 0.4, 3.2);
      nextPosition.addScaledVector(flareDirection, forwardSpeed * dt);
      nextPosition.y = Math.max(finalCenterY, current.y - descent * dt);
      nextQuaternion.slerp(this._makeAutoQuaternion(flareDirection, 0.04), 1 - Math.exp(-dt * 4.4));
      throttle = 0.08;
      if (horizontalDistance < 3.5 && nextPosition.y <= finalCenterY + 0.18) {
        this.autoStage = 'rollout';
      }
    }

    if (this.autoStage === 'rollout') {
      nextPosition.copy(touchdown);
      nextPosition.y = finalCenterY;
      nextQuaternion.slerp(this._makeAutoQuaternion(horizontalDirection, 0), 1 - Math.exp(-dt * 6.4));
      landed = true;
      throttle = 0;
    }

    this.status.autoLandStage = this.autoStage.toUpperCase();
    this.status.autoLandEnabled = true;
    this.status.awaitingLandingTarget = false;
    this.autoPlan.lastDistance = horizontalDistance;

    if (landed) {
      this.setAutoLandEnabled(false);
    }

    this._autoVelocity.copy(nextPosition).sub(current).multiplyScalar(1 / Math.max(dt, 1 / 120));
    return {
      position: nextPosition,
      quaternion: nextQuaternion,
      velocity: landed ? new THREE.Vector3(0, 0, 0) : this._autoVelocity.clone(),
      throttle,
      landed,
      landedLabel,
    };
  }

  modifyInput(input, flightState) {
    if (!this.enabled) return input;
    if (flightState) this.lastState = flightState;
    if (this.autoLandEnabled) {
      return {
        ...input,
        pitch: 0,
        roll: 0,
        yaw: 0,
        throttle: 0,
        brake: false,
        boost: false,
      };
    }
    if (!this.autoPlan || !this.landingTarget || !flightState) {
      return input;
    }

    this._refreshAutolandPlan(flightState, true);

    const pos = flightState.position;
    const groundTarget = this.autoPlan.touchdown;
    const toTouchdown = this._tempA.copy(groundTarget).sub(pos);
    const toTouchdownFlat = this._tempD.copy(toTouchdown).setY(0);
    const horizontalToTouchdown = Math.max(1, Math.hypot(toTouchdown.x, toTouchdown.z));
    const forwardFlat = this._tempB.copy(flightState.forward).setY(0);
    if (forwardFlat.lengthSq() < 0.0001) forwardFlat.set(0, 0, -1);
    else forwardFlat.normalize();
    const desiredTrack = toTouchdownFlat.lengthSq() > 0.0001
      ? toTouchdownFlat.normalize()
      : this.autoPlan.landingDirection.clone();
    const headingError = Math.atan2(
      forwardFlat.x * desiredTrack.z - forwardFlat.z * desiredTrack.x,
      THREE.MathUtils.clamp(forwardFlat.dot(desiredTrack), -1, 1)
    );
    const attitude = new THREE.Euler().setFromQuaternion(flightState.quaternion, 'YXZ');
    const currentBank = -attitude.z;
    const currentFlightPath = Math.atan2(flightState.verticalSpeed, Math.max(1, Math.hypot(flightState.velocity.x, flightState.velocity.z)));

    let desiredAltitude = groundTarget.y + THREE.MathUtils.clamp(horizontalToTouchdown * 0.07, 4, 84);
    let desiredDirection = desiredTrack.clone();
    let targetSpeed = this.autoPlan.targetSpeed.approach;
    let brake = false;
    const isClose = horizontalToTouchdown < 22;
    const armingHold = performance.now() - (this.autoPlan.armedAt ?? 0) < 900;
    const needsBrakeDown = flightState.speed > this.autoPlan.targetSpeed.stabilize * 1.08;

    if (flightState.nearGround && horizontalToTouchdown < 10) {
      this.autoStage = 'rollout';
    } else if (isClose) {
      this.autoStage = 'flare';
    } else if (armingHold || needsBrakeDown || Math.abs(currentBank) > THREE.MathUtils.degToRad(9)) {
      this.autoStage = 'stabilize';
    } else if (Math.abs(headingError) > THREE.MathUtils.degToRad(5.5)) {
      this.autoStage = 'align';
    } else {
      this.autoStage = 'approach';
    }

    if (this.autoStage === 'stabilize') {
      desiredAltitude = Math.max(groundTarget.y + 36, pos.y - 1.4);
      desiredDirection.copy(desiredTrack);
      targetSpeed = this.autoPlan.targetSpeed.stabilize;
      brake = flightState.speed > targetSpeed * 1.04;
    } else if (this.autoStage === 'align') {
      desiredAltitude = groundTarget.y + THREE.MathUtils.clamp(horizontalToTouchdown * 0.08, 26, 90);
      desiredDirection.copy(desiredTrack);
      targetSpeed = this.autoPlan.targetSpeed.align;
      brake = flightState.speed > targetSpeed * 1.03;
    } else if (this.autoStage === 'approach') {
      const approachBlend = 1 - THREE.MathUtils.smoothstep(horizontalToTouchdown, 34, 260);
      desiredAltitude = groundTarget.y + THREE.MathUtils.clamp(horizontalToTouchdown * 0.07, 3, 72);
      desiredDirection.copy(desiredTrack);
      targetSpeed = THREE.MathUtils.lerp(this.autoPlan.targetSpeed.approach, this.autoPlan.targetSpeed.flare * 1.08, approachBlend);
      brake = flightState.speed > targetSpeed * 1.06;
    } else if (this.autoStage === 'flare') {
      desiredAltitude = groundTarget.y + 1.1;
      desiredDirection.copy(desiredTrack);
      targetSpeed = this.autoPlan.targetSpeed.flare;
      brake = flightState.speed > targetSpeed * 1.02;
    } else if (this.autoStage === 'rollout') {
      desiredAltitude = groundTarget.y + 0.9;
      desiredDirection.copy(desiredTrack.lengthSq() > 0.0001 ? desiredTrack : forwardFlat);
      targetSpeed = 0;
      brake = true;
      if (flightState.isLanded || flightState.landed === 'smooth') {
        this.setAutoLandEnabled(false);
      }
    }

    if (desiredDirection.lengthSq() < 0.0001) {
      desiredDirection.copy(desiredTrack.lengthSq() > 0.0001 ? desiredTrack : forwardFlat);
    }
    if (desiredDirection.lengthSq() < 0.0001) desiredDirection.copy(forwardFlat);
    else desiredDirection.normalize();

    const refinedHeadingError = Math.atan2(
      forwardFlat.x * desiredDirection.z - forwardFlat.z * desiredDirection.x,
      THREE.MathUtils.clamp(forwardFlat.dot(desiredDirection), -1, 1)
    );
    const altitudeError = desiredAltitude - pos.y;
    const speedError = targetSpeed - flightState.speed;
    const desiredFlightPath = this.autoStage === 'rollout'
      ? -0.02
      : this.autoStage === 'flare'
        ? THREE.MathUtils.clamp((altitudeError - 0.8) / 46, -0.08, 0.03)
        : THREE.MathUtils.clamp(Math.atan2(altitudeError, Math.max(horizontalToTouchdown, this.autoStage === 'stabilize' ? 180 : 80)), -0.14, 0.08);
    const targetPitch = this.autoStage === 'flare'
      ? THREE.MathUtils.clamp((desiredFlightPath - currentFlightPath) * 4.1 - attitude.x * 0.18, -0.12, 0.2)
      : THREE.MathUtils.clamp((desiredFlightPath - currentFlightPath) * 3.9 - attitude.x * 0.16, -0.24, 0.16);
    const desiredBank = this.autoStage === 'approach'
      ? THREE.MathUtils.clamp(refinedHeadingError * 0.26, -0.18, 0.18)
      : this.autoStage === 'align'
        ? THREE.MathUtils.clamp(refinedHeadingError * 0.22, -0.14, 0.14)
        : THREE.MathUtils.clamp(refinedHeadingError * 0.14, -0.1, 0.1);
    const targetRoll = THREE.MathUtils.clamp((desiredBank - currentBank) * 3.3 - currentBank * 0.62, -0.3, 0.3);
    const targetYaw = THREE.MathUtils.clamp(
      refinedHeadingError * (this.autoStage === 'align' ? 1.32 : this.autoStage === 'stabilize' ? 0.88 : 0.62) - currentBank * 0.34,
      -0.72,
      0.72
    );
    const targetThrottleSetting = this.autoStage === 'rollout'
      ? 0
      : this.autoStage === 'flare'
        ? 0.06
        : this.autoStage === 'approach'
          ? THREE.MathUtils.lerp(0.28, 0.12, 1 - THREE.MathUtils.smoothstep(horizontalToTouchdown, 40, 260))
          : this.autoStage === 'align'
            ? 0.14
            : 0.08;
    const throttleCommand = this.autoStage === 'rollout'
      ? -1
      : THREE.MathUtils.clamp(
        (targetThrottleSetting - (flightState.throttle ?? 0.4)) * 2.8
        + speedError * 0.028
        + THREE.MathUtils.clamp(altitudeError * 0.0015, -0.05, 0.06),
        -1,
        0.76
      );

    this.status.autoLandStage = this.autoStage.toUpperCase();
    this.status.autoLandEnabled = true;
    this.status.awaitingLandingTarget = false;

    return {
      ...input,
      pitch: targetPitch,
      roll: targetRoll,
      yaw: targetYaw,
      throttle: throttleCommand,
      brake: brake || (this.autoStage !== 'rollout' && flightState.speed > targetSpeed * 1.08),
      boost: false,
    };
  }

  update(flightState, dt) {
    if (!flightState) return;
    this.lastState = flightState;
    if (this.autoLandEnabled && this.landingTarget) {
      this._refreshAutolandPlan(flightState, true);
    }

    if (!this.enabled) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;

    const raceTarget = flightState.raceGuideTarget ? flightState.raceGuideTarget.clone() : null;
    const isRaceGuide = !!raceTarget;

    const target = this.landingTarget ?? (this.awaitingTargetSelection ? this.previewTarget : null);
    this.status.guidanceEnabled = true;
    this.status.autoLandEnabled = this.autoLandEnabled;
    this.status.awaitingLandingTarget = this.awaitingTargetSelection;
    this.status.landingTargetSelected = !!this.landingTarget;

    if (!target) {
      this._hideAllGuides();
      return;
    }

    this._forward.copy(flightState.forward).normalize();
    this._right.set(1, 0, 0).applyQuaternion(flightState.quaternion).normalize();
    this._up.set(0, 1, 0).applyQuaternion(flightState.quaternion).normalize();

    const pulse = 1 + Math.sin(performance.now() * 0.006) * 0.08;
    const nose = this._tempA.copy(flightState.position)
      .addScaledVector(this._forward, flightState.frameRadius * 1.45 + 4.6)
      .addScaledVector(this._up, 0.9);

    if (isRaceGuide) {
      raceTarget.y = Math.max(raceTarget.y, this.world.getSurfaceHeight(raceTarget.x, raceTarget.z) + 18);
      this._setBeamPoints(this._raceBeam, nose, raceTarget, pulse * 1.02);
      this._setBeamHidden(this._approachBeam);
      this._setBeamHidden(this._leftWingBeam);
      this._setBeamHidden(this._rightWingBeam);
      this._setBeamHidden(this._targetBeam);
      this._targetRing.visible = true;
      this._targetRing.position.copy(raceTarget).setY(raceTarget.y - 16);
      this._targetRing.scale.setScalar(1.5 + Math.sin(performance.now() * 0.005) * 0.1);
      this._futurePathLine.visible = false;
      this._futurePathGlow.visible = false;
      this.status.landingAdvice = flightState.raceDirectionHint ?? 'FOLLOW RACE GUIDE';
      this.status.landingAdviceTone = 'info';
      return;
    }
    this._setBeamHidden(this._raceBeam);

    const touchdown = target.clone();
    touchdown.y = this.world.getSurfaceHeight(touchdown.x, touchdown.z) + 0.4;
    this._setBeamPoints(this._approachBeam, nose, touchdown, pulse);

    const leftWing = this._tempB.copy(flightState.position)
      .addScaledVector(this._right, -flightState.frameRadius * 1.05)
      .addScaledVector(this._up, 0.18);
    const rightWing = this._tempC.copy(flightState.position)
      .addScaledVector(this._right, flightState.frameRadius * 1.05)
      .addScaledVector(this._up, 0.18);
    const leftGround = this._projectForwardGround(leftWing, this._forward);
    const rightGround = this._projectForwardGround(rightWing, this._forward);
    this._setBeamPoints(this._leftWingBeam, leftWing, leftGround, pulse * 0.96);
    this._setBeamPoints(this._rightWingBeam, rightWing, rightGround, pulse * 0.96);

    const targetTop = touchdown.clone().add(new THREE.Vector3(0, 72, 0));
    this._setBeamPoints(this._targetBeam, touchdown, targetTop, pulse * 1.08);
    this._targetRing.visible = true;
    this._targetRing.position.copy(touchdown).add(new THREE.Vector3(0, 0.25, 0));
    this._targetRing.scale.setScalar(1.1 + Math.sin(performance.now() * 0.005) * 0.12);

    this._updateFuturePath(flightState, dt);
    this._updateAdvice(flightState, touchdown);
  }

  _projectForwardGround(origin, forward) {
    const ray = this._tempD.copy(forward).setY(-0.22).normalize();
    const sample = new THREE.Vector3();
    const hit = new THREE.Vector3();
    for (let distance = 18; distance <= 680; distance += 14) {
      sample.copy(origin).addScaledVector(ray, distance);
      const groundY = this.world.getSurfaceHeight(sample.x, sample.z) + 0.7;
      if (sample.y <= groundY) {
        hit.set(sample.x, groundY, sample.z);
        return hit;
      }
    }
    hit.copy(origin).addScaledVector(ray, 680);
    hit.y = this.world.getSurfaceHeight(hit.x, hit.z) + 0.7;
    return hit;
  }

  _updateFuturePath(flightState, dt) {
    const points = [];
    const pathPosition = flightState.position.clone();
    const pathVelocity = flightState.velocity.clone();
    const pathQuaternion = flightState.quaternion.clone();
    const euler = new THREE.Euler().setFromQuaternion(flightState.quaternion, 'YXZ');
    const bankTurn = Math.sin(-euler.z) * THREE.MathUtils.clamp(flightState.speed / Math.max(flightState.stallSpeed ?? 20, 1), 0, 3) * 0.028;

    for (let i = 0; i < this._curvePointCount; i++) {
      points.push(pathPosition.clone());
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(pathQuaternion).normalize();
      pathVelocity.lerp(forward.multiplyScalar(Math.max(pathVelocity.length(), flightState.stallSpeed ?? 20)), 0.16);
      pathVelocity.y -= 1.3;
      const yawQuat = new THREE.Quaternion().setFromAxisAngle(this._worldUp, -bankTurn);
      pathQuaternion.multiply(yawQuat).normalize();
      pathPosition.addScaledVector(pathVelocity, Math.max(dt, 1 / 60) * 4.2);
      const terrainY = this.world.getSurfaceHeight(pathPosition.x, pathPosition.z) + 0.9;
      if (pathPosition.y < terrainY) pathPosition.y = terrainY;
    }

    const curve = new THREE.CatmullRomCurve3(points);
    this._futurePathLine.geometry.dispose();
    this._futurePathGlow.geometry.dispose();
    this._futurePathLine.geometry = new THREE.TubeGeometry(curve, points.length * 2, 0.22, 10, false);
    this._futurePathGlow.geometry = new THREE.TubeGeometry(curve, points.length * 2, 0.46, 10, false);
    this._futurePathLine.visible = true;
    this._futurePathGlow.visible = true;
  }

  _updateAdvice(flightState, touchdown) {
    const toTarget = this._tempA.copy(touchdown).sub(flightState.position);
    const horizontalDistance = Math.max(1, Math.hypot(toTarget.x, toTarget.z));
    const desiredAltitude = touchdown.y + THREE.MathUtils.clamp(horizontalDistance * 0.07, 3, 84);
    const altitudeError = flightState.position.y - desiredAltitude;
    let desiredTrack;
    if (this.autoLandEnabled && this.autoPlan) {
      desiredTrack = touchdown.clone().sub(flightState.position).setY(0);
    } else {
      desiredTrack = toTarget.clone().setY(0);
    }
    if (desiredTrack.lengthSq() > 0.0001) desiredTrack.normalize();
    const forwardFlat = this._tempB.copy(flightState.forward).setY(0);
    if (forwardFlat.lengthSq() > 0.0001) forwardFlat.normalize();
    const headingError = desiredTrack.lengthSq() < 0.0001 || forwardFlat.lengthSq() < 0.0001
      ? 0
      : Math.atan2(
        forwardFlat.x * desiredTrack.z - forwardFlat.z * desiredTrack.x,
        THREE.MathUtils.clamp(forwardFlat.dot(desiredTrack), -1, 1)
      );
    const targetSpeed = this.autoLandEnabled && this.autoPlan
      ? this.autoStage === 'stabilize'
        ? this.autoPlan.targetSpeed.stabilize
        : this.autoStage === 'align'
          ? this.autoPlan.targetSpeed.align
          : this.autoStage === 'flare' || this.autoStage === 'rollout'
            ? this.autoPlan.targetSpeed.flare
            : this.autoPlan.targetSpeed.approach
      : THREE.MathUtils.clamp(
        (flightState.stallSpeed ?? 20) * 1.32,
        (flightState.stallSpeed ?? 20) * 1.12,
        (flightState.maxSpeed ?? 100) * 0.42
      );

    let text = 'ON PROFILE';
    let tone = 'ok';

    if (this.awaitingTargetSelection) {
      text = 'CLICK TERRAIN TO ARM AUTOLAND';
      tone = 'info';
    } else if (this.autoLandEnabled) {
      const action = Math.abs(headingError) > THREE.MathUtils.degToRad(5)
        ? headingError > 0 ? 'TURN RIGHT' : 'TURN LEFT'
        : flightState.speed > targetSpeed * 1.08
          ? 'BRAKE'
          : flightState.speed < targetSpeed * 0.9
            ? 'ADD POWER'
            : altitudeError > 14
              ? 'DESCEND'
              : altitudeError < -10
                ? 'HOLD ALT'
                : this.autoStage === 'flare'
                  ? 'HOLD NOSE UP'
                  : this.autoStage === 'rollout'
                    ? 'FULL BRAKE'
                    : 'TRACKING';
      text = `AUTO ${this.autoStage.toUpperCase()} | ${action}`;
      tone = this.autoStage === 'rollout' ? 'warn' : 'ok';
    } else if (Math.abs(headingError) > THREE.MathUtils.degToRad(16)) {
      text = headingError > 0 ? 'TURN RIGHT TO ALIGN' : 'TURN LEFT TO ALIGN';
      tone = 'warn';
    } else if (horizontalDistance < 35) {
      text = flightState.speed > targetSpeed * 0.96 ? 'BRAKE AND FLARE' : 'HOLD IT OFF';
      tone = 'warn';
    } else if (flightState.speed > targetSpeed * 1.14) {
      text = 'BRAKE';
      tone = 'warn';
    } else if (flightState.speed < targetSpeed * 0.88) {
      text = 'ACCELERATE';
      tone = 'info';
    } else if (altitudeError > 26) {
      text = 'DESCEND';
      tone = 'warn';
    } else if (altitudeError < -18) {
      text = 'ADD POWER';
      tone = 'info';
    } else if (horizontalDistance < 140) {
      text = 'FLARE SOON';
      tone = 'ok';
    }

    this.status.landingAdvice = text;
    this.status.landingAdviceTone = tone;
  }

  _screenToNdc(event) {
    const rect = this.canvas.getBoundingClientRect();
    this._pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this._pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  _pickTerrainPoint(event) {
    if (!this.world?.terrain || !this.camera) return null;
    this._screenToNdc(event);
    this._raycaster.setFromCamera(this._pointer, this.camera);
    const surfaces = [this.world.terrain, this.world.terrainUnderlay].filter(Boolean);
    const hits = this._raycaster.intersectObjects(surfaces, false);
    if (!hits.length) return null;
    const point = hits[0].point.clone();
    point.y = this.world.getSurfaceHeight(point.x, point.z) + 0.4;
    return point;
  }

  setExternalPointClickHandler(handler = null) {
    this.externalPointClickHandler = typeof handler === 'function' ? handler : null;
  }

  _selectLandingTarget(point) {
    this.landingTarget = point.clone();
    this.status.landingTargetSelected = true;
    if (this.awaitingTargetSelection && this.lastState) {
      this.awaitingTargetSelection = false;
      this.autoLandEnabled = true;
      this.status.autoLandEnabled = true;
      this.status.awaitingLandingTarget = false;
      this._buildAutolandPlan(this.lastState, this.landingTarget);
    }
  }

  _onMouseMove(event) {
    if (this.awaitingTargetSelection) {
      this.previewTarget = this._pickTerrainPoint(event);
    }
  }

  _onClick(event) {
    const point = this._pickTerrainPoint(event);
    if (!point) return;
    if (this.externalPointClickHandler?.(point, event) === true) return;
    this._selectLandingTarget(point);
  }

  destroy() {
    this.canvas.removeEventListener('mousemove', this._onMouseMove);
    this.canvas.removeEventListener('click', this._onClick);
    this.group.traverse(node => {
      if (!node.isLine && !node.isMesh) return;
      node.geometry?.dispose?.();
      node.material?.dispose?.();
    });
    this.scene.remove(this.group);
  }
}
