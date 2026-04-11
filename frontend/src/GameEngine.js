// ============================================================
// Game Engine — Main simulation loop
// Fixed-timestep physics + variable render rate
// Full FX pipeline: bloom, contrails, speed lines, weather
// ============================================================
import * as THREE from 'three';
import { RENDER, PHYSICS, DEBUG, RACE, CHALLENGE } from './config.js';
import { WorldManager }       from './world/WorldManager.js';
import { AircraftController } from './aircraft/AircraftController.js';
import { InputHandler }       from './ui/InputHandler.js';
import { CameraSystem }       from './camera/CameraSystem.js';
import { AudioSystem }        from './ui/AudioSystem.js';
import { PostProcessor }      from './fx/PostProcessor.js';
import { ContrailSystem }     from './fx/ContrailSystem.js';
import { SpeedLines }         from './fx/SpeedLines.js';
import { WeatherSystem }      from './fx/WeatherSystem.js';
import { CrashEffectSystem }  from './fx/CrashEffectSystem.js';
import { GunSystem }          from './fx/GunSystem.js';
import { DamageSystem }       from './systems/DamageSystem.js';
import { CareerSystem }       from './systems/CareerSystem.js';
import { GuidanceSystem }     from './systems/GuidanceSystem.js';
import { RaceSystem }         from './systems/RaceSystem.js';
import { OnlineRaceSystem }   from './systems/OnlineRaceSystem.js';
import { ReplaySystem }       from './systems/ReplaySystem.js';

const isOfflineRaceMode = mode => mode === 'race_practice';
const isOnlineRaceMode = mode => typeof mode === 'string' && mode.startsWith('race_online_');
const isRaceMode = mode => isOfflineRaceMode(mode) || isOnlineRaceMode(mode);

export class GameEngine {
  constructor(canvas, callbacks = {}) {
    this.canvas    = canvas;
    this.callbacks = callbacks;

    // ── Renderer ─────────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias:       true,
      powerPreference: 'high-performance',
    });
    this._nativePixelRatio = Math.max(1, window.devicePixelRatio || 1);
    this._basePixelRatio = Math.min(Math.max(this._nativePixelRatio, 1.6), RENDER.MAX_PIXEL_RATIO);
    this._currentPixelRatio = this._basePixelRatio;
    this.renderer.setPixelRatio(this._currentPixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled  = true;
    this.renderer.shadowMap.type     = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping        = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.outputColorSpace   = THREE.SRGBColorSpace;

    // ── Scene ─────────────────────────────────────────────────
    this.scene = new THREE.Scene();

    // ── Core subsystems ───────────────────────────────────────
    this.world    = new WorldManager(this.scene, this.renderer);
    this.aircraft = new AircraftController(this.scene);
    this.input    = new InputHandler();
    this.camera   = new CameraSystem(this.renderer);
    this.audio    = new AudioSystem();

    // ── FX subsystems ─────────────────────────────────────────
    this.post       = new PostProcessor(this.renderer, { threshold: 0.72, bloomStr: 0.42, bloomScale: 0.25, exposure: 1.02 });
    this.contrail   = new ContrailSystem(this.scene);
    this.speedLines = new SpeedLines(canvas.parentElement ?? document.body);
    this.weather    = new WeatherSystem(this.scene, 'none');
    this.weather.setCamera(this.camera.getCamera());
    this.crashFx    = new CrashEffectSystem(this.scene);
    this.guns       = new GunSystem(this.scene);
    this.guidance   = new GuidanceSystem(this.scene, this.world, this.camera.getCamera(), canvas);
    this.damage     = callbacks.damageSystem ?? new DamageSystem();
    this.career     = callbacks.careerSystem ?? new CareerSystem();
    this.race       = new RaceSystem(this.scene, this.world, this.career);
    this.onlineRace = new OnlineRaceSystem(this.scene, this.world, this.career);
    this.replay     = new ReplaySystem();

    // ── Loop ──────────────────────────────────────────────────
    this.clock       = new THREE.Clock(false);
    this.accumulator = 0;
    this.isRunning   = false;
    this.isPaused    = false;
    this._animId     = null;
    this._state      = null;

    // ── Challenge state ────────────────────────────────────────
    this.gameMode          = 'free_fly';
    this.challengeTimer    = 0;
    this.ringsCompleted    = 0;
    this.totalRings        = 0;
    this.challengeFinished = false;
    this._raceResolved = false;
    this._pendingRaceResult = null;
    this.aimCursor = new THREE.Vector2();
    this._lastLandedState = null;
    this._lastRaceStunActive = false;
    this._renderDt = 1 / 60;
    this._slowFrames = 0;
    this._fastFrames = 0;
    this._reducedFx = false;
    this._fxTick = 0;
    this._lastFrameStamp = 0;
    this._frameInterval = 0;

    // ── Settings ──────────────────────────────────────────────
    this.settings = { bloom: true, contrail: true, weather: 'none', shadows: true, fpsCap: 0, quality: 'auto' };
    this.devTools = {
      enabled: false,
      routePoints: [],
      routeIndex: 0,
      captureArmed: false,
      routeActive: false,
      raceAutoWin: false,
    };

    // ── Input callbacks ───────────────────────────────────────
    this.input.onCameraToggle = () => this.cycleCameraMode();
    this.input.onGuidanceToggle = () => this.toggleGuidance();
    this.input.onTrick        = () => callbacks.onTrick?.(this.aircraft.triggerRandomTrick());
    this.input.onAssistToggle = () => callbacks.onAssistChange?.(this.aircraft.toggleStabilityAssist());
    this.input.onReload       = () => {
      if (this.reloadGun()) callbacks.onReload?.();
    };
    this.input.onAimModeToggle = () => callbacks.onGunModeChange?.(this.toggleGunAimMode());
    this.input.onPause        = () => callbacks.onPause?.();
    this.input.onHelpToggle   = () => callbacks.onHelpToggle?.();
    this.input.onMouseToggle  = en => callbacks.onMouseToggle?.(en);
    this.guidance.setExternalPointClickHandler?.(point => this._handleDevPointPlacement(point));

    if (DEBUG) console.log('[Engine] Created');
  }

  // ── Init ──────────────────────────────────────────────────
  async init(aircraftType, environment, gameMode = 'free_fly', options = {}) {
    this.gameMode = gameMode;
    this.sessionOptions = options;
    this.devTools.enabled = options?.userRole === 'dev';
    this.devTools.captureArmed = false;
    this.devTools.routeActive = false;
    this.devTools.raceAutoWin = false;
    this.devTools.routeIndex = 0;
    const activeEnvironment = isRaceMode(gameMode) ? RACE.TRACK_KEY : environment;
    this.world.loadEnvironment(activeEnvironment);
    this.world.setGuidelineVisible(false);
    this.guidance.resetForEnvironment();
    this.guidance.setEnabled(true);
    this.guidance.setAutoLandAllowed(options?.roomSession?.room?.rules?.autoLandAllowed !== false);
    this.camera.setReplayActive(false, 0);
    this.replay.reset();
    this._pendingRaceResult = null;
    this.aimCursor.set(0, 0);
    this._lastLandedState = null;
    this._lastRaceStunActive = false;

    this.aircraft.getTerrainHeight = (x, z) => this.world.getSurfaceHeight(x, z);
    this.aircraft.checkObstacleHit = (pos, radius = 0, extents = null) => this.world.checkObstacleCollision(pos, radius, extents);
    this.aircraft.checkObstacleSweep = (start, end, radius = 0, extents = null) => this.world.checkObstacleCollisionSweep(start, end, radius, extents);
    this.aircraft.waterLevel = this.world.envConfig?.waterLevel ?? -200;
    this.aircraft.setConditionPenaltyEnabled(gameMode !== 'free_fly');
    this.aircraft.loadAircraft(aircraftType);
    if (options?.roomSession?.room?.rules) {
      this._applySessionRaceRules(options.roomSession.room.rules);
    }
    this.aircraft.setCondition(gameMode === 'free_fly' ? 100 : this.damage.getCondition(aircraftType));
    this.callbacks.onFleetUpdate?.(this.damage.getFleetStatus());
    const spawn = this.world.getSpawnTransform(gameMode, options.spawnSlot ?? 0);
    if (spawn) {
      this.aircraft.setFlightState({
        ...spawn,
        preserveExactSpeed: true,
      });
    }

    await this.audio.init();
    this.audio.speakATC?.(`Tower to ${this.aircraft.config?.name ?? 'pilot'}, you are cleared for departure.`);

    if (gameMode === 'challenge') {
      this.world.loadChallengeRings(activeEnvironment);
      this.totalRings    = this.world.rings.length;
      this.challengeTimer = 0;
      this.ringsCompleted = 0;
      this.challengeFinished = false;
    } else if (isOfflineRaceMode(gameMode)) {
      this.world.loadChallengeRings(RACE.TRACK_KEY);
      this.race.start(gameMode, aircraftType, options);
      this._raceResolved = false;
    } else if (isOnlineRaceMode(gameMode)) {
      this.world.loadChallengeRings(RACE.TRACK_KEY);
      await this.onlineRace.start(gameMode, aircraftType, options);
      this._raceResolved = false;
    }

    // Environment-flavoured weather
    const wxMap = { mountains: 'snow', city: 'rain', storm: 'storm', air_race: 'none' };
    const wx = wxMap[activeEnvironment] ?? 'none';
    this.weather.setType(wx);
    this.settings.weather = wx;

    if (DEBUG) console.log('[Engine] Init done:', { aircraftType, environment: activeEnvironment, gameMode });
    this.callbacks.onCameraChange?.(this.camera.getMode());
    this.callbacks.onGuidanceChange?.(this.guidance.isEnabled());
    this.callbacks.onAssistChange?.(this.aircraft.stabilityAssistEnabled);
    this.callbacks.onDevPathChange?.(this.getDevAutoflyStatus());
  }

  _applySessionRaceRules(rules = {}) {
    if (!this.aircraft?.config || !this.aircraft?.baseConfig) return;

    const base = this.aircraft.baseConfig;
    const preset = rules.physicsPreset === 'arcade' ? 'arcade' : rules.physicsPreset === 'sport' ? 'sport' : 'sim';
    const speedMultiplier = THREE.MathUtils.clamp(Number(rules.speedMultiplier) || 1, 0.7, 1.35);
    const presetScales = {
      sim:    { control: 1.0, lift: 1.0, drag: 1.0, stall: 1.0, thrust: 1.0 },
      sport:  { control: 1.08, lift: 1.04, drag: 0.96, stall: 0.98, thrust: 1.02 },
      arcade: { control: 1.18, lift: 1.09, drag: 0.9, stall: 0.94, thrust: 1.08 },
    }[preset];

    Object.assign(this.aircraft.config, {
      maxSpeed: base.maxSpeed * speedMultiplier,
      maxThrust: base.maxThrust * speedMultiplier * presetScales.thrust,
      stallSpeed: base.stallSpeed * presetScales.stall,
      rollRate: base.rollRate * presetScales.control,
      pitchRate: base.pitchRate * presetScales.control,
      yawRate: base.yawRate * presetScales.control,
      liftCoefficient: base.liftCoefficient * presetScales.lift,
      dragCoefficient: base.dragCoefficient * presetScales.drag,
    });
  }

  // ── Loop ──────────────────────────────────────────────────
  start() { this.clock.start(); this.isRunning = true; this._lastFrameStamp = 0; this._loop(); }
  pause()  { this.isPaused = true;  }
  resume() { this.isPaused = false; }

  applySettings(s) {
    Object.assign(this.settings, s);
    if (s.fpsCap !== undefined) this.setFpsCap(s.fpsCap);
    if (s.quality !== undefined) this.setRenderQuality(s.quality);
    const isPerformanceMode = (this.settings.quality ?? 'auto') === 'performance' && !this._reducedFx;
    this.post.enabled               = true;
    this.contrail.setEnabled(         this.settings.contrail  ?? true);
    this.renderer.shadowMap.enabled = isPerformanceMode ? false : (this.settings.shadows ?? true);
    if (s.weather !== undefined) this.weather.setType(s.weather);
  }

  _loop(frameStamp = performance.now()) {
    this._animId = requestAnimationFrame(nextStamp => this._loop(nextStamp));
    if (!this.isRunning || this.isPaused) return;
    if (this._frameInterval > 0 && this._lastFrameStamp && frameStamp - this._lastFrameStamp < this._frameInterval) return;
    this._lastFrameStamp = frameStamp;

    const rawDt = Math.min(this.clock.getDelta(), 0.1);
    this.accumulator += rawDt;

    while (this.accumulator >= PHYSICS.FIXED_TIMESTEP) {
      this._fixedUpdate(PHYSICS.FIXED_TIMESTEP);
      this.accumulator -= PHYSICS.FIXED_TIMESTEP;
    }

    this._renderFrame(rawDt);
  }

  _fixedUpdate(dt) {
    this._fxTick++;
    if (this.replay.isPlaying()) {
      const replayFrame = this.replay.update(dt);
      const replayState = replayFrame?.snapshot;
      if (replayState) {
        this.camera.setReplayActive(true, replayFrame.progress);
        this.world.update(replayState, dt);
        this.camera.update(replayState, dt);

        this._state = {
          ...replayState,
          gameMode: this.gameMode,
          cameraMode: this.camera.getMode(),
          mouseEnabled: this.input.mouseSteeringEnabled,
          guidanceEnabled: false,
          assistEnabled: this.aircraft.stabilityAssistEnabled,
          ...this.getDevAutoflyStatus(),
          replayActive: true,
          replayProgress: replayFrame.progress,
          career: this.career.getState(),
          ...(this.race.getStatus?.() ?? {}),
        };
        this.callbacks.onStateUpdate?.(this._state);

        if (replayFrame.finished && this._pendingRaceResult) {
          const payload = this._pendingRaceResult;
          this._pendingRaceResult = null;
          this.camera.setReplayActive(false, 0);
          this.callbacks.onRaceComplete?.(payload);
        }
        return;
      }
      this.camera.setReplayActive(false, 0);
    }

    const rawInput = this.input.getState();
    const liveRaceStatus = isOfflineRaceMode(this.gameMode)
      ? this.race.getStatus?.() ?? {}
      : isOnlineRaceMode(this.gameMode)
        ? this.onlineRace.getStatus?.() ?? {}
        : {};
    if (isRaceMode(this.gameMode) && liveRaceStatus.raceCountdownActive) {
      rawInput.throttle = Math.min(rawInput.throttle, 0);
      rawInput.boost = false;
      rawInput.fire = false;
    }
    this._updateAimCursor(rawInput, dt);
    const preUpdateState = this.aircraft.getState();
    const autolandOverride = this.guidance.getAutolandOverride(preUpdateState, dt);
    const devOverride = this._getDevAutoflyOverride(preUpdateState, dt, liveRaceStatus);
    if (devOverride) {
      this.aircraft.applyExternalFlightState(devOverride);
    } else if (autolandOverride) {
      this.aircraft.applyExternalFlightState(autolandOverride);
    } else {
      const guidedInput = this.guidance.modifyInput(rawInput, preUpdateState);
      this.aircraft.update(guidedInput, dt);
    }
    this._processAircraftEvents();
    let s = this.aircraft.getState();
    this.replay.record(s, dt);
    const gunProfile = this.career.getEquippedGun();
    this.guns.syncProfile(gunProfile);
    if (rawInput.fire) {
      const fired = this.guns.tryFire(s, { x: this.aimCursor.x, y: this.aimCursor.y }, gunProfile);
      if (fired) this.audio.triggerGunFire?.(gunProfile);
    }
    this.guns.update(dt);
    const shotPackets = this.guns.getCollisionPackets();

    this.world.update(s, dt);
    this.camera.update(s, dt);
    this.audio.update(s.throttle, s.speed, this.aircraft.config?.maxSpeed ?? 200, s.isStalling);

    // Contrail — exhaust origin slightly behind aircraft
    const exhaust = new THREE.Vector3(0, 0, 3).applyQuaternion(s.quaternion).add(s.position);
    if (!this._reducedFx || this._fxTick % 2 === 0 || s.speed > 110) {
      this.contrail.update(exhaust, s.throttle, s.speed, s.altitude, dt);
    }

    // Weather moves with player
    if (this.settings.weather !== 'none' && (!this._reducedFx || this._fxTick % 2 === 0)) {
      this.weather.update(dt, s.position);
    }

    // Challenge
    if (this.gameMode === 'challenge' && !this.challengeFinished) {
      this.challengeTimer += dt;
      const passed = this.world.checkRingPass(s.position, 4);
      if (passed >= 0) {
        this.world.markRingPassed(passed);
        this.ringsCompleted++;
        if (this.ringsCompleted >= this.totalRings) {
          this.challengeFinished = true;
          const score = Math.max(0, Math.round(10000 - this.challengeTimer * 100));
          const careerResult = this.career.applyChallengeResult?.(score, this.challengeTimer) ?? null;
          this.callbacks.onChallengeComplete?.({ time: this.challengeTimer, score, careerResult, careerState: this.career.getState() });
        }
      }
    }

    let raceStatus = {};
    if (isOfflineRaceMode(this.gameMode)) {
      raceStatus = this.race.update(dt, s, shotPackets, gunProfile);
      if (raceStatus.racePlayerStunTimer > 0) {
        this.aircraft.applyStun(raceStatus.racePlayerStunTimer);
      }
      const stunned = raceStatus.racePlayerStunned === true;
      if (stunned && !this._lastRaceStunActive) this.audio.triggerHit?.();
      this._lastRaceStunActive = stunned;
      if (raceStatus.raceFinished && !this._raceResolved) {
        const result = this.race.maybeFinalizeCareer(this.career);
        this._raceResolved = true;
        const payload = {
          ...raceStatus,
          careerResult: result,
          careerState: this.career.getState(),
        };
        if (this.replay.startFinishReplay()) {
          this._pendingRaceResult = payload;
          this.camera.setReplayActive(true, 0);
        } else {
          this.callbacks.onRaceComplete?.(payload);
        }
      }
    } else if (isOnlineRaceMode(this.gameMode)) {
      raceStatus = this.onlineRace.update(dt, s);
      if (raceStatus.raceFinished && !this._raceResolved) {
        const result = this.onlineRace.maybeFinalizeCareer(this.career);
        this._raceResolved = true;
        const payload = {
          ...raceStatus,
          careerResult: result,
          careerState: this.career.getState(),
        };
        if (this.replay.startFinishReplay()) {
          this._pendingRaceResult = payload;
          this.camera.setReplayActive(true, 0);
        } else {
          this.callbacks.onRaceComplete?.(payload);
        }
      }
    }

    if (raceStatus.raceRespawnTransform) {
      this.aircraft.setFlightState({
        ...raceStatus.raceRespawnTransform,
        preserveExactSpeed: true,
      });
      this.race.clearRespawnRequest?.();
      this.onlineRace.clearRespawnRequest?.();
      s = this.aircraft.getState();
      this.audio.speakATC?.('Track limits exceeded. Returning aircraft to the start grid.');
    }

    const guidanceState = {
      ...s,
      ...raceStatus,
      raceGuideTarget: this.world.getRaceGuideTargetByIndex?.(raceStatus.raceNextGateIndex ?? 0) ?? this.world.getRaceGuideTarget?.(s.position) ?? null,
    };
    this.guidance.update(guidanceState, dt);

    this._state = {
      ...s,
      gameMode:          this.gameMode,
      challengeTimer:    this.challengeTimer,
      ringsCompleted:    this.ringsCompleted,
      totalRings:        this.totalRings,
      challengeFinished: this.challengeFinished,
      cameraMode:        this.camera.getMode(),
      mouseEnabled:      this.input.mouseSteeringEnabled,
      aimX:              this.aimCursor.x,
      aimY:              this.aimCursor.y,
      guidanceEnabled:   this.guidance.isEnabled(),
      assistEnabled:     this.aircraft.stabilityAssistEnabled,
      ...this.guidance.getStatus(),
      ...this.guns.getStatus(),
      gunAvailable: this.guns.canFire(s.aircraftType, this.career.getEquippedGun()),
      ...raceStatus,
      ...this.getDevAutoflyStatus(),
      ...this.replay.getStatus(),
      career: this.career.getState(),
    };
    if (this._state.landed && this._state.landed !== this._lastLandedState) {
      if (this._state.landed === 'smooth') {
        this.audio.triggerLanding?.('smooth');
        this.audio.speakATC?.('Tower confirms smooth touchdown. Welcome back.');
      } else if (this._state.landed === 'hard') {
        this.audio.triggerLanding?.('hard');
        this.audio.speakATC?.('Tower advises hard landing detected. Taxi with caution.');
      }
    }
    this._lastLandedState = this._state.landed ?? null;
    this.callbacks.onStateUpdate?.(this._state);
  }

  _renderFrame(dt) {
    if (!this._state) return;
    this._updatePerformanceBudget(dt);
    this.crashFx.update(dt);
    const s = this._state;
    const maxSpd = this.aircraft.config?.maxSpeed ?? 200;
    const spd    = s.speed / maxSpd;

    // Adaptive bloom — boosts at high speed and afterburner
    if (this.settings.bloom && !this._reducedFx) {
      const extra = (s.boostActive ? 0.3 : 0) + (spd > 0.7 ? (spd - 0.7) * 0.8 : 0);
      this.post.setBloom(0.42 + extra, spd > 0.9 ? 0.6 : 0.72);
    } else {
      this.post.setBloom(0, 1);
    }

    // Speed lines canvas overlay
    this.speedLines.update((!this._reducedFx || spd > 0.78) ? spd : 0, dt);

    // Render through post-processor (falls back to direct if disabled)
    this.post.render(this.scene, this.camera.getCamera());
  }

  _updatePerformanceBudget(dt) {
    this._renderDt = THREE.MathUtils.lerp(this._renderDt, dt, 0.08);

    if (this._renderDt > 0.027) {
      this._slowFrames++;
      this._fastFrames = 0;
    } else if (this._renderDt < 0.019) {
      this._fastFrames++;
      this._slowFrames = Math.max(0, this._slowFrames - 2);
    } else {
      this._slowFrames = Math.max(0, this._slowFrames - 1);
      this._fastFrames = Math.max(0, this._fastFrames - 1);
    }

    if (!this._reducedFx && this._slowFrames > 20) {
      this._setReducedFx(true);
    } else if (this._reducedFx && this._fastFrames > 90) {
      this._setReducedFx(false);
    }
  }

  _setReducedFx(enabled) {
    if (this._reducedFx === enabled) return;
    this._reducedFx = enabled;

    const targetRatio = enabled ? Math.min(1.0, this._basePixelRatio) : this._getTargetPixelRatio(this.settings.quality);
    if (Math.abs(targetRatio - this._currentPixelRatio) > 0.01) {
      this._currentPixelRatio = targetRatio;
      this.renderer.setPixelRatio(targetRatio);
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
      this.post.resize(window.innerWidth, window.innerHeight);
    }

    this.post.enabled = true;
  }

  _getTargetPixelRatio(quality = 'auto') {
    switch (quality) {
      case 'performance': return Math.min(0.92, this._basePixelRatio);
      case 'balanced': return Math.min(1.45, this._basePixelRatio);
      case 'quality': return Math.min(1.9, this._basePixelRatio);
      default: return Math.min(1.24, this._basePixelRatio);
    }
  }

  setRenderQuality(quality = 'auto') {
    this.settings.quality = quality;
    const targetRatio = this._reducedFx ? Math.min(1.0, this._basePixelRatio) : this._getTargetPixelRatio(quality);
    if (Math.abs(targetRatio - this._currentPixelRatio) > 0.01) {
      this._currentPixelRatio = targetRatio;
      this.renderer.setPixelRatio(targetRatio);
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
      this.post.resize(window.innerWidth, window.innerHeight);
    }
    if (quality === 'performance' && !this._reducedFx) {
      this.renderer.shadowMap.enabled = false;
    } else {
      this.renderer.shadowMap.enabled = this.settings.shadows ?? true;
    }
    this.post.enabled = true;
    return quality;
  }

  setFpsCap(value = 0) {
    const cap = Number(value) || 0;
    this.settings.fpsCap = cap;
    this._frameInterval = cap > 0 ? 1000 / cap : 0;
    this._lastFrameStamp = 0;
    return this.settings.fpsCap;
  }

  getDevAutoflyStatus() {
    return {
      devModeAvailable: this.devTools.enabled,
      devRoutePointCount: this.devTools.routePoints.length,
      devRouteCaptureArmed: this.devTools.captureArmed,
      devAutoPathActive: this.devTools.routeActive,
      devAutoRaceActive: this.devTools.raceAutoWin,
    };
  }

  armDevRouteCapture() {
    if (!this.devTools.enabled) return this.getDevAutoflyStatus();
    if (this.devTools.routePoints.length >= 10) this.devTools.routePoints = [];
    this.devTools.captureArmed = true;
    this.devTools.routeActive = false;
    this.devTools.raceAutoWin = false;
    const status = this.getDevAutoflyStatus();
    this.callbacks.onDevPathChange?.(status);
    return status;
  }

  clearDevRoute() {
    this.devTools.routePoints = [];
    this.devTools.routeIndex = 0;
    this.devTools.captureArmed = false;
    this.devTools.routeActive = false;
    this.devTools.raceAutoWin = false;
    const status = this.getDevAutoflyStatus();
    this.callbacks.onDevPathChange?.(status);
    return status;
  }

  toggleDevRouteAutofly() {
    if (!this.devTools.enabled || !this.devTools.routePoints.length) return this.getDevAutoflyStatus();
    this.devTools.routeActive = !this.devTools.routeActive;
    this.devTools.routeIndex = THREE.MathUtils.clamp(this.devTools.routeIndex, 0, Math.max(0, this.devTools.routePoints.length - 1));
    this.devTools.captureArmed = false;
    this.devTools.raceAutoWin = false;
    const status = this.getDevAutoflyStatus();
    this.callbacks.onDevPathChange?.(status);
    return status;
  }

  toggleDevRaceAutofly() {
    if (!this.devTools.enabled || !isRaceMode(this.gameMode)) return this.getDevAutoflyStatus();
    this.devTools.raceAutoWin = !this.devTools.raceAutoWin;
    this.devTools.captureArmed = false;
    this.devTools.routeActive = false;
    const status = this.getDevAutoflyStatus();
    this.callbacks.onDevPathChange?.(status);
    return status;
  }

  // ── In-flight aircraft switch ─────────────────────────────
  changeAircraft(type) {
    const s = this.aircraft.getState();
    this.aircraft.loadAircraft(type);
    this.aircraft.setCondition(this.gameMode === 'free_fly' ? 100 : this.damage.getCondition(type));
    this.aircraft.setFlightState({
      position: s.position,
      quaternion: s.quaternion,
      speed: s.speed,
      throttle: s.throttle,
    });
    this._state = {
      ...this.aircraft.getState(),
      gameMode: this.gameMode,
      challengeTimer: this.challengeTimer,
      ringsCompleted: this.ringsCompleted,
      totalRings: this.totalRings,
      challengeFinished: this.challengeFinished,
      cameraMode: this.camera.getMode(),
      mouseEnabled: this.input.mouseSteeringEnabled,
      guidanceEnabled: this.guidance.isEnabled(),
      assistEnabled: this.aircraft.stabilityAssistEnabled,
      ...this.getDevAutoflyStatus(),
    };
    this.callbacks.onStateUpdate?.(this._state);
    this.callbacks.onFleetUpdate?.(this.damage.getFleetStatus());
  }

  cycleCameraMode() {
    const mode = this.camera.toggleMode();
    if (this._state) this._state.cameraMode = mode;
    this.callbacks.onCameraChange?.(mode);
    return mode;
  }

  setGuidanceEnabled(enabled) {
    const next = this.guidance.setEnabled(enabled);
    if (this._state) this._state.guidanceEnabled = next;
    this.callbacks.onGuidanceChange?.(next);
    return next;
  }

  toggleGuidance() {
    return this.setGuidanceEnabled(!this.guidance.isEnabled());
  }

  toggleAutoLand() {
    const enabled = this.guidance.toggleAutoLand();
    const status = this.guidance.getStatus();
    if (this._state) Object.assign(this._state, status, { autoLandEnabled: enabled });
    return status;
  }

  toggleAssist() {
    const enabled = this.aircraft.toggleStabilityAssist();
    if (this._state) this._state.assistEnabled = enabled;
    this.callbacks.onAssistChange?.(enabled);
    return enabled;
  }

  repairAircraft(type) {
    const condition = this.damage.repair(type);
    if (this.aircraft.aircraftType === type) this.aircraft.repair();
    this.callbacks.onFleetUpdate?.(this.damage.getFleetStatus());
    return condition;
  }

  repairAllAircraft() {
    this.damage.repairAll();
    this.aircraft.repair();
    this.callbacks.onFleetUpdate?.(this.damage.getFleetStatus());
  }

  getCareerState() {
    return this.career.getState();
  }

  getCareerPlanes() {
    return this.career.getAvailablePlanes();
  }

  getCareerGuns() {
    return this.career.getAvailableGuns();
  }

  purchaseRacePlane(type) {
    return this.career.purchasePlane(type);
  }

  purchaseGun(id) {
    return this.career.purchaseGun(id);
  }

  equipGun(id) {
    return this.career.equipGun(id);
  }

  getControlBindings() {
    return this.input.getBindings();
  }

  setGunAimMode(mode) {
    const next = this.guns.setAimMode(mode);
    if (next === 'follow') this.aimCursor.set(0, 0);
    if (this._state) {
      this._state.gunAimMode = next;
      this._state.aimX = this.aimCursor.x;
      this._state.aimY = this.aimCursor.y;
    }
    return next;
  }

  toggleGunAimMode() {
    return this.setGunAimMode(this.guns.toggleAimMode());
  }

  reloadGun() {
    const aircraftType = this.aircraft?.aircraftType ?? this._state?.aircraftType;
    if (!this.guns.canFire(aircraftType, this.career.getEquippedGun())) return false;
    const started = this.guns.reload(this.career.getEquippedGun());
    if (started) this.audio.triggerReload?.();
    return started;
  }

  setControlBinding(action, code) {
    return this.input.setBinding(action, code);
  }

  resetControlBindings() {
    return this.input.resetBindings();
  }

  resetAircraftToRunway() {
    const spawn = this.world.getSpawnTransform(this.gameMode, this.sessionOptions?.spawnSlot ?? 0);
    if (!spawn) return null;
    this.guidance.resetForEnvironment();
    this.aircraft.setFlightState({
      ...spawn,
      preserveExactSpeed: true,
    });
    if (this.gameMode === 'free_fly') this.aircraft.setCondition(100);
    const next = this.aircraft.getState();
    this._state = {
      ...this._state,
      ...next,
      guidanceEnabled: this.guidance.isEnabled(),
      assistEnabled: this.aircraft.stabilityAssistEnabled,
      cameraMode: this.camera.getMode(),
      ...this.getDevAutoflyStatus(),
    };
    this.callbacks.onStateUpdate?.(this._state);
    return this._state;
  }

  _handleDevPointPlacement(point) {
    if (!this.devTools.enabled || !this.devTools.captureArmed || !point) return false;
    if (this.devTools.routePoints.length >= 10) {
      this.devTools.captureArmed = false;
      this.callbacks.onDevPathChange?.(this.getDevAutoflyStatus());
      return false;
    }
    this.devTools.routePoints.push(point.clone());
    this.devTools.routeIndex = 0;
    if (this.devTools.routePoints.length >= 10) this.devTools.captureArmed = false;
    this.callbacks.onDevPathChange?.(this.getDevAutoflyStatus());
    return true;
  }

  _getDevAutoflyOverride(flightState, dt, raceStatus = {}) {
    if (!this.devTools.enabled || !flightState) return null;

    if (this.devTools.raceAutoWin && isRaceMode(this.gameMode)) {
      const target = this.world.getRaceGuideTargetByIndex?.(raceStatus.raceNextGateIndex ?? 0);
      if (target) return this._buildAutoflyOverride(flightState, target, dt, 1.24);
    }

    if (this.devTools.routeActive && this.devTools.routePoints.length) {
      const target = this.devTools.routePoints[this.devTools.routeIndex];
      if (!target) {
        this.devTools.routeActive = false;
        this.callbacks.onDevPathChange?.(this.getDevAutoflyStatus());
        return null;
      }
      if (flightState.position.distanceTo(target) < 90) {
        this.devTools.routeIndex += 1;
        if (this.devTools.routeIndex >= this.devTools.routePoints.length) {
          this.devTools.routeActive = false;
          this.devTools.routeIndex = Math.max(0, this.devTools.routePoints.length - 1);
          this.callbacks.onDevPathChange?.(this.getDevAutoflyStatus());
          return null;
        }
      }
      return this._buildAutoflyOverride(flightState, this.devTools.routePoints[this.devTools.routeIndex], dt, 1.08);
    }

    return null;
  }

  _buildAutoflyOverride(flightState, target, dt, speedMultiplier = 1.08) {
    const toTarget = target.clone().sub(flightState.position);
    const distance = Math.max(1, toTarget.length());
    const desiredDirection = toTarget.normalize();
    const lookTarget = flightState.position.clone().add(desiredDirection.clone().multiplyScalar(180));
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(flightState.position, lookTarget, new THREE.Vector3(0, 1, 0))
    );
    const targetSpeed = Math.max(
      this.aircraft.config?.stallSpeed ?? 80,
      (this.aircraft.config?.maxSpeed ?? 220) * speedMultiplier
    );
    const response = 1 - Math.exp(-dt * 2.2);
    const cappedTargetSpeed = distance < 120 && !isRaceMode(this.gameMode)
      ? Math.max((this.aircraft.config?.stallSpeed ?? 80) * 0.94, targetSpeed * 0.74)
      : targetSpeed;
    const nextSpeed = THREE.MathUtils.lerp(flightState.speed, cappedTargetSpeed, response);
    const velocity = desiredDirection.multiplyScalar(nextSpeed);
    const position = flightState.position.clone().addScaledVector(velocity, dt);
    if (distance < 120 && !isRaceMode(this.gameMode)) {
      velocity.multiplyScalar(0.82);
    }

    return {
      position,
      quaternion,
      velocity,
      throttle: 1,
      landed: false,
    };
  }

  _processAircraftEvents() {
    const events = this.aircraft.consumeEvents();
    if (!events.length) return;

    events.forEach(event => {
      if (this.gameMode !== 'free_fly') {
        const nextCondition = this.damage.applyDamage(event.aircraftType, event.damage);
        if (event.aircraftType === this.aircraft.aircraftType) {
          this.aircraft.setCondition(nextCondition);
        }
      } else if (event.aircraftType === this.aircraft.aircraftType) {
        this.aircraft.setCondition(100);
      }
      if (event.kind === 'smooth') {
        this.crashFx.triggerLanding(event.position, Math.max(0.2, event.intensity * 0.4), 'smooth');
        this.camera.addImpactShake?.(0.12);
      } else if (event.kind === 'hard_landing') {
        this.crashFx.triggerLanding(event.position, Math.max(0.32, event.intensity * 0.55), 'hard');
        this.audio.triggerCrash?.(Math.min(0.55, event.intensity * 0.5));
        this.camera.addImpactShake?.(0.38);
      } else {
        this.crashFx.triggerImpact(event.position, event.intensity);
        this.audio.triggerCrash?.(Math.min(1.3, event.intensity));
        this.camera.addImpactShake?.(0.95 * event.intensity);
      }
      if (event.kind === 'crash' || event.kind === 'water' || event.kind === 'obstacle') {
        this.audio.speakATC?.('Tower to pilot, emergency crews are responding now.');
      }
    });

    this.callbacks.onFleetUpdate?.(this.damage.getFleetStatus());
  }

  _updateAimCursor(rawInput, dt) {
    const mode = this.guns.getStatus().gunAimMode;
    if (mode === 'follow') {
      this.aimCursor.lerp(new THREE.Vector2(0, 0), 1 - Math.exp(-dt * 14));
      return;
    }
    const speed = 1.9;
    this.aimCursor.x = THREE.MathUtils.clamp(this.aimCursor.x + (rawInput.aimX ?? 0) * dt * speed, -1, 1);
    this.aimCursor.y = THREE.MathUtils.clamp(this.aimCursor.y + (rawInput.aimY ?? 0) * dt * speed, -1, 1);
  }

  // ── Cleanup ───────────────────────────────────────────────
  destroy() {
    this.isRunning = false;
    cancelAnimationFrame(this._animId);
    this.audio.destroy();
    this.aircraft.destroy();
    this.world.destroy();
    this.camera.destroy();
    this.input.destroy();
    this.post.destroy();
    this.contrail.destroy();
    this.speedLines.destroy();
    this.weather.destroy();
    this.crashFx.destroy();
    this.guns.destroy();
    this.guidance.destroy();
    this.race.destroy();
    this.onlineRace.destroy();
    this.replay.destroy();
    this.renderer.dispose();
    if (DEBUG) console.log('[Engine] Destroyed');
  }
}
