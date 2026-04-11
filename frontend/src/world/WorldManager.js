import * as THREE from 'three';
import { ENVIRONMENTS, CHALLENGE, RENDER, RACE } from '../config.js';
import { Noise } from './noise.js';
import {
  AssetLoader,
  createProceduralTerrainSet,
} from '../assets/AssetLoader.js';
import { ASSET_SOURCES } from '../assets/AssetCatalog.js';
import { createLayeredTerrainMaterial } from './TerrainMaterial.js';

function makeWindowTexture(baseHex, litHex) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, size, size);

  for (let y = 10; y < size; y += 20) {
    for (let x = 8; x < size; x += 20) {
      const lit = Math.random() > 0.32;
      ctx.fillStyle = lit ? litHex : '#18212c';
      ctx.fillRect(x, y, 10, 12);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 4);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeNeonWindowTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#09121e';
  ctx.fillRect(0, 0, size, size);

  const palette = ['#79d7ff', '#7ef5d0', '#ff8bd6', '#ffd97c', '#5db1ff'];
  for (let y = 10; y < size; y += 20) {
    for (let x = 8; x < size; x += 20) {
      const lit = Math.random() > 0.22;
      ctx.fillStyle = lit ? palette[Math.floor(Math.random() * palette.length)] : '#101d2c';
      ctx.fillRect(x, y, 10, 12);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 4);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeSoftCloudTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.12, size / 2, size / 2, size * 0.5);
  grad.addColorStop(0, 'rgba(255,255,255,0.92)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function makeGlowTexture(inner = 'rgba(255,240,210,1)', outer = 'rgba(255,210,120,0)') {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.06, size / 2, size / 2, size * 0.5);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.28, 'rgba(255,220,150,0.65)');
  grad.addColorStop(1, outer);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeChevronTexture(primary = '#8feeff', accent = '#ffffff') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(5, 18, 32, 0.18)';
  ctx.fillRect(0, 76, canvas.width, 104);

  const drawChevron = (x, scale) => {
    ctx.save();
    ctx.translate(x, canvas.height * 0.5);
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.moveTo(-44, -58);
    ctx.lineTo(24, 0);
    ctx.lineTo(-44, 58);
    ctx.lineTo(-10, 58);
    ctx.lineTo(58, 0);
    ctx.lineTo(-10, -58);
    ctx.closePath();
    const grad = ctx.createLinearGradient(-44, 0, 58, 0);
    grad.addColorStop(0, 'rgba(143,238,255,0.15)');
    grad.addColorStop(0.35, primary);
    grad.addColorStop(1, accent);
    ctx.fillStyle = grad;
    ctx.shadowColor = primary;
    ctx.shadowBlur = 18;
    ctx.fill();
    ctx.restore();
  };

  drawChevron(132, 1.0);
  drawChevron(256, 1.12);
  drawChevron(380, 1.0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function makeSkyBackdropTexture(env) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, `#${new THREE.Color(env.skyTopColor).getHexString()}`);
  gradient.addColorStop(0.46, `#${new THREE.Color(env.fogColor).getHexString()}`);
  gradient.addColorStop(1, `#${new THREE.Color(env.skyBottomColor).getHexString()}`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const warmGlow = ctx.createLinearGradient(0, canvas.height * 0.42, 0, canvas.height);
  warmGlow.addColorStop(0, 'rgba(255, 190, 120, 0.0)');
  warmGlow.addColorStop(0.55, 'rgba(255, 188, 108, 0.14)');
  warmGlow.addColorStop(1, 'rgba(255, 214, 168, 0.28)');
  ctx.fillStyle = warmGlow;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const sunX = canvas.width * 0.7;
  const sunY = canvas.height * 0.36;
  const sunGlow = ctx.createRadialGradient(sunX, sunY, canvas.width * 0.02, sunX, sunY, canvas.width * 0.18);
  sunGlow.addColorStop(0, 'rgba(255, 243, 210, 0.95)');
  sunGlow.addColorStop(0.32, 'rgba(255, 220, 162, 0.36)');
  sunGlow.addColorStop(1, 'rgba(255, 198, 140, 0.0)');
  ctx.fillStyle = sunGlow;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const drawCloud = (x, y, width, height, opacity) => {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(x, y, width * 0.32, height * 0.38, 0, 0, Math.PI * 2);
    ctx.ellipse(x + width * 0.18, y - height * 0.1, width * 0.28, height * 0.32, 0, 0, Math.PI * 2);
    ctx.ellipse(x - width * 0.18, y + height * 0.02, width * 0.24, height * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  for (let i = 0; i < 18; i++) {
    drawCloud(
      Math.random() * canvas.width,
      canvas.height * (0.16 + Math.random() * 0.46),
      70 + Math.random() * 170,
      26 + Math.random() * 56,
      0.03 + Math.random() * 0.09
    );
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function samplePalette(base, mid, peak, t) {
  const lowToMid = Math.min(t * 1.35, 1);
  const midToPeak = Math.max((t - 0.45) / 0.55, 0);
  return [
    THREE.MathUtils.lerp(base[0], mid[0], lowToMid) * (1 - midToPeak) + peak[0] * midToPeak,
    THREE.MathUtils.lerp(base[1], mid[1], lowToMid) * (1 - midToPeak) + peak[1] * midToPeak,
    THREE.MathUtils.lerp(base[2], mid[2], lowToMid) * (1 - midToPeak) + peak[2] * midToPeak,
  ];
}

function makeSatelliteTexture(noise, env) {
  const size = 512;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const macro = noise.fbm(u * 3.2, v * 3.2, 5, 2.0, 0.52) * 0.5 + 0.5;
      const detail = noise.fbm(u * 14.0, v * 14.0, 3, 2.4, 0.5) * 0.5 + 0.5;
      const ridge = Math.abs(noise.get(u * 8.0, v * 8.0));
      const dryPatch = noise.get(u * 18.0 + 13.2, v * 18.0 - 7.6) * 0.5 + 0.5;
      const elevation = THREE.MathUtils.clamp(macro * 0.75 + ridge * 0.25, 0, 1);
      const palette = samplePalette(env.baseColor, env.midColor, env.peakColor, elevation);
      const warmth = THREE.MathUtils.lerp(0.92, 1.08, dryPatch);
      const vegetation = THREE.MathUtils.lerp(0.88, 1.12, detail);

      const idx = (y * size + x) * 4;
      data[idx] = THREE.MathUtils.clamp(palette[0] * warmth * 255, 0, 255);
      data[idx + 1] = THREE.MathUtils.clamp(palette[1] * vegetation * 255, 0, 255);
      data[idx + 2] = THREE.MathUtils.clamp(palette[2] * THREE.MathUtils.lerp(0.9, 1.06, detail) * 255, 0, 255);
      data[idx + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 6);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export class WorldManager {
  constructor(scene, renderer = null) {
    this.scene = scene;
    this.renderer = renderer;
    this.noise = new Noise(42);
    this.assets = new AssetLoader(renderer);

    this.terrain = null;
    this.terrainUnderlay = null;
    this.water = null;
    this.sky = null;
    this.clouds = null;
    this.sun = null;
    this.sunGlow = null;
    this.sunTarget = null;
    this.hemisphereLight = null;
    this.ambientLight = null;
    this.envConfig = null;
    this.envKey = null;
    this.runway = null;
    this.city = null;
    this.forest = null;
    this.roadNetwork = null;
    this.raceVenue = null;
    this.desertDetails = null;
    this.alpineOutpost = null;
    this.landingPath = null;
    this.runwayCenter = new THREE.Vector3();
    this.runwayDirection = new THREE.Vector3(0, 0, -1);
    this.guidelineVisible = true;
    this._guideForward = new THREE.Vector3();
    this._guideUp = new THREE.Vector3(0, 1, 0);
    this._guideOrigin = new THREE.Vector3();
    this._guideHit = new THREE.Vector3();
    this._guideMid = new THREE.Vector3();
    this._guideSample = new THREE.Vector3();
    this._guideDirection = new THREE.Vector3();
    this._guideQuat = new THREE.Quaternion();

    this.obstacles = [];
    this.rings = [];
    this._heightCache = new Map();
    this._cacheRes = 8;
    this.surfaceZones = [];
    this._windowTexture = makeWindowTexture('#2d2722', '#ffd8a1');
    this._cityWindowTexture = makeNeonWindowTexture();
    this._cloudTexture = makeSoftCloudTexture();
    this._sunGlowTexture = makeGlowTexture();
    this._satelliteTexture = null;
    this._backgroundTexture = null;
    this._environmentTexture = null;
    this._runwayBaseHeight = 0;
    this._terrainTextureSet = {
      grass: createProceduralTerrainSet('grass', { repeat: 100 }),
      dirt: createProceduralTerrainSet('dirt', { repeat: 100 }),
      rock: createProceduralTerrainSet('rock', { repeat: 100 }),
      snow: createProceduralTerrainSet('snow', { repeat: 100 }),
      sand: createProceduralTerrainSet('sand', { repeat: 100 }),
      gravel: createProceduralTerrainSet('gravel', { repeat: 100 }),
      asphalt: createProceduralTerrainSet('asphalt', { repeat: 48 }),
      water: createProceduralTerrainSet('water', { repeat: 24 }),
    };
  }

  loadEnvironment(envKey) {
    this.cleanup();
    this._heightCache.clear();
    this.surfaceZones = [];
    this.envConfig = ENVIRONMENTS[envKey];
    this.envKey = envKey;
    this._runwayBaseHeight = 0;
    if (!this.envConfig) return;

    this._createSky();
    this._createLighting();
    this._createTerrain();
    if (envKey === RACE.TRACK_KEY) {
      if (this.terrain) this.terrain.visible = false;
      if (this.terrainUnderlay) this.terrainUnderlay.visible = false;
    }
    this._createWater();
    this._createClouds();
    this._setupFog();

    if (envKey === RACE.TRACK_KEY) {
      this._createRaceVenue();
    } else {
      this._createRunway();
      if (envKey === 'mountains') this._createAlpineOutpost();
    }

    if (envKey === 'city') {
      this._createRoadGrid();
      this._createCityBuildings();
    } else {
      if (envKey !== RACE.TRACK_KEY) this._createForestClusters();
      if (envKey === 'desert') {
        this._createDesertOases();
      }
    }
  }

  loadChallengeRings(envKey) {
    this._clearRings();
    const positions = CHALLENGE.COURSES[envKey];
    if (!positions) return;

    const ringGeo = new THREE.TorusGeometry(CHALLENGE.RING_RADIUS, CHALLENGE.RING_TUBE, 16, 40);

    positions.forEach((rp, i) => {
      const isActive = i === 0;
      const color = isActive ? CHALLENGE.RING_ACTIVE_COLOR : CHALLENGE.RING_COLOR;

      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.68,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringGeo.clone(), mat);
      ring.position.set(rp.x, rp.y, rp.z);
      ring.rotation.y = Math.PI / 2;
      this.scene.add(ring);

      const glow = new THREE.Mesh(
        new THREE.TorusGeometry(CHALLENGE.RING_RADIUS + 3.5, CHALLENGE.RING_TUBE * 0.45, 12, 28),
        new THREE.MeshBasicMaterial({
          color,
          wireframe: true,
          transparent: true,
          opacity: 0.22,
        })
      );
      glow.position.copy(ring.position);
      glow.rotation.copy(ring.rotation);
      this.scene.add(glow);

      this.rings.push({
        mesh: ring,
        glow,
        passed: false,
        position: new THREE.Vector3(rp.x, rp.y, rp.z),
      });
    });
  }

  markRingPassed(index) {
    if (index >= this.rings.length) return;
    const ring = this.rings[index];
    ring.passed = true;
    ring.mesh.material.color.setHex(CHALLENGE.RING_PASSED_COLOR);
    ring.mesh.material.opacity = 0.15;
    ring.glow.material.opacity = 0;

    if (index + 1 < this.rings.length) {
      const next = this.rings[index + 1];
      next.mesh.material.color.setHex(CHALLENGE.RING_ACTIVE_COLOR);
      next.glow.material.color.setHex(CHALLENGE.RING_ACTIVE_COLOR);
      next.glow.material.opacity = 0.34;
    }
  }

  getTerrainHeight(x, z) {
    if (!this.envConfig) return 0;
    const key = `${Math.round(x / this._cacheRes) * this._cacheRes},${Math.round(z / this._cacheRes) * this._cacheRes}`;
    if (this._heightCache.has(key)) return this._heightCache.get(key);

    let h = this._sampleRawTerrainHeight(x, z);
    const airportLandBlend = this._getAirportLandBlend(x, z);
    if (airportLandBlend > 0) {
      const plateauNoise = this.noise.fbm(x * 0.0018 + 24.4, z * 0.0018 - 18.1, 3, 2.0, 0.5) * 14;
      const duneNoise = this.noise.get(x * 0.0046 - 9.3, z * 0.0046 + 3.7) * 6;
      const islandLift = Math.pow(airportLandBlend, 1.25) * (this.envKey === 'coastal' ? 58 : 28);
      const landTarget = Math.max(
        this._getRunwayBaseHeight() - 8 + plateauNoise + duneNoise + islandLift,
        (this.envConfig.waterLevel ?? -200) + 8 + airportLandBlend * 24
      );
      h = Math.max(h, landTarget);
    }
    const coastalPatchHeight = this._getCoastalPatchHeight(x, z);
    if (coastalPatchHeight !== null) {
      h = Math.max(h, coastalPatchHeight);
    }
    const runwaySafetyBlend = this._getRunwaySafetyBlend(x, z);
    if (runwaySafetyBlend > 0) {
      h = THREE.MathUtils.lerp(h, this._getRunwayBaseHeight(), runwaySafetyBlend);
    }
    const airportBlend = this._getAirportBlend(x, z);
    if (airportBlend > 0) {
      h = THREE.MathUtils.lerp(h, this._getRunwayBaseHeight(), airportBlend);
    }

    this._heightCache.set(key, h);
    return h;
  }

  getSurfaceHeight(x, z) {
    const meshHeight = this._sampleTerrainMeshHeight(x, z);
    const baseHeight = this.getTerrainHeight(x, z);
    let height = meshHeight ?? baseHeight;
    for (const zone of this.surfaceZones) {
      if (x < zone.minX || x > zone.maxX || z < zone.minZ || z > zone.maxZ) continue;
      const zoneHeight = typeof zone.sampleHeight === 'function'
        ? zone.sampleHeight(x, z)
        : baseHeight + (zone.yOffset ?? 0);
      if (Number.isFinite(zoneHeight)) {
        height = Math.max(height, zoneHeight);
      }
    }
    return height;
  }

  _sampleSurfaceZoneHeight(zone, x, z) {
    const positions = zone.positions;
    if (!positions) return null;

    const halfWidth = zone.width * 0.5;
    const halfDepth = zone.depth * 0.5;
    const u = (x - zone.centerX + halfWidth) / zone.width;
    const v = (z - zone.centerZ + halfDepth) / zone.depth;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;

    const columns = zone.segmentsX + 1;
    const gx = THREE.MathUtils.clamp(u * zone.segmentsX, 0, zone.segmentsX);
    const gz = THREE.MathUtils.clamp(v * zone.segmentsZ, 0, zone.segmentsZ);
    const ix = Math.min(zone.segmentsX - 1, Math.floor(gx));
    const iz = Math.min(zone.segmentsZ - 1, Math.floor(gz));
    const tx = gx - ix;
    const tz = gz - iz;
    const indexOf = (col, row) => row * columns + col;
    const y00 = positions.getY(indexOf(ix, iz));
    const y10 = positions.getY(indexOf(ix + 1, iz));
    const y01 = positions.getY(indexOf(ix, iz + 1));
    const y11 = positions.getY(indexOf(ix + 1, iz + 1));
    const ya = THREE.MathUtils.lerp(y00, y10, tx);
    const yb = THREE.MathUtils.lerp(y01, y11, tx);
    return THREE.MathUtils.lerp(ya, yb, tz);
  }

  getPreferredLandingDirection(referencePosition = null, target = this.runwayCenter) {
    const direction = this.runwayDirection.clone().normalize();
    if (!referencePosition || !target) return direction;
    const delta = referencePosition.clone().sub(target).setY(0);
    if (delta.lengthSq() < 0.0001) return direction;
    if (delta.dot(direction) > 0) direction.multiplyScalar(-1);
    return direction;
  }

  getSpawnTransform(mode = 'free_fly', slot = 0) {
    if (mode.startsWith('race_') || this.envKey === 'air_race') {
      const start = RACE.START_POSITIONS[Math.min(slot, RACE.START_POSITIONS.length - 1)] ?? RACE.START_POSITIONS[0];
      const gate = CHALLENGE.COURSES.air_race[0];
      const position = new THREE.Vector3(start.x, 0, start.z);
      position.y = Math.max(start.y + 3.2, this.getSurfaceHeight(position.x, position.z) + 3.2);
      const lookTarget = new THREE.Vector3(gate.x, Math.max(gate.y, this.getSurfaceHeight(gate.x, gate.z) + 22), gate.z);
      const quaternion = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().lookAt(position, lookTarget, new THREE.Vector3(0, 1, 0))
      );
      return { position, quaternion, speed: 0, throttle: 0 };
    }

    const lateralOffset = slot * 10;
    const position = new THREE.Vector3(lateralOffset, 0, 320);
    position.y = this.getSurfaceHeight(position.x, position.z) + 3.2;
    const forward = this.runwayDirection.clone().normalize();
    const lookTarget = position.clone().add(forward.multiplyScalar(80));
    lookTarget.y = position.y + 2;
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(position, lookTarget, new THREE.Vector3(0, 1, 0))
    );
    return { position, quaternion, speed: 0, throttle: 0 };
  }

  getRaceGuideTarget(position) {
    if (this.envKey !== 'air_race' || !position) return null;
    const state = this.getRaceTrackState(position);
    return this.getRaceGuideTargetByIndex(state?.nextGateIndex ?? 0);
  }

  getRaceGuideTargetByIndex(index = 0) {
    const course = CHALLENGE.COURSES.air_race;
    const point = course[((index % course.length) + course.length) % course.length];
    return point ? new THREE.Vector3(point.x, point.y, point.z) : null;
  }

  getRaceTrackState(position) {
    if (!position) return null;

    const course = CHALLENGE.COURSES.air_race;
    const horizontalPoint = this._guideSample.set(position.x, 0, position.z);
    let best = null;

    for (let i = 0; i < course.length; i++) {
      const start = course[i];
      const end = course[(i + 1) % course.length];
      this._guideDirection.set(end.x - start.x, 0, end.z - start.z);
      const lengthSq = Math.max(this._guideDirection.lengthSq(), 1);
      const t = THREE.MathUtils.clamp(
        ((horizontalPoint.x - start.x) * this._guideDirection.x + (horizontalPoint.z - start.z) * this._guideDirection.z) / lengthSq,
        0,
        1
      );
      const closestX = THREE.MathUtils.lerp(start.x, end.x, t);
      const closestZ = THREE.MathUtils.lerp(start.z, end.z, t);
      const closestY = THREE.MathUtils.lerp(start.y, end.y, t);
      const lateralDistance = Math.hypot(position.x - closestX, position.z - closestZ);
      const verticalDistance = Math.abs(position.y - closestY);
      const score = lateralDistance + verticalDistance * 0.22;

      if (!best || score < best.score) {
        const direction = new THREE.Vector3(end.x - start.x, end.y - start.y, end.z - start.z).normalize();
        best = {
          segmentIndex: i,
          nextGateIndex: (i + 1) % course.length,
          fraction: t,
          progress: i + t,
          closestPoint: new THREE.Vector3(closestX, closestY, closestZ),
          direction,
          lateralDistance,
          verticalDistance,
          score,
        };
      }
    }

    if (!best) return null;

    const inStartBox =
      position.x >= -560 && position.x <= 560 &&
      position.z >= 2240 && position.z <= 2760 &&
      position.y >= 420 && position.y <= 780;

    const inside = inStartBox || (
      best.lateralDistance <= 520 &&
      best.verticalDistance <= 250
    );

    return {
      ...best,
      inside,
    };
  }

  _sampleFootprintStats(centerX, centerZ, halfWidth, halfDepth) {
    const samples = [
      [0, 0],
      [halfWidth, 0],
      [-halfWidth, 0],
      [0, halfDepth],
      [0, -halfDepth],
      [halfWidth, halfDepth],
      [halfWidth, -halfDepth],
      [-halfWidth, halfDepth],
      [-halfWidth, -halfDepth],
    ];
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    samples.forEach(([dx, dz]) => {
      const y = this.getSurfaceHeight(centerX + dx, centerZ + dz);
      min = Math.min(min, y);
      max = Math.max(max, y);
      sum += y;
    });
    return {
      min,
      max,
      avg: sum / samples.length,
    };
  }

  _sampleTerrainMeshHeight(x, z) {
    const geometry = this.terrain?.geometry;
    const positions = geometry?.attributes?.position;
    if (!positions || !this.terrain) return null;

    const half = RENDER.TERRAIN_SIZE * 0.5;
    const u = (x + half) / RENDER.TERRAIN_SIZE;
    const v = (z + half) / RENDER.TERRAIN_SIZE;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;

    const segments = RENDER.TERRAIN_SEGMENTS;
    const columns = segments + 1;
    const gx = THREE.MathUtils.clamp(u * segments, 0, segments);
    const gz = THREE.MathUtils.clamp(v * segments, 0, segments);
    const ix = Math.min(segments - 1, Math.floor(gx));
    const iz = Math.min(segments - 1, Math.floor(gz));
    const tx = gx - ix;
    const tz = gz - iz;
    const indexOf = (col, row) => row * columns + col;
    const y00 = positions.getY(indexOf(ix, iz));
    const y10 = positions.getY(indexOf(ix + 1, iz));
    const y01 = positions.getY(indexOf(ix, iz + 1));
    const y11 = positions.getY(indexOf(ix + 1, iz + 1));
    const ya = THREE.MathUtils.lerp(y00, y10, tx);
    const yb = THREE.MathUtils.lerp(y01, y11, tx);
    return THREE.MathUtils.lerp(ya, yb, tz) + this.terrain.position.y;
  }

  _getTerrainStyle() {
    const styles = {
      mountains: { base: 0.34, plains: 0.18, hills: 1.16, ridges: 1.84, mountains: 2.88, valleys: 0.28, flatlands: 0.02, warpAmount: 1760 },
      desert: { base: 0.18, plains: 0.22, hills: 0.42, ridges: 0.68, mountains: 0.88, valleys: 0.08, flatlands: 0.24, warpAmount: 980 },
      coastal: { base: 0.22, plains: 0.16, hills: 0.56, ridges: 0.82, mountains: 1.16, valleys: 0.28, flatlands: 0.12, warpAmount: 1240 },
      city: { base: 0.08, plains: 0.08, hills: 0.12, ridges: 0.16, mountains: 0.18, valleys: 0.04, flatlands: 0.78, warpAmount: 520 },
      canyon: { base: 0.18, plains: 0.05, hills: 0.34, ridges: 1.9, mountains: 2.28, valleys: 0.78, flatlands: 0.01, warpAmount: 1280 },
      air_race: { base: 0.02, plains: 0.02, hills: 0.06, ridges: 0.12, mountains: 0.18, valleys: 0.04, flatlands: 0.94, warpAmount: 480 },
    };
    return styles[this.envKey] ?? styles.mountains;
  }

  _getCoastalPatchHeight(x, z) {
    if (this.envKey !== 'coastal') return null;
    const waterLevel = this.envConfig?.waterLevel ?? 20;
    const patches = [
      { x: 1320, z: -760, rx: 340, rz: 250, lift: 20 },
      { x: -1460, z: 420, rx: 290, rz: 210, lift: 16 },
      { x: 860, z: 1320, rx: 250, rz: 180, lift: 14 },
      { x: -520, z: -1520, rx: 220, rz: 160, lift: 12 },
      { x: 2380, z: 1820, rx: 420, rz: 280, lift: 18 },
      { x: -2640, z: -2140, rx: 380, rz: 260, lift: 17 },
      { x: 3120, z: -1180, rx: 240, rz: 160, lift: 10 },
      { x: -3180, z: 980, rx: 210, rz: 150, lift: 9 },
    ];
    let best = -Infinity;

    patches.forEach((patch, index) => {
      const dx = (x - patch.x) / patch.rx;
      const dz = (z - patch.z) / patch.rz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const blend = 1 - THREE.MathUtils.smoothstep(dist, 0.54, 1.04);
      if (blend <= 0) return;

      const plateau = Math.pow(blend, 1.45);
      const localNoise = this.noise.fbm(
        x * 0.0014 + index * 8.2,
        z * 0.0014 - index * 5.6,
        3,
        2.0,
        0.48
      ) * 3.2;
      const patchHeight = waterLevel + 5 + patch.lift * plateau + localNoise;
      best = Math.max(best, patchHeight);
    });

    return Number.isFinite(best) ? best : null;
  }

  _terrainModeForEnvironment() {
    switch (this.envKey) {
      case 'mountains': return 5;
      case 'desert': return 1;
      case 'coastal': return 2;
      case 'city': return 3;
      case 'canyon': return 4;
      default: return 0;
    }
  }

  _themeTerrainTextures(baseSets) {
    const extras = {
      snow: baseSets.snow ?? this._terrainTextureSet.snow,
      sand: baseSets.sand ?? this._terrainTextureSet.sand,
      gravel: baseSets.gravel ?? this._terrainTextureSet.gravel,
      asphalt: baseSets.asphalt ?? this._terrainTextureSet.asphalt,
      water: baseSets.water ?? this._terrainTextureSet.water,
    };

    if (this.envKey === 'desert') {
      return {
        grass: extras.sand,
        dirt: extras.sand,
        rock: baseSets.rock,
        ...extras,
      };
    }
    if (this.envKey === 'canyon') {
      return {
        grass: extras.sand,
        dirt: baseSets.dirt,
        rock: baseSets.rock,
        ...extras,
      };
    }
    if (this.envKey === 'mountains') {
      return {
        grass: baseSets.grass,
        dirt: extras.gravel,
        rock: baseSets.rock,
        ...extras,
      };
    }
    if (this.envKey === 'coastal') {
      return {
        grass: baseSets.grass,
        dirt: extras.sand,
        rock: baseSets.rock,
        ...extras,
      };
    }
    if (this.envKey === 'city') {
      return {
        grass: baseSets.grass,
        dirt: extras.gravel,
        rock: extras.asphalt,
        ...extras,
      };
    }
    return { ...baseSets, ...extras };
  }

  _sampleRidgedNoise(x, z, scale, power = 2.6) {
    const ridge = 1 - Math.abs(this.noise.get(x * scale, z * scale));
    return Math.pow(Math.max(0, ridge), power);
  }

  _samplePeak(x, z, centerX, centerZ, radiusX, radiusZ, height) {
    const dx = (x - centerX) / radiusX;
    const dz = (z - centerZ) / radiusZ;
    const distSq = dx * dx + dz * dz;
    if (distSq >= 2.2) return 0;
    return Math.exp(-distSq * 2.4) * height;
  }

  _sampleRawTerrainHeight(x, z) {
    const env = this.envConfig;
    const style = this._getTerrainStyle();
    const warpScale = 0.00018;
    const warpX = x
      + this.noise.fbm(x * warpScale + 14.3, z * warpScale - 8.7, 3, 2.0, 0.5) * style.warpAmount
      + this.noise.get(x * warpScale * 2.2 - 5.8, z * warpScale * 2.2 + 9.1) * style.warpAmount * 0.35;
    const warpZ = z
      + this.noise.fbm(x * warpScale - 11.6, z * warpScale + 16.9, 3, 2.0, 0.5) * style.warpAmount
      + this.noise.get(x * warpScale * 2.0 + 12.4, z * warpScale * 2.0 - 3.2) * style.warpAmount * 0.35;

    const nx = warpX * env.frequency;
    const nz = warpZ * env.frequency;
    const continental = this.noise.fbm(nx * 0.32, nz * 0.32, 4, 2.0, 0.52);
    const plains = this.noise.fbm(nx * 0.92 + 7.2, nz * 0.92 - 13.5, 4, 2.0, 0.5) * env.amplitude * style.plains;
    const hills = this.noise.fbm(nx * 1.9 - 11.4, nz * 1.9 + 5.7, 5, 2.05, 0.52) * env.amplitude * style.hills;
    const ridgeMask = THREE.MathUtils.smoothstep(continental, -0.08, 0.42);
    const ridges = this._sampleRidgedNoise(warpX - 430, warpZ + 280, env.frequency * 2.35, 2.7) * env.amplitude * style.ridges;
    const mountainSpines = this._sampleRidgedNoise(warpX + 960, warpZ - 1280, env.frequency * 3.8, 3.15) * env.amplitude * style.mountains;
    const valleys = this._sampleRidgedNoise(warpX - 1800, warpZ + 600, env.frequency * 1.35, 4.2) * env.amplitude * style.valleys;
    const terraceNoise = this.noise.fbm(x * 0.00042 + 8.1, z * 0.00042 - 2.6, 3, 2.0, 0.48) * env.amplitude * 0.08;
    const flatMask = 1 - THREE.MathUtils.smoothstep(0.18, 0.78, ridgeMask + Math.abs(this.noise.get(nx * 1.4, nz * 1.4)) * 0.55);

    let h =
      continental * env.amplitude * style.base +
      plains +
      hills * (0.34 + ridgeMask * 0.74) +
      ridges * ridgeMask +
      mountainSpines * ridgeMask * 0.82 +
      terraceNoise;

    h -= valleys * (0.38 + (1 - ridgeMask) * 0.34);
    h = THREE.MathUtils.lerp(
      h,
      continental * env.amplitude * 0.14 + plains * 0.68 + terraceNoise * 0.4,
      flatMask * style.flatlands
    );
    h += this.noise.get(x * 0.0032 - 7.1, z * 0.0032 + 4.4) * 20;
    h += this.noise.get(x * 0.011, z * 0.011) * 5.5;

    if (this.envKey === 'mountains') {
      const clusteredPeaks =
        this._samplePeak(x, z, -10400, -5400, 3600, 2400, 660) +
        this._samplePeak(x, z, -8200, -6100, 3200, 2200, 720) +
        this._samplePeak(x, z, -5600, -5200, 3000, 2100, 560) +
        this._samplePeak(x, z, 5400, 4600, 3200, 2300, 620) +
        this._samplePeak(x, z, 8400, 6200, 3600, 2600, 760) +
        this._samplePeak(x, z, 10800, 5600, 3000, 2200, 540);
      const scatteredPeaks =
        this._samplePeak(x, z, -1600, 8200, 2200, 1900, 420) +
        this._samplePeak(x, z, 2600, -9200, 2400, 1800, 470) +
        this._samplePeak(x, z, 6800, -2600, 1800, 1600, 340) +
        this._samplePeak(x, z, -7200, 2600, 2000, 1700, 380);
      const basinCenterX = 8600;
      const basinCenterZ = -7600;
      const basinDistance = Math.hypot(x - basinCenterX, z - basinCenterZ);
      const ringPeak = Math.exp(-Math.pow((basinDistance - 2650) / 760, 2));
      const innerBasin = 1 - THREE.MathUtils.smoothstep(basinDistance, 860, 1680);
      const basinFloor = 238 + this.noise.fbm(x * 0.0016 + 9.8, z * 0.0016 - 4.3, 3, 2.0, 0.5) * 16;
      h += clusteredPeaks + scatteredPeaks + ringPeak * env.amplitude * 1.28;
      h = THREE.MathUtils.lerp(h, basinFloor, innerBasin * 0.9);
    } else if (this.envKey === 'desert') {
      const dunes = this.noise.fbm(x * 0.00135 + 14.4, z * 0.00135 - 6.2, 5, 2.28, 0.56) * env.amplitude * 0.28;
      const duneRipples = Math.sin(x * 0.0032 + this.noise.get(z * 0.0009, x * 0.0009) * 2.2) * 12;
      const mesas = this._sampleRidgedNoise(x + 3000, z - 2400, 0.00095, 3.8) * env.amplitude * 0.3;
      const basins = this._sampleRidgedNoise(x - 1800, z + 1200, 0.00082, 4.5) * env.amplitude * 0.12;
      h = THREE.MathUtils.lerp(h + dunes + duneRipples, h + mesas, 0.42);
      h -= basins;
    } else if (this.envKey === 'coastal') {
      const coastDist = Math.sqrt((x / 18000) ** 2 + (z / 18000) ** 2);
      const islandMask = 1 - THREE.MathUtils.smoothstep(coastDist, 0.28, 1.08);
      const archipelago = this.noise.fbm(x * 0.00078 + 21.2, z * 0.00078 - 8.6, 4, 2.1, 0.52) * 0.5 + 0.5;
      const reefNoise = this.noise.fbm(x * 0.00128 - 16.2, z * 0.00128 + 8.4, 4, 2.05, 0.52) * 0.5 + 0.5;
      const lagoonCuts = Math.max(0, reefNoise - 0.56) * 44;
      const shelf = Math.pow(Math.max(0, islandMask * 0.92 + archipelago * 0.52 - 0.34), 1.4) * env.amplitude * 0.76;
      const mainlandDist = Math.sqrt((x / 22000) ** 2 + (z / 22000) ** 2);
      const mainlandMask = 1 - THREE.MathUtils.smoothstep(mainlandDist + this.noise.get(x * 0.00024, z * 0.00024) * 0.16, 0.38, 1.02);
      const mainland = mainlandMask * env.amplitude * 0.44 + archipelago * env.amplitude * 0.08;
      const beachShelf = Math.max(0, islandMask * 0.64 + archipelago * 0.34 - 0.4) * 14;
      const oceanMask = THREE.MathUtils.smoothstep(coastDist + this.noise.get(x * 0.00032 - 4.2, z * 0.00032 + 2.8) * 0.2, 0.24, 0.7);
      h = Math.max(h * 0.18, shelf - 38 - lagoonCuts, mainland - 36, beachShelf + (env.waterLevel ?? 0) + 2);
      h = THREE.MathUtils.lerp(h, (env.waterLevel ?? 0) - 52, oceanMask * 0.985);
    } else if (this.envKey === 'city') {
      const metroDist = Math.sqrt((x / 9200) ** 2 + (z / 9200) ** 2);
      const metroFlat = 1 - THREE.MathUtils.smoothstep(metroDist, 0.16, 0.92);
      h = THREE.MathUtils.lerp(h, continental * env.amplitude * 0.08 + plains * 0.42, metroFlat * 0.72);
      h += this.noise.fbm(x * 0.001, z * 0.001, 3, 2.0, 0.45) * 10;
    } else if (this.envKey === 'canyon') {
      const canyonCurve = Math.sin((z + 420) * 0.00022) * 1100
        + this.noise.get(z * 0.00038 + 7.6, x * 0.00018 - 4.2) * 140;
      const canyonWidth = 220
        + (this.noise.get(x * 0.00042 + 3.8, z * 0.00042 - 2.2) * 0.5 + 0.5) * 120;
      const distanceToCorridor = Math.abs(x - canyonCurve);
      const corridorMask = 1 - THREE.MathUtils.smoothstep(distanceToCorridor, canyonWidth * 0.52, canyonWidth + 8);
      const wallRise = THREE.MathUtils.smoothstep(distanceToCorridor, canyonWidth * 0.72, canyonWidth + 260);
      const outerWall = THREE.MathUtils.smoothstep(distanceToCorridor, canyonWidth + 60, canyonWidth + 420);
      const canyonFloor = 92 + this.noise.fbm(x * 0.0018, z * 0.0018, 3, 2.0, 0.5) * 16;
      const wallMass = wallRise * env.amplitude * 0.64 + outerWall * env.amplitude * 0.62;
      h = Math.max(h + wallMass, canyonFloor + wallRise * 58);
      h = THREE.MathUtils.lerp(h, canyonFloor, corridorMask * 0.96);
      h += this._sampleRidgedNoise(x - 2400, z + 800, 0.00062, 3.5) * env.amplitude * 0.34;
    } else if (this.envKey === 'air_race') {
      const trackDistance = this._distanceToCourse(CHALLENGE.COURSES.air_race, x, z);
      const trackMask = 1 - THREE.MathUtils.smoothstep(trackDistance, 240, 980);
      const abyss = -920 + this.noise.fbm(x * 0.0014, z * 0.0014, 3, 2.0, 0.48) * 18;
      h = THREE.MathUtils.lerp(h, abyss, 0.96);
      h += trackMask * 34;
    }

    return h;
  }

  _getAirportBlend(x, z, pad = 0) {
    const mainX = 1 - THREE.MathUtils.smoothstep(Math.abs(x), 120 + pad, 320 + pad);
    const mainZ = 1 - THREE.MathUtils.smoothstep(Math.abs(z + 200), 700 + pad, 940 + pad);
    const mainStrip = mainX * mainZ;

    const apronX = 1 - THREE.MathUtils.smoothstep(Math.abs(x + 145), 112 + pad, 205 + pad);
    const apronZ = 1 - THREE.MathUtils.smoothstep(Math.abs(z + 95), 92 + pad, 190 + pad);
    const apron = apronX * apronZ;

    const taxiX = 1 - THREE.MathUtils.smoothstep(Math.abs(x + 33), 22 + pad, 72 + pad);
    const taxiZ = 1 - THREE.MathUtils.smoothstep(Math.abs(z + 160), 130 + pad, 320 + pad);
    const taxi = taxiX * taxiZ;

    const serviceX = 1 - THREE.MathUtils.smoothstep(Math.abs(x + 214), 35 + pad, 96 + pad);
    const serviceZ = 1 - THREE.MathUtils.smoothstep(Math.abs(z + 90), 145 + pad, 260 + pad);
    const service = serviceX * serviceZ;
    const terminalX = 1 - THREE.MathUtils.smoothstep(Math.abs(x + 142), 54 + pad, 118 + pad);
    const terminalZ = 1 - THREE.MathUtils.smoothstep(Math.abs(z - 22), 26 + pad, 70 + pad);
    const terminal = terminalX * terminalZ;
    const hangarX = 1 - THREE.MathUtils.smoothstep(Math.abs(x + 206), 44 + pad, 120 + pad);
    const hangarZ = 1 - THREE.MathUtils.smoothstep(Math.abs(z + 104), 190 + pad, 260 + pad);
    const hangars = hangarX * hangarZ;
    const towerX = 1 - THREE.MathUtils.smoothstep(Math.abs(x + 92), 18 + pad, 44 + pad);
    const towerZ = 1 - THREE.MathUtils.smoothstep(Math.abs(z - 32), 18 + pad, 42 + pad);
    const tower = towerX * towerZ;

    return Math.max(mainStrip, apron * 0.94, taxi * 0.72, service * 0.68, terminal * 0.74, hangars * 0.7, tower * 0.66);
  }

  _getRunwaySafetyBlend(x, z, pad = 0) {
    const stripX = 1 - THREE.MathUtils.smoothstep(Math.abs(x), 178 + pad, 380 + pad);
    const stripZ = 1 - THREE.MathUtils.smoothstep(Math.abs(z + 200), 840 + pad, 1320 + pad);
    const shoulders = stripX * stripZ;

    const apronX = 1 - THREE.MathUtils.smoothstep(Math.abs(x + 130), 170 + pad, 300 + pad);
    const apronZ = 1 - THREE.MathUtils.smoothstep(Math.abs(z + 95), 132 + pad, 320 + pad);
    const apron = apronX * apronZ;

    const taxiX = 1 - THREE.MathUtils.smoothstep(Math.abs(x + 33), 42 + pad, 104 + pad);
    const taxiZ = 1 - THREE.MathUtils.smoothstep(Math.abs(z + 160), 180 + pad, 390 + pad);
    const taxi = taxiX * taxiZ;

    return Math.max(shoulders, apron * 0.8, taxi * 0.7);
  }

  _isAirportZone(x, z, pad = 0) {
    return this._getAirportBlend(x, z, pad) > 0.14;
  }

  _distanceToCourse(points, x, z) {
    let minDistance = Infinity;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const lenSq = Math.max(1, abx * abx + abz * abz);
      const t = THREE.MathUtils.clamp(((x - a.x) * abx + (z - a.z) * abz) / lenSq, 0, 1);
      const px = a.x + abx * t;
      const pz = a.z + abz * t;
      minDistance = Math.min(minDistance, Math.hypot(x - px, z - pz));
    }
    return minDistance;
  }

  _isRaceTrackZone(x, z, pad = 0) {
    if (this.envKey !== RACE.TRACK_KEY) return false;
    return this._distanceToCourse(CHALLENGE.COURSES.air_race, x, z) < 220 + pad;
  }

  _getAirportLandBlend(x, z) {
    const dx = x / 940;
    const dz = (z + 200) / 1480;
    const dist = Math.sqrt(dx * dx + dz * dz);
    return 1 - THREE.MathUtils.smoothstep(dist, 0.22, 1.0);
  }

  _getRunwayBaseHeight() {
    if (!this.envConfig) return 0;
    if (!this._runwayBaseHeight) {
      const rawBase = this._sampleRawTerrainHeight(0, -200);
      this._runwayBaseHeight = Math.max(rawBase, (this.envConfig.waterLevel ?? -200) + 7, 6);
    }
    return this._runwayBaseHeight;
  }

  update(flightState, dt) {
    const position = flightState?.position;
    if (!position) return;
    const quaternion = flightState?.quaternion;

    if (this.clouds) {
      this.clouds.position.x = position.x;
      this.clouds.position.z = position.z;
      this.clouds.children.forEach((bank, bankIndex) => {
        bank.position.x += dt * bank.userData.wind.x;
        bank.position.z += dt * bank.userData.wind.z;
        bank.position.y = bank.userData.baseAltitude + Math.sin(performance.now() * 0.00025 + bank.userData.bobPhase) * 18;

        const wrapDistance = RENDER.TERRAIN_SIZE * 0.42;
        if (bank.position.x > wrapDistance) bank.position.x = -wrapDistance;
        if (bank.position.x < -wrapDistance) bank.position.x = wrapDistance;
        if (bank.position.z > wrapDistance) bank.position.z = -wrapDistance;
        if (bank.position.z < -wrapDistance) bank.position.z = wrapDistance;

        bank.children.forEach((layer, layerIndex) => {
          layer.material.opacity = (bank.userData.upperLayer ? 0.1 : 0.14)
            + Math.sin(performance.now() * 0.0009 + layer.userData.driftOffset + layerIndex) * 0.04
            + layerIndex * 0.018;
          layer.rotation.z += dt * 0.01 * (bankIndex % 2 === 0 ? 1 : -1);
          const scalePulse = 1 + Math.sin(performance.now() * 0.00035 + layer.userData.driftOffset) * 0.035;
          layer.scale.setScalar(layer.userData.baseScale * scalePulse);
        });
      });
    }

    if (this.sun && this.envConfig) {
      const sp = this.envConfig.sunPosition;
      this.sun.position.set(position.x + sp.x, position.y + sp.y, position.z + sp.z);
      if (this.sunGlow) this.sunGlow.position.copy(this.sun.position);
      this.sunTarget.position.copy(position);
    }

    if (this.water?.material?.normalMap) {
      this.water.material.normalMap.offset.x += dt * 0.01;
      this.water.material.normalMap.offset.y += dt * 0.006;
    }

    if (this.landingPath && this.guidelineVisible && quaternion) {
      this._updateLandingLaser(position, quaternion);
    }

    this.rings.forEach(ring => {
      if (!ring.passed && ring.glow) {
        ring.glow.rotation.y += dt * 0.6;
        ring.glow.material.opacity = 0.24 + Math.sin(performance.now() * 0.003) * 0.08;
      }
    });
  }

  checkObstacleCollision(position, radius = 0, extents = null) {
    const airportSafe = this._isAirportZone(position.x, position.z, 260) && position.y < this.getSurfaceHeight(position.x, position.z) + 220;
    const raceSafe = this._isRaceTrackZone(position.x, position.z, 120) && position.y < this.getSurfaceHeight(position.x, position.z) + 260;
    for (const obstacle of this.obstacles) {
      if ((airportSafe || raceSafe) && !obstacle.alwaysCollide) continue;
      const delta = position.clone().sub(obstacle.center);
      const padX = extents?.x ?? radius;
      const padY = extents?.y ?? radius;
      const padZ = extents?.z ?? radius;
      let dx = delta.x;
      let dz = delta.z;
      if (typeof obstacle.rotY === 'number') {
        const cos = Math.cos(-obstacle.rotY);
        const sin = Math.sin(-obstacle.rotY);
        const localX = dx * cos - dz * sin;
        const localZ = dx * sin + dz * cos;
        dx = localX;
        dz = localZ;
      }
      if (
        Math.abs(dx) < obstacle.hx + padX &&
        Math.abs(delta.y) < obstacle.hy + padY &&
        Math.abs(dz) < obstacle.hz + padZ
      ) {
        return true;
      }
    }
    return false;
  }

  checkObstacleCollisionSweep(start, end, radius = 0, extents = null) {
    if (!start || !end) return false;
    const travel = start.distanceTo(end);
    const footprint = extents ? Math.max(2, Math.min(extents.x, extents.z)) : Math.max(2, radius || 2);
    const sampleStep = Math.max(1.25, Math.min(8, footprint * 0.3));
    const steps = Math.max(1, Math.ceil(travel / sampleStep));
    const probe = new THREE.Vector3();
    for (let i = 0; i <= steps; i++) {
      probe.lerpVectors(start, end, i / steps);
      if (this.checkObstacleCollision(probe, radius, extents)) return true;
    }
    return false;
  }

  checkRingPass(position, radius) {
    for (let i = 0; i < this.rings.length; i++) {
      const ring = this.rings[i];
      if (ring.passed) continue;
      if (i > 0 && !this.rings[i - 1].passed) continue;
      if (position.distanceTo(ring.position) < CHALLENGE.RING_RADIUS + radius) return i;
    }
    return -1;
  }

  _createSky() {
    const env = this.envConfig;
    this._environmentTexture?.dispose?.();
    this._environmentTexture = makeSkyBackdropTexture({
      ...env,
      skyTopColor: new THREE.Color(env.skyTopColor).lerp(new THREE.Color(0xffffff), 0.08).getHex(),
      skyBottomColor: new THREE.Color(env.skyBottomColor).lerp(new THREE.Color(0xffffff), 0.06).getHex(),
      fogColor: new THREE.Color(env.fogColor).lerp(new THREE.Color(0xffffff), 0.04).getHex(),
    });
    this._environmentTexture.mapping = THREE.EquirectangularReflectionMapping;
    this.scene.environment = this._environmentTexture;
    this.scene.background = this._environmentTexture;
    this._backgroundTexture?.dispose?.();
    this._backgroundTexture = null;
    if (this.water?.material) this.water.material.needsUpdate = true;
  }

  _createLighting() {
    const env = this.envConfig;
    const sp = env.sunPosition;

    this.sun = new THREE.DirectionalLight(env.sunColor, env.sunIntensity * 1.08);
    this.sun.position.set(sp.x, sp.y, sp.z);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(RENDER.SHADOW_MAP_SIZE, RENDER.SHADOW_MAP_SIZE);
    Object.assign(this.sun.shadow.camera, {
      near: 50,
      far: 4000,
      left: -800,
      right: 800,
      top: 800,
      bottom: -800,
    });
    this.sun.shadow.bias = -0.0007;

    this.sunTarget = new THREE.Object3D();
    this.sun.target = this.sunTarget;
    this.scene.add(this.sun, this.sunTarget);

    this.hemisphereLight = new THREE.HemisphereLight(env.skyTopColor, 0x75695c, env.ambientIntensity * 1.3);
    this.scene.add(this.hemisphereLight);

    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.32);
    this.scene.add(this.ambientLight);

    const glowMaterial = new THREE.SpriteMaterial({
      map: this._sunGlowTexture,
      color: env.sunColor,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      depthTest: false,
    });
    this.sunGlow = new THREE.Sprite(glowMaterial);
    this.sunGlow.position.copy(this.sun.position);
    this.sunGlow.scale.setScalar(240);
    this.scene.add(this.sunGlow);

  }

  _createTerrain() {
    const env = this.envConfig;
    const geo = new THREE.PlaneGeometry(RENDER.TERRAIN_SIZE, RENDER.TERRAIN_SIZE, RENDER.TERRAIN_SEGMENTS, RENDER.TERRAIN_SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    this._satelliteTexture?.dispose?.();
    this._satelliteTexture = makeSatelliteTexture(this.noise, env);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const tint = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const height = this.getTerrainHeight(x, z);
      pos.setY(i, height);
      const slopeX = Math.abs(this.getTerrainHeight(x + 90, z) - this.getTerrainHeight(x - 90, z));
      const slopeZ = Math.abs(this.getTerrainHeight(x, z + 90) - this.getTerrainHeight(x, z - 90));
      const slope = THREE.MathUtils.clamp((slopeX + slopeZ) / 160, 0, 1);
      const nearWater = THREE.MathUtils.clamp(
        1 - ((height - (env.waterLevel ?? -200)) / Math.max(18, env.amplitude * 0.08)),
        0,
        1
      );
      const normalizedHeight = THREE.MathUtils.clamp(
        (height - (env.waterLevel ?? 0)) / Math.max(1, env.amplitude * 1.4),
        0,
        1
      );

      const macro = this.noise.get(x * 0.003, z * 0.003) * 0.1;
      const detail = this.noise.get(x * 0.02, z * 0.02) * 0.05;
      const patch = this.noise.get(x * 0.0012 + 41, z * 0.0012 - 13) * 0.06;
      tint.setRGB(
        THREE.MathUtils.clamp(env.baseColor[0] + macro + detail + patch, 0, 1),
        THREE.MathUtils.clamp(env.baseColor[1] + macro * 0.8 + patch * 0.6, 0, 1),
        THREE.MathUtils.clamp(env.baseColor[2] + detail * 0.9 - patch * 0.2, 0, 1)
      );
      if (this.envKey === 'desert') {
        tint.lerp(new THREE.Color(0.76, 0.64, 0.39), 0.7);
        tint.lerp(new THREE.Color(0.90, 0.82, 0.62), nearWater * 0.18);
        tint.lerp(new THREE.Color(0.61, 0.47, 0.30), slope * 0.28);
      } else if (this.envKey === 'mountains') {
        const alpineMeadow = new THREE.Color(0.35, 0.55, 0.28);
        const granite = new THREE.Color(0.57, 0.60, 0.62);
        const snow = new THREE.Color(0.97, 0.98, 1.0);
        tint.lerp(alpineMeadow, 0.46);
        tint.lerp(granite, THREE.MathUtils.smoothstep(normalizedHeight + slope * 0.2, 0.24, 0.68) * 0.76);
        tint.lerp(snow, THREE.MathUtils.smoothstep(normalizedHeight + slope * 0.28, 0.66, 0.94) * 0.96);
      } else if (this.envKey === 'coastal') {
        tint.lerp(new THREE.Color(0.26, 0.57, 0.31), 0.44);
        tint.lerp(new THREE.Color(0.86, 0.80, 0.58), nearWater * 0.62);
        tint.lerp(new THREE.Color(0.52, 0.55, 0.48), slope * 0.24);
      } else if (this.envKey === 'canyon') {
        tint.lerp(new THREE.Color(0.69, 0.42, 0.23), 0.5);
        tint.lerp(new THREE.Color(0.86, 0.62, 0.34), THREE.MathUtils.smoothstep(normalizedHeight, 0.18, 0.58) * 0.52);
        tint.lerp(new THREE.Color(0.52, 0.28, 0.15), slope * 0.38);
      } else if (this.envKey === 'city') {
        tint.lerp(new THREE.Color(0.36, 0.49, 0.33), 0.26);
        tint.lerp(new THREE.Color(0.42, 0.45, 0.44), THREE.MathUtils.smoothstep(Math.hypot(x, z), 2200, 7600) * 0.42);
      } else if (this.envKey === 'air_race') {
        tint.lerp(new THREE.Color(0.23, 0.27, 0.31), 0.82);
      }
      const neutral = this.envKey === 'desert'
        ? new THREE.Color(0.9, 0.84, 0.72)
        : this.envKey === 'mountains'
          ? new THREE.Color(0.84, 0.87, 0.86)
        : this.envKey === 'coastal'
          ? new THREE.Color(0.78, 0.9, 0.84)
          : this.envKey === 'city'
            ? new THREE.Color(0.74, 0.78, 0.8)
            : new THREE.Color(0.8, 0.88, 0.8);
      tint.lerp(neutral, this.envKey === 'city' ? 0.12 : this.envKey === 'mountains' ? 0.06 : 0.16);
      tint.multiplyScalar(this.envKey === 'city' ? 1.03 : this.envKey === 'mountains' ? 1.07 : 1.04);
      colors[i * 3] = tint.r;
      colors[i * 3 + 1] = tint.g;
      colors[i * 3 + 2] = tint.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const themedTextureSet = this._themeTerrainTextures(this._terrainTextureSet);
    const material = createLayeredTerrainMaterial(themedTextureSet, env, {
      satelliteMap: this._satelliteTexture,
      terrainMode: this._terrainModeForEnvironment(),
      waterLevel: env.waterLevel ?? -200,
    });
    material.vertexColors = true;

    this.terrain = new THREE.Mesh(geo, material);
    this.terrain.receiveShadow = true;
    this.terrain.castShadow = false;
    this.terrain.frustumCulled = false;
    this.scene.add(this.terrain);

    this.terrainUnderlay = this._createTerrainBody(geo, themedTextureSet, env);
    this.terrainUnderlay.frustumCulled = false;
    this.scene.add(this.terrainUnderlay);

    Promise.all([
      this.assets.loadTextureSet(ASSET_SOURCES.terrain.grass, 100),
      this.assets.loadTextureSet(ASSET_SOURCES.terrain.dirt, 100),
      this.assets.loadTextureSet(ASSET_SOURCES.terrain.rock, 100),
    ]).then(([grass, dirt, rock]) => {
      this._terrainTextureSet = this._themeTerrainTextures({
        grass,
        dirt,
        rock,
        snow: this._terrainTextureSet.snow,
        sand: this._terrainTextureSet.sand,
        gravel: this._terrainTextureSet.gravel,
        asphalt: this._terrainTextureSet.asphalt,
        water: this._terrainTextureSet.water,
      });
      this.terrain?.material?.userData?.updateTextures?.(this._terrainTextureSet);
      this.terrain.material.needsUpdate = true;
      if (this.terrainUnderlay?.material) {
        this.terrainUnderlay.material.map = this._terrainTextureSet.rock.color;
        this.terrainUnderlay.material.normalMap = this._terrainTextureSet.rock.normal;
        this.terrainUnderlay.material.roughnessMap = this._terrainTextureSet.rock.roughness;
        this.terrainUnderlay.material.needsUpdate = true;
      }
    });
  }

  _createTerrainBody(topGeometry, textureSet, env) {
    const positions = topGeometry.attributes.position;
    const uvs = topGeometry.attributes.uv;
    const topIndices = topGeometry.index.array;
    const columns = RENDER.TERRAIN_SEGMENTS + 1;
    const vertexIndex = (ix, iz) => iz * columns + ix;
    const perimeter = [];

    for (let ix = 0; ix <= RENDER.TERRAIN_SEGMENTS; ix++) perimeter.push(vertexIndex(ix, 0));
    for (let iz = 1; iz <= RENDER.TERRAIN_SEGMENTS; iz++) perimeter.push(vertexIndex(RENDER.TERRAIN_SEGMENTS, iz));
    for (let ix = RENDER.TERRAIN_SEGMENTS - 1; ix >= 0; ix--) perimeter.push(vertexIndex(ix, RENDER.TERRAIN_SEGMENTS));
    for (let iz = RENDER.TERRAIN_SEGMENTS - 1; iz > 0; iz--) perimeter.push(vertexIndex(0, iz));

    let minHeight = Infinity;
    for (let i = 0; i < positions.count; i++) minHeight = Math.min(minHeight, positions.getY(i));
    const floorY = Math.min((env.waterLevel ?? minHeight) - 180, minHeight - 360);

    const finalPositions = [];
    const finalUvs = [];
    const finalIndices = [];

    for (let i = 0; i < positions.count; i++) {
      finalPositions.push(positions.getX(i), positions.getY(i), positions.getZ(i));
      finalUvs.push(uvs.getX(i), uvs.getY(i));
    }

    const bottomOffset = positions.count;
    for (let i = 0; i < positions.count; i++) {
      finalPositions.push(positions.getX(i), floorY, positions.getZ(i));
      finalUvs.push(uvs.getX(i), uvs.getY(i));
    }

    for (let i = 0; i < topIndices.length; i += 3) {
      finalIndices.push(
        bottomOffset + topIndices[i],
        bottomOffset + topIndices[i + 2],
        bottomOffset + topIndices[i + 1]
      );
    }

    for (let i = 0; i < perimeter.length; i++) {
      const current = perimeter[i];
      const next = perimeter[(i + 1) % perimeter.length];
      const currentBottom = bottomOffset + current;
      const nextBottom = bottomOffset + next;
      finalIndices.push(current, next, nextBottom, current, nextBottom, currentBottom);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(finalPositions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(finalUvs, 2));
    geometry.setIndex(finalIndices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(...env.baseColor).multiplyScalar(0.82),
      roughness: 0.96,
      metalness: 0.02,
      envMapIntensity: 0.08,
    });
    material.map = textureSet.rock.color;
    material.normalMap = textureSet.rock.normal;
    material.roughnessMap = textureSet.rock.roughness;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    return mesh;
  }

  _createWater() {
    const env = this.envConfig;
    if (this.envKey !== 'coastal') return;
    if (env.waterLevel < -150) return;

    const geo = new THREE.PlaneGeometry(RENDER.TERRAIN_SIZE * 3.2, RENDER.TERRAIN_SIZE * 3.2, 24, 24);
    geo.rotateX(-Math.PI / 2);

    const mat = new THREE.MeshStandardMaterial({
      color: this.envConfig?.waterColor ?? 0x63cfe1,
      transparent: true,
      opacity: 0.86,
      roughness: 0.08,
      metalness: 0.18,
      envMapIntensity: 1.18,
      normalScale: new THREE.Vector2(0.32, 0.32),
    });
    mat.map = this._terrainTextureSet.water.color;
    mat.normalMap = this._terrainTextureSet.water.normal;
    mat.roughnessMap = this._terrainTextureSet.water.roughness;
    mat.emissive = new THREE.Color(0x0d4d65);
    mat.emissiveIntensity = 0.06;

    this.water = new THREE.Mesh(geo, mat);
    this.water.position.y = env.waterLevel + 2.0;
    this.water.receiveShadow = true;
    this.scene.add(this.water);
  }

  _createClouds() {
    const cloudGroup = new THREE.Group();
    const bankCount = this.envKey === 'city' ? 14 : 12;

    for (let i = 0; i < bankCount; i++) {
      const bank = new THREE.Group();
      const upperLayer = i % 3 === 0;
      const altitude = upperLayer ? 1500 + Math.random() * 520 : 850 + Math.random() * 620;
      const span = upperLayer ? 340 + Math.random() * 260 : 240 + Math.random() * 220;
      bank.position.set(
        (Math.random() - 0.5) * RENDER.TERRAIN_SIZE * 0.75,
        altitude,
        (Math.random() - 0.5) * RENDER.TERRAIN_SIZE * 0.75
      );
      bank.userData.baseAltitude = altitude;
      bank.userData.wind = new THREE.Vector3((upperLayer ? 16 : 10) + Math.random() * 14, 0, 4 + Math.random() * 10);
      bank.userData.bobPhase = Math.random() * Math.PI * 2;
      bank.userData.span = span;
      bank.userData.upperLayer = upperLayer;

      const layerCount = 4 + Math.floor(Math.random() * 3);
      for (let layerIndex = 0; layerIndex < layerCount; layerIndex++) {
        const plane = new THREE.Mesh(
          new THREE.PlaneGeometry(span * (0.85 + Math.random() * 0.45), span * (0.34 + Math.random() * 0.22)),
          new THREE.MeshBasicMaterial({
            map: this._cloudTexture,
            color: new THREE.Color().setHSL(0.58, upperLayer ? 0.05 : 0.08, upperLayer ? 0.97 : 0.94 + Math.random() * 0.04),
            transparent: true,
            opacity: (upperLayer ? 0.12 : 0.18) + Math.random() * 0.16,
            depthWrite: false,
            side: THREE.DoubleSide,
          })
        );

        plane.rotation.x = -Math.PI / 2 + (Math.random() - 0.5) * 0.15;
        plane.rotation.z = (Math.random() - 0.5) * 0.5;
        plane.position.set(
          (Math.random() - 0.5) * span * 0.45,
          (layerIndex - layerCount * 0.5) * 16 + (Math.random() - 0.5) * 8,
          (Math.random() - 0.5) * span * 0.35
        );
        plane.userData.driftOffset = Math.random() * Math.PI * 2;
        plane.userData.baseScale = 0.92 + Math.random() * 0.28;
        plane.scale.setScalar(plane.userData.baseScale);
        bank.add(plane);
      }

      cloudGroup.add(bank);
    }

    this.clouds = cloudGroup;
    this.scene.add(this.clouds);

    this.assets.loadTexture(ASSET_SOURCES.effects.smoke.file, {
      srgb: true,
      fallback: () => this._cloudTexture,
    }).then(texture => {
      this._cloudTexture = texture;
      this.clouds?.traverse(node => {
        if (!node.isMesh || !node.material) return;
        node.material.map = texture;
        node.material.needsUpdate = true;
      });
    });
  }

  _setupFog() {
    const env = this.envConfig;
    this.scene.fog = new THREE.Fog(env.fogColor, env.fogNear * 0.8, env.fogFar);
  }

  _createTerrainSurface({
    width,
    depth,
    centerX,
    centerZ,
    segmentsX = 1,
    segmentsZ = 1,
    material,
    yOffset = 0.05,
    skirtDepth = null,
    affectsSurfaceHeight = yOffset <= 0.09,
  }) {
    const baseGeometry = new THREE.PlaneGeometry(width, depth, segmentsX, segmentsZ);
    baseGeometry.rotateX(-Math.PI / 2);

    const positions = baseGeometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const worldX = centerX + positions.getX(i);
      const worldZ = centerZ + positions.getZ(i);
      positions.setY(i, this.getSurfaceHeight(worldX, worldZ) + yOffset);
    }

    const topPositions = Array.from(positions.array);
    const topUvs = Array.from(baseGeometry.attributes.uv.array);
    const topIndices = Array.from(baseGeometry.index.array);
    const columns = segmentsX + 1;
    const rows = segmentsZ + 1;
    const vertexIndex = (ix, iz) => iz * columns + ix;
    const perimeter = [];

    for (let ix = 0; ix <= segmentsX; ix++) perimeter.push(vertexIndex(ix, 0));
    for (let iz = 1; iz <= segmentsZ; iz++) perimeter.push(vertexIndex(segmentsX, iz));
    for (let ix = segmentsX - 1; ix >= 0; ix--) perimeter.push(vertexIndex(ix, segmentsZ));
    for (let iz = segmentsZ - 1; iz > 0; iz--) perimeter.push(vertexIndex(0, iz));

    const finalPositions = topPositions.slice();
    const finalUvs = topUvs.slice();
    const finalIndices = topIndices.slice();
    const bottomIndexMap = new Map();
    const effectiveSkirtDepth = skirtDepth ?? THREE.MathUtils.clamp(Math.min(width, depth) * 0.085, 3.8, 18);
    let perimeterLength = 0;

    for (let i = 0; i < perimeter.length; i++) {
      const current = perimeter[i];
      const next = perimeter[(i + 1) % perimeter.length];
      const ax = topPositions[current * 3];
      const ay = topPositions[current * 3 + 1];
      const az = topPositions[current * 3 + 2];
      const bx = topPositions[next * 3];
      const by = topPositions[next * 3 + 1];
      const bz = topPositions[next * 3 + 2];
      perimeterLength += Math.hypot(bx - ax, by - ay, bz - az);
    }

    let distanceCursor = 0;
    if (effectiveSkirtDepth > 0.1) {
      for (let i = 0; i < perimeter.length; i++) {
        const current = perimeter[i];
        const next = perimeter[(i + 1) % perimeter.length];
        const x = topPositions[current * 3];
        const y = topPositions[current * 3 + 1];
        const z = topPositions[current * 3 + 2];
        const nx = topPositions[next * 3];
        const ny = topPositions[next * 3 + 1];
        const nz = topPositions[next * 3 + 2];
        const worldX = centerX + x;
        const worldZ = centerZ + z;
        const drop = effectiveSkirtDepth + Math.abs(this.noise.get(worldX * 0.008, worldZ * 0.008)) * 1.8;
        const bottomIndex = finalPositions.length / 3;
        finalPositions.push(x, y - drop, z);
        finalUvs.push(perimeterLength > 0 ? distanceCursor / perimeterLength : 0, 1);
        bottomIndexMap.set(current, bottomIndex);
        distanceCursor += Math.hypot(nx - x, ny - y, nz - z);
      }

      for (let i = 0; i < perimeter.length; i++) {
        const current = perimeter[i];
        const next = perimeter[(i + 1) % perimeter.length];
        const currentBottom = bottomIndexMap.get(current);
        const nextBottom = bottomIndexMap.get(next);
        finalIndices.push(current, next, nextBottom, current, nextBottom, currentBottom);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(finalPositions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(finalUvs, 2));
    geometry.setIndex(finalIndices);
    geometry.computeVertexNormals();
    baseGeometry.dispose();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(centerX, 0, centerZ);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    if (affectsSurfaceHeight) {
      const zone = {
        minX: centerX - width * 0.5,
        maxX: centerX + width * 0.5,
        minZ: centerZ - depth * 0.5,
        maxZ: centerZ + depth * 0.5,
        centerX,
        centerZ,
        width,
        depth,
        segmentsX,
        segmentsZ,
        positions: mesh.geometry.attributes.position,
        yOffset,
      };
      zone.sampleHeight = (worldX, worldZ) => this._sampleSurfaceZoneHeight(zone, worldX, worldZ);
      this.surfaceZones.push(zone);
    }
    return mesh;
  }

  _createRunwaySkirt(xEdge, outward, zStart, zEnd, width, material) {
    const segments = 72;
    const vertices = [];
    const indices = [];

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const z = THREE.MathUtils.lerp(zStart, zEnd, t);
      const topX = xEdge;
      const bottomX = xEdge + outward * width;
      const topY = this.getSurfaceHeight(topX, z) + 0.06;
      const midX = xEdge + outward * width * 0.42;
      const bottomY = this.getSurfaceHeight(bottomX, z) + 0.02;
      const midY = THREE.MathUtils.lerp(topY - 0.55, bottomY + 0.14, 0.58);

      vertices.push(topX, topY, z);
      vertices.push(midX, midY, z);
      vertices.push(bottomX, bottomY, z);
    }

    for (let i = 0; i < segments; i++) {
      const a = i * 3;
      const b = a + 3;
      indices.push(a, a + 1, b + 1, a, b + 1, b);
      indices.push(a + 1, a + 2, b + 2, a + 1, b + 2, b + 1);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    return mesh;
  }

  _createRunway() {
    const terrainY = this.getTerrainHeight(0, -200);
    const y = terrainY + 0.18;
    this.runwayCenter.set(0, y, -200);
    this.runwayDirection.set(0, 0, -1);

    const group = new THREE.Group();
    const asphaltMaterial = new THREE.MeshStandardMaterial({
      color: 0x232529,
      roughness: 0.9,
      metalness: 0.02,
    });
    const shoulderMaterial = new THREE.MeshStandardMaterial({
      color: 0x756a55,
      roughness: 0.98,
      metalness: 0.0,
      envMapIntensity: 0.08,
    });
    const serviceSurfaceMaterial = new THREE.MeshStandardMaterial({
      color: 0x30343a,
      roughness: 0.94,
      metalness: 0.03,
    });

    const asphalt = this._createTerrainSurface({
      width: 56,
      depth: 1200,
      centerX: 0,
      centerZ: -200,
      segmentsX: 8,
      segmentsZ: 180,
      material: asphaltMaterial,
      yOffset: 0.08,
    });
    group.add(asphalt);

    const earthwork = this._createTerrainSurface({
      width: 168,
      depth: 1320,
      centerX: 0,
      centerZ: -200,
      segmentsX: 18,
      segmentsZ: 186,
      material: shoulderMaterial.clone(),
      yOffset: 0.015,
    });
    group.add(earthwork);

    [-42, 42].forEach(x => {
      const shoulder = this._createTerrainSurface({
        width: 28,
        depth: 1200,
        centerX: x,
        centerZ: -200,
        segmentsX: 3,
        segmentsZ: 180,
        material: shoulderMaterial.clone(),
        yOffset: 0.03,
      });
      group.add(shoulder);
    });

    const runwaySkirtLeft = this._createRunwaySkirt(-28, -1, -840, 440, 56, shoulderMaterial.clone());
    const runwaySkirtRight = this._createRunwaySkirt(28, 1, -840, 440, 56, shoulderMaterial.clone());
    group.add(runwaySkirtLeft, runwaySkirtRight);

    const taxiway = this._createTerrainSurface({
      width: 18,
      depth: 250,
      centerX: -33,
      centerZ: -160,
      segmentsX: 4,
      segmentsZ: 42,
      material: serviceSurfaceMaterial,
      yOffset: 0.075,
    });
    group.add(taxiway);

    const apron = this._createTerrainSurface({
      width: 180,
      depth: 170,
      centerX: -145,
      centerZ: -95,
      segmentsX: 18,
      segmentsZ: 18,
      material: serviceSurfaceMaterial.clone(),
      yOffset: 0.07,
    });
    group.add(apron);

    const serviceRoad = this._createTerrainSurface({
      width: 16,
      depth: 320,
      centerX: -230,
      centerZ: -70,
      segmentsX: 4,
      segmentsZ: 54,
      material: serviceSurfaceMaterial.clone(),
      yOffset: 0.07,
    });
    group.add(serviceRoad);

    let terminalPad = null;

    Promise.all([
      this.assets.loadTextureSet(ASSET_SOURCES.terrain.runway, 36),
      this.assets.loadTextureSet(ASSET_SOURCES.terrain.cityRoad, 22),
    ]).then(([runwaySet, roadSet]) => {
      [asphalt].forEach(surface => {
        if (!surface.material) return;
        surface.material.map = runwaySet.color;
        surface.material.normalMap = runwaySet.normal;
        surface.material.roughnessMap = runwaySet.roughness;
        surface.material.envMapIntensity = 0.32;
        surface.material.needsUpdate = true;
      });

      [earthwork, runwaySkirtLeft, runwaySkirtRight].forEach(surface => {
        if (!surface.material) return;
        surface.material.map = this._terrainTextureSet.dirt.color;
        surface.material.normalMap = this._terrainTextureSet.dirt.normal;
        surface.material.roughnessMap = this._terrainTextureSet.dirt.roughness;
        surface.material.needsUpdate = true;
      });

      [taxiway, apron, serviceRoad, terminalPad].filter(Boolean).forEach(surface => {
        if (!surface.material) return;
        surface.material.map = roadSet.color;
        surface.material.normalMap = roadSet.normal;
        surface.material.roughnessMap = roadSet.roughness;
        surface.material.envMapIntensity = 0.28;
        surface.material.needsUpdate = true;
      });
    });

    const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (let z = -740; z <= 340; z += 60) {
      const dash = this._createTerrainSurface({
        width: 2.6,
        depth: 24,
        centerX: 0,
        centerZ: z,
        segmentsX: 1,
        segmentsZ: 6,
        material: stripeMat,
        yOffset: 0.12,
        skirtDepth: 0,
      });
      group.add(dash);
    }

    for (let lane = -2; lane <= 2; lane++) {
      const mark = this._createTerrainSurface({
        width: 3.4,
        depth: 18,
        centerX: lane * 6,
        centerZ: -740,
        segmentsX: 1,
        segmentsZ: 4,
        material: stripeMat,
        yOffset: 0.12,
        skirtDepth: 0,
      });
      group.add(mark);

      const endMark = this._createTerrainSurface({
        width: 3.4,
        depth: 18,
        centerX: lane * 6,
        centerZ: 340,
        segmentsX: 1,
        segmentsZ: 4,
        material: stripeMat,
        yOffset: 0.12,
        skirtDepth: 0,
      });
      group.add(endMark);
    }

    const edgeMaterial = new THREE.MeshBasicMaterial({ color: 0xfff2c4 });
    for (let z = -760; z <= 360; z += 28) {
      [-22, 22].forEach(x => {
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 8), edgeMaterial);
        light.position.set(x, this.getTerrainHeight(x, z) + 0.7, z);
        group.add(light);
      });
    }

    for (let z = -255; z <= -65; z += 26) {
      const taxiMark = this._createTerrainSurface({
        width: 1.6,
        depth: 10,
        centerX: -33,
        centerZ: z,
        segmentsX: 1,
        segmentsZ: 2,
        material: new THREE.MeshBasicMaterial({ color: 0xf2d364 }),
        yOffset: 0.115,
        skirtDepth: 0,
      });
      group.add(taxiMark);
    }

    const hangarMaterial = this._makeSolidBuildingMaterial('#7f8790');
    const roofMaterial = new THREE.MeshStandardMaterial({
      color: 0x5a6168,
      roughness: 0.82,
      metalness: 0.08,
      envMapIntensity: 0.24,
    });
    [
      { x: -206, z: -38, w: 38, h: 18, d: 30 },
      { x: -206, z: -102, w: 46, h: 22, d: 34 },
      { x: -206, z: -176, w: 34, h: 16, d: 28 },
    ].forEach(spec => {
      const pad = this._createTerrainSurface({
        width: spec.w + 12,
        depth: spec.d + 12,
        centerX: spec.x,
        centerZ: spec.z,
        segmentsX: 4,
        segmentsZ: 4,
        material: serviceSurfaceMaterial.clone(),
        yOffset: 0.05,
      });
      group.add(pad);
      const footprint = this._sampleFootprintStats(spec.x, spec.z, spec.w * 0.55, spec.d * 0.55);
      const baseY = footprint.max - 0.9;
      const body = new THREE.Mesh(new THREE.BoxGeometry(spec.w, spec.h, spec.d), hangarMaterial.clone());
      body.position.set(spec.x, baseY + spec.h * 0.5, spec.z);
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);

      const roof = new THREE.Mesh(new THREE.BoxGeometry(spec.w * 1.05, 2.5, spec.d * 1.04), roofMaterial.clone());
      roof.position.set(spec.x, body.position.y + spec.h * 0.5 + 0.8, spec.z);
      roof.castShadow = true;
      group.add(roof);

      this.obstacles.push({
        center: body.position.clone(),
        hx: spec.w * 0.5,
        hy: spec.h * 0.5 + 1.4,
        hz: spec.d * 0.5,
      });
    });

    terminalPad = this._createTerrainSurface({
      width: 94,
      depth: 44,
      centerX: -142,
      centerZ: 22,
      segmentsX: 10,
      segmentsZ: 6,
      material: serviceSurfaceMaterial.clone(),
      yOffset: 0.06,
    });
    group.add(terminalPad);

    const terminalFootprint = this._sampleFootprintStats(-142, 22, 46, 16);
    const terminal = new THREE.Mesh(new THREE.BoxGeometry(84, 18, 28), hangarMaterial.clone());
    terminal.position.set(-142, terminalFootprint.max + 8.0, 22);
    terminal.castShadow = true;
    terminal.receiveShadow = true;
    group.add(terminal);
    this.obstacles.push({
      center: terminal.position.clone(),
      hx: 42,
      hy: 9,
      hz: 14,
    });

    const towerFootprint = this._sampleFootprintStats(-92, 32, 10, 10);
    const towerBase = new THREE.Mesh(new THREE.BoxGeometry(16, 38, 16), hangarMaterial.clone());
    towerBase.position.set(-92, towerFootprint.max + 18.0, 32);
    towerBase.castShadow = true;
    towerBase.receiveShadow = true;
    group.add(towerBase);

    const towerCab = new THREE.Mesh(new THREE.BoxGeometry(18, 10, 18), this._makeGlassMaterial('#7d8a98'));
    towerCab.position.set(-92, towerBase.position.y + 22, 32);
    towerCab.castShadow = true;
    group.add(towerCab);
    this.obstacles.push({
      center: new THREE.Vector3(-92, towerBase.position.y + 10, 32),
      hx: 9,
      hy: 24,
      hz: 9,
    });

    const windsockPole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.15, 9, 8),
      new THREE.MeshStandardMaterial({ color: 0xd8dde3, roughness: 0.4, metalness: 0.5 })
    );
    windsockPole.position.set(30, this.getTerrainHeight(30, 40) + 4.5, 40);
    windsockPole.castShadow = true;
    group.add(windsockPole);

    const windsock = new THREE.Mesh(
      new THREE.ConeGeometry(1.15, 4.6, 10),
      new THREE.MeshStandardMaterial({ color: 0xff5f3d, roughness: 0.6, metalness: 0.0, emissive: 0x281008 })
    );
    windsock.rotation.z = -Math.PI / 2;
    windsock.position.set(32, this.getTerrainHeight(32, 40) + 8.2, 40);
    group.add(windsock);

    this.runway = group;
    this.scene.add(group);
    this._createLandingPath(y);
  }

  _createAlpineOutpost() {
    if (this.envKey !== 'mountains') return;

    const centerX = 8600;
    const centerZ = -7600;
    const group = new THREE.Group();
    const padMaterial = new THREE.MeshStandardMaterial({
      color: 0x6d747b,
      roughness: 0.92,
      metalness: 0.04,
      envMapIntensity: 0.18,
    });
    const shoulderMaterial = new THREE.MeshStandardMaterial({
      color: 0x7d7567,
      roughness: 0.98,
      metalness: 0.0,
    });
    const beaconMaterial = new THREE.MeshBasicMaterial({ color: 0x7fe7ff });
    const hutMaterial = this._makeSolidBuildingMaterial('#808896');

    const strip = this._createTerrainSurface({
      width: 88,
      depth: 280,
      centerX,
      centerZ,
      segmentsX: 8,
      segmentsZ: 36,
      material: padMaterial,
      yOffset: 0.08,
      skirtDepth: 18,
    });
    const apron = this._createTerrainSurface({
      width: 124,
      depth: 110,
      centerX: centerX - 112,
      centerZ: centerZ + 18,
      segmentsX: 10,
      segmentsZ: 10,
      material: shoulderMaterial,
      yOffset: 0.05,
      skirtDepth: 16,
    });
    group.add(strip, apron);

    const hutFootprint = this._sampleFootprintStats(centerX - 110, centerZ + 20, 18, 14);
    const hut = new THREE.Mesh(new THREE.BoxGeometry(34, 14, 24), hutMaterial);
    hut.position.set(centerX - 110, hutFootprint.max + 7, centerZ + 20);
    hut.castShadow = true;
    hut.receiveShadow = true;
    group.add(hut);
    this.obstacles.push({
      center: hut.position.clone(),
      hx: 17,
      hy: 7,
      hz: 12,
    });

    for (let z = centerZ - 126; z <= centerZ + 126; z += 28) {
      [-42, 42].forEach(xOffset => {
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 8), beaconMaterial);
        light.position.set(centerX + xOffset, this.getSurfaceHeight(centerX + xOffset, z) + 0.8, z);
        group.add(light);
      });
    }

    Promise.all([
      this.assets.loadTextureSet(ASSET_SOURCES.terrain.runway, 18),
      this.assets.loadTextureSet(ASSET_SOURCES.terrain.dirt, 24),
    ]).then(([runwaySet, dirtSet]) => {
      [strip].forEach(surface => {
        if (!surface?.material) return;
        surface.material.map = runwaySet.color;
        surface.material.normalMap = runwaySet.normal;
        surface.material.roughnessMap = runwaySet.roughness;
        surface.material.needsUpdate = true;
      });
      [apron].forEach(surface => {
        if (!surface?.material) return;
        surface.material.map = dirtSet.color;
        surface.material.normalMap = dirtSet.normal;
        surface.material.roughnessMap = dirtSet.roughness;
        surface.material.needsUpdate = true;
      });
    });

    this.alpineOutpost = group;
    this.scene.add(group);
  }

  _createRaceVenue() {
    const group = new THREE.Group();
    const course = CHALLENGE.COURSES.air_race;
    const chevronTexture = makeChevronTexture('#77e1ff', '#ffffff');
    const corridorCurve = new THREE.CatmullRomCurve3(
      course.map(point => new THREE.Vector3(point.x, point.y, point.z)),
      true,
      'catmullrom',
      0.08
    );
    const sampled = corridorCurve.getSpacedPoints(260);
    const corridorWidth = 1120;
    const corridorHeight = 440;
    const wallThickness = 112;
    const shellThickness = 26;
    const startDeckTop = 520;
    const startDeckCenterY = startDeckTop - 14;

    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x2f3945,
      roughness: 0.78,
      metalness: 0.08,
      envMapIntensity: 0.26,
    });
    floorMaterial.userData.surfaceRole = 'track';
    const roofMaterial = new THREE.MeshStandardMaterial({
      color: 0x95a7bb,
      roughness: 0.44,
      metalness: 0.14,
      transparent: true,
      opacity: 0.42,
    });
    roofMaterial.userData.surfaceRole = 'roof';
    const lineMaterial = new THREE.MeshStandardMaterial({
      color: 0x2b94db,
      roughness: 0.28,
      metalness: 0.14,
      emissive: 0x0e4172,
      emissiveIntensity: 1.1,
    });
    lineMaterial.userData.surfaceRole = 'guide';
    const gateMaterial = new THREE.MeshBasicMaterial({
      color: 0xaaf0ff,
      transparent: true,
      opacity: 0.72,
    });
    const chevronMaterial = new THREE.MeshBasicMaterial({
      map: chevronTexture,
      transparent: true,
      opacity: 0.86,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const wallMaterials = {
      left: new THREE.MeshStandardMaterial({
        color: 0xc94141,
        roughness: 0.36,
        metalness: 0.08,
        emissive: 0x5a1414,
        emissiveIntensity: 0.92,
      }),
      right: new THREE.MeshStandardMaterial({
        color: 0x3a85ff,
        roughness: 0.32,
        metalness: 0.12,
        emissive: 0x12396f,
        emissiveIntensity: 0.96,
      }),
    };
    wallMaterials.left.userData.surfaceRole = 'wall';
    wallMaterials.right.userData.surfaceRole = 'wall';

    const makeSegmentBox = (width, height, depth, material, position, yaw, obstacle, alwaysCollide = true) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
      mesh.position.copy(position);
      mesh.rotation.y = yaw;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      if (obstacle) {
        this.obstacles.push({
          center: mesh.position.clone(),
          hx: width * 0.5,
          hy: height * 0.5,
          hz: depth * 0.5,
          rotY: yaw,
          alwaysCollide,
        });
      }
      return mesh;
    };

    const startDeck = makeSegmentBox(
      1120,
      28,
      520,
      floorMaterial.clone(),
      new THREE.Vector3(0, startDeckCenterY, 2500),
      0,
      false
    );
    const startRoof = makeSegmentBox(
      1120,
      22,
      520,
      roofMaterial.clone(),
      new THREE.Vector3(0, startDeckTop + 168, 2500),
      0,
      true
    );
    makeSegmentBox(54, 230, 520, wallMaterials.left.clone(), new THREE.Vector3(-545, startDeckTop + 85, 2500), 0, true);
    makeSegmentBox(54, 230, 520, wallMaterials.right.clone(), new THREE.Vector3(545, startDeckTop + 85, 2500), 0, true);
    makeSegmentBox(1120, 230, 54, wallMaterials.left.clone(), new THREE.Vector3(0, startDeckTop + 85, 2755), 0, true);

    this.surfaceZones.push({
      minX: -560,
      maxX: 560,
      minZ: 2240,
      maxZ: 2760,
      sampleHeight: () => startDeckTop,
    });

    const startArch = new THREE.Group();
    [-160, 160].forEach(x => {
      const column = new THREE.Mesh(new THREE.BoxGeometry(20, 120, 20), wallMaterials.right.clone());
      column.position.set(x, startDeckTop + 60, 2245);
      startArch.add(column);
    });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(360, 22, 24), lineMaterial.clone());
    beam.position.set(0, startDeckTop + 118, 2245);
    startArch.add(beam);
    group.add(startArch);

    for (let x = -360; x <= 360; x += 120) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(56, 1.4, 46), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      stripe.position.set(x, startDeckTop + 0.8, 2270);
      group.add(stripe);
    }

    for (let i = 0; i < sampled.length - 1; i++) {
      const start = sampled[i];
      const end = sampled[i + 1];
      const segment = end.clone().sub(start);
      const horizontal = new THREE.Vector3(segment.x, 0, segment.z);
      const length = horizontal.length();
      if (length < 24) continue;

      const direction = horizontal.normalize();
      const side = new THREE.Vector3(-direction.z, 0, direction.x);
      const yaw = Math.atan2(direction.x, direction.z);
      const center = start.clone().lerp(end, 0.5);
      const laneY = (start.y + end.y) * 0.5;
      const shellDepth = length + 140;
      const floorY = laneY - corridorHeight * 0.5;
      const roofY = laneY + corridorHeight * 0.5;

      makeSegmentBox(
        corridorWidth + wallThickness * 2,
        shellThickness,
        shellDepth,
        floorMaterial.clone(),
        new THREE.Vector3(center.x, floorY, center.z),
        yaw,
        false
      );
      makeSegmentBox(
        corridorWidth + wallThickness * 2,
        shellThickness,
        shellDepth,
        roofMaterial.clone(),
        new THREE.Vector3(center.x, roofY, center.z),
        yaw,
        true
      );
      makeSegmentBox(
        wallThickness,
        corridorHeight,
        shellDepth,
        wallMaterials.left.clone(),
        center.clone().addScaledVector(side, -(corridorWidth * 0.5 + wallThickness * 0.5)).setY(laneY),
        yaw,
        true
      );
      makeSegmentBox(
        wallThickness,
        corridorHeight,
        shellDepth,
        wallMaterials.right.clone(),
        center.clone().addScaledVector(side, corridorWidth * 0.5 + wallThickness * 0.5).setY(laneY),
        yaw,
        true
      );

      const centerStrip = makeSegmentBox(
        120,
        2.2,
        Math.max(50, shellDepth - 36),
        lineMaterial.clone(),
        new THREE.Vector3(center.x, floorY + shellThickness * 0.5 + 2.2, center.z),
        yaw,
        false
      );
      centerStrip.castShadow = false;

      if (i % 6 === 0) {
        const chevron = new THREE.Mesh(new THREE.PlaneGeometry(180, 68), chevronMaterial.clone());
        chevron.position.set(center.x, floorY + shellThickness * 0.5 + 10, center.z);
        chevron.rotation.x = -Math.PI * 0.495;
        chevron.rotation.y = yaw;
        group.add(chevron);
      }
    }

    course.forEach((point, index) => {
      const next = course[(index + 1) % course.length];
      const direction = new THREE.Vector3(next.x - point.x, 0, next.z - point.z).normalize();
      const side = new THREE.Vector3(-direction.z, 0, direction.x);
      const gateOffset = corridorWidth * 0.42;

      [-1, 1].forEach(sign => {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 5.8, 150, 10), gateMaterial.clone());
        post.position.set(point.x + side.x * gateOffset * sign, point.y, point.z + side.z * gateOffset * sign);
        group.add(post);
      });

      const ring = new THREE.Mesh(new THREE.TorusGeometry(56, 4.2, 12, 36), gateMaterial.clone());
      ring.position.set(point.x, point.y, point.z);
      ring.rotation.y = Math.PI * 0.5;
      group.add(ring);

      const marker = new THREE.Mesh(new THREE.PlaneGeometry(220, 72), chevronMaterial.clone());
      marker.position.set(point.x, point.y + 112, point.z);
      marker.rotation.y = Math.atan2(direction.x, direction.z);
      group.add(marker);
    });

    Promise.all([
      this.assets.loadTextureSet(ASSET_SOURCES.terrain.runway, 28),
      this.assets.loadTextureSet(ASSET_SOURCES.terrain.cityRoad, 20),
    ]).then(([runwaySet, roadSet]) => {
      const tarmacSet = runwaySet ?? this._terrainTextureSet.asphalt;
      const guideSet = roadSet ?? this._terrainTextureSet.gravel;
      group.traverse(node => {
        if (!node.isMesh || !node.material) return;
        if (node.material.userData?.surfaceRole === 'track') {
          node.material.map = tarmacSet.color;
          node.material.normalMap = tarmacSet.normal;
          node.material.roughnessMap = tarmacSet.roughness;
        } else if (node.material.userData?.surfaceRole === 'guide') {
          node.material.map = guideSet.color;
          node.material.normalMap = guideSet.normal;
          node.material.roughnessMap = guideSet.roughness;
        }
        node.material.needsUpdate = true;
      });
    });

    this.runwayCenter.set(0, startDeckTop, 2485);
    this.runwayDirection.copy(new THREE.Vector3(course[0].x, 0, course[0].z - 2485).normalize());
    this.raceVenue = group;
    this.scene.add(group);
  }

  _createLandingPath(y) {
    const group = new THREE.Group();
    const beamMaterial = new THREE.MeshBasicMaterial({
      color: 0x49c8ff,
      transparent: true,
      opacity: 0.78,
    });
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0x9ae4ff,
      transparent: true,
      opacity: 0.18,
    });
    const impactMaterial = new THREE.MeshBasicMaterial({
      color: 0x49c8ff,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    });

    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 1, 10, 1, true), beamMaterial);
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1, 10, 1, true), glowMaterial);
    const impact = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.95, 28), impactMaterial);
    impact.rotation.x = -Math.PI / 2;

    group.add(glow, beam, impact);
    group.userData = { beam, glow, impact, baseY: y };

    this.landingPath = group;
    this.landingPath.visible = this.guidelineVisible;
    this.scene.add(group);
  }

  _updateLandingLaser(position, quaternion) {
    const beamGroup = this.landingPath;
    if (!beamGroup?.userData?.beam) return;
    const { beam, glow, impact } = beamGroup.userData;

    this._guideForward.set(0, 0, -1).applyQuaternion(quaternion).normalize();
    this._guideOrigin.copy(position).addScaledVector(this._guideForward, 8);
    this._guideOrigin.y += 1.1;

    let foundHit = false;
    for (let distance = 35; distance <= 2200; distance += 22) {
      this._guideSample.copy(this._guideOrigin).addScaledVector(this._guideForward, distance);
      const groundY = Math.max(this.getSurfaceHeight(this._guideSample.x, this._guideSample.z) + 0.45, (this.envConfig?.waterLevel ?? -200) + 0.45);
      if (this._guideSample.y <= groundY) {
        this._guideHit.set(this._guideSample.x, groundY, this._guideSample.z);
        foundHit = true;
        break;
      }
    }

    if (!foundHit) {
      this._guideHit.copy(this._guideOrigin).addScaledVector(this._guideForward, 1500);
      this._guideHit.y = Math.max(this.getSurfaceHeight(this._guideHit.x, this._guideHit.z) + 0.45, (this.envConfig?.waterLevel ?? -200) + 0.45);
    }

    this._guideDirection.copy(this._guideHit).sub(this._guideOrigin);
    const length = Math.max(1, this._guideDirection.length());
    const direction = this._guideDirection.normalize();
    this._guideMid.copy(this._guideOrigin).lerp(this._guideHit, 0.5);
    this._guideQuat.setFromUnitVectors(this._guideUp, direction);

    [glow, beam].forEach((part, index) => {
      part.position.copy(this._guideMid);
      part.quaternion.copy(this._guideQuat);
      part.scale.set(1, length, 1);
      part.material.opacity = index === 0 ? 0.13 + Math.sin(performance.now() * 0.004) * 0.03 : 0.72 + Math.sin(performance.now() * 0.006) * 0.08;
    });

    impact.position.copy(this._guideHit);
    impact.position.y += 0.12;
    impact.rotation.x = -Math.PI / 2;
    impact.scale.setScalar(1.0 + Math.sin(performance.now() * 0.005) * 0.12);
  }

  setGuidelineVisible(enabled) {
    this.guidelineVisible = !!enabled;
    if (this.landingPath) this.landingPath.visible = this.guidelineVisible;
    return this.guidelineVisible;
  }

  isGuidelineVisible() {
    return this.guidelineVisible;
  }

  _getCityRoadBands() {
    return [-4680, -3980, -3360, -2760, -2200, -1680, -1180, -640, -60, 560, 1220, 1940, 2720, 3560, 4440];
  }

  _createRoadGrid() {
    const group = new THREE.Group();
    const roadMaterial = new THREE.MeshStandardMaterial({
      color: 0x2b3137,
      roughness: 0.94,
      metalness: 0.02,
    });
    const sidewalkMaterial = new THREE.MeshStandardMaterial({
      color: 0x7f858b,
      roughness: 1.0,
      metalness: 0.0,
    });
    const lotMaterial = new THREE.MeshStandardMaterial({
      color: 0x6f726f,
      roughness: 0.98,
      metalness: 0.0,
      envMapIntensity: 0.08,
    });
    const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xf4f1d0 });
    const roadWidth = 34;
    const roadBands = this._getCityRoadBands();
    const cityMin = roadBands[0] - 120;
    const cityMax = roadBands[roadBands.length - 1] + 120;
    const citySpan = cityMax - cityMin;
    const cityCenter = (cityMin + cityMax) * 0.5;
    const cityFoundation = this._createTerrainSurface({
      width: citySpan + 220,
      depth: citySpan + 220,
      centerX: cityCenter,
      centerZ: cityCenter,
      segmentsX: 54,
      segmentsZ: 54,
      material: lotMaterial.clone(),
      yOffset: 0.025,
      skirtDepth: 36,
    });
    group.add(cityFoundation);

    for (const roadX of roadBands) {
      if (this._isAirportZone(roadX, -200, 70)) continue;
      const verticalRoad = this._createTerrainSurface({
        width: roadWidth,
        depth: citySpan,
        centerX: roadX,
        centerZ: cityCenter,
        segmentsX: 2,
        segmentsZ: 72,
        material: roadMaterial,
        yOffset: 0.08,
      });
      group.add(verticalRoad);
    }

    for (const roadZ of roadBands) {
      if (this._isAirportZone(0, roadZ, 90)) continue;
      const horizontalRoad = this._createTerrainSurface({
        width: citySpan,
        depth: roadWidth,
        centerX: cityCenter,
        centerZ: roadZ,
        segmentsX: 72,
        segmentsZ: 2,
        material: roadMaterial,
        yOffset: 0.08,
      });
      group.add(horizontalRoad);
    }

    for (const roadX of roadBands) {
      if (this._isAirportZone(roadX, -200, 70)) continue;
      for (let mark = cityMin + 42; mark <= cityMax - 42; mark += 34) {
        const lane = this._createTerrainSurface({
          width: 1.2,
          depth: 12,
          centerX: roadX,
          centerZ: mark,
          segmentsX: 1,
          segmentsZ: 2,
          material: lineMaterial,
          yOffset: 0.11,
          skirtDepth: 0,
        });
        group.add(lane);
      }
    }

    for (const roadZ of roadBands) {
      if (this._isAirportZone(0, roadZ, 90)) continue;
      for (let mark = cityMin + 42; mark <= cityMax - 42; mark += 34) {
        const laneH = this._createTerrainSurface({
          width: 12,
          depth: 1.2,
          centerX: mark,
          centerZ: roadZ,
          segmentsX: 2,
          segmentsZ: 1,
          material: lineMaterial,
          yOffset: 0.11,
          skirtDepth: 0,
        });
        group.add(laneH);
      }
    }

    for (const roadX of roadBands) {
      if (this._isAirportZone(roadX, -200, 78)) continue;
      [-1, 1].forEach(side => {
        const sidewalkV = this._createTerrainSurface({
          width: 6,
          depth: citySpan,
          centerX: roadX + side * (roadWidth * 0.5 + 3),
          centerZ: cityCenter,
          segmentsX: 1,
          segmentsZ: 72,
          material: sidewalkMaterial,
          yOffset: 0.095,
        });
        group.add(sidewalkV);
      });
    }

    for (const roadZ of roadBands) {
      if (this._isAirportZone(0, roadZ, 98)) continue;
      [-1, 1].forEach(side => {
        const sidewalkH = this._createTerrainSurface({
          width: citySpan,
          depth: 6,
          centerX: cityCenter,
          centerZ: roadZ + side * (roadWidth * 0.5 + 3),
          segmentsX: 72,
          segmentsZ: 1,
          material: sidewalkMaterial,
          yOffset: 0.095,
        });
        group.add(sidewalkH);
      });
    }

    const parkMaterial = new THREE.MeshStandardMaterial({ color: 0x5a6b43, roughness: 0.96, metalness: 0.0 });
    const cityTreeTrunk = new THREE.MeshStandardMaterial({ color: 0x5d402b, roughness: 0.95 });
    const cityTreeLeaves = new THREE.MeshStandardMaterial({ color: 0x4b6934, roughness: 0.9 });
    for (let ix = 0; ix < roadBands.length - 1; ix++) {
      for (let iz = 0; iz < roadBands.length - 1; iz++) {
        const centerX = (roadBands[ix] + roadBands[ix + 1]) * 0.5;
        const centerZ = (roadBands[iz] + roadBands[iz + 1]) * 0.5;
        if (this._isAirportZone(centerX, centerZ, 90)) continue;
        if (this.noise.get(ix * 0.9 + 12, iz * 0.9 - 8) < 0.38) continue;

        const park = this._createTerrainSurface({
          width: 56,
          depth: 56,
          centerX,
          centerZ,
          segmentsX: 8,
          segmentsZ: 8,
          material: parkMaterial,
          yOffset: 0.06,
        });
        park.receiveShadow = true;
        group.add(park);

        for (let treeIndex = 0; treeIndex < 4; treeIndex++) {
          const tx = centerX + (Math.random() - 0.5) * 28;
          const tz = centerZ + (Math.random() - 0.5) * 28;
          const ty = this.getSurfaceHeight(tx, tz);
          const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 3.4, 6), cityTreeTrunk);
          trunk.position.set(tx, ty + 1.7, tz);
          const crown = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 8), cityTreeLeaves);
          crown.position.set(tx, ty + 4.3, tz);
          trunk.castShadow = true;
          crown.castShadow = true;
          group.add(trunk, crown);
        }
      }
    }

    for (let ix = 0; ix < roadBands.length - 1; ix++) {
      for (let iz = 0; iz < roadBands.length - 1; iz++) {
        const centerX = (roadBands[ix] + roadBands[ix + 1]) * 0.5;
        const centerZ = (roadBands[iz] + roadBands[iz + 1]) * 0.5;
        if (this._isAirportZone(centerX, centerZ, 90)) continue;
        const parkBlock = this.noise.get(ix * 0.9 + 12, iz * 0.9 - 8) >= 0.38;
        if (parkBlock) continue;

        const lotWidth = Math.max(60, roadBands[ix + 1] - roadBands[ix] - roadWidth - 18);
        const lotDepth = Math.max(60, roadBands[iz + 1] - roadBands[iz] - roadWidth - 18);
        const lot = this._createTerrainSurface({
          width: lotWidth,
          depth: lotDepth,
          centerX,
          centerZ,
          segmentsX: 4,
          segmentsZ: 4,
          material: lotMaterial,
          yOffset: 0.055,
          skirtDepth: 22,
        });
        group.add(lot);
      }
    }

    this.roadNetwork = group;
    this.scene.add(group);

    this.assets.loadTextureSet(ASSET_SOURCES.terrain.cityRoad, 48).then(set => {
      [cityFoundation].forEach(surface => {
        if (!surface?.material) return;
        surface.material.map = set.color;
        surface.material.normalMap = set.normal;
        surface.material.roughnessMap = set.roughness;
        surface.material.needsUpdate = true;
      });
      group.traverse(node => {
        if (!node.isMesh) return;
        if (node.material === roadMaterial || node.material === lotMaterial) {
          node.material.map = set.color;
          node.material.normalMap = set.normal;
          node.material.roughnessMap = set.roughness;
          node.material.needsUpdate = true;
        }
      });
    });
  }

  _createCityBuildings() {
    const group = new THREE.Group();

    const roadWidth = 34;
    const roadBands = this._getCityRoadBands();
    const specs = [
      { w: 44, d: 44, h: 360, jitter: 148, material: this._makeGlassMaterial('#54637c') },
      { w: 58, d: 40, h: 248, jitter: 104, material: this._makeGlassMaterial('#5d547c') },
      { w: 42, d: 32, h: 146, jitter: 72, material: this._makeSolidBuildingMaterial('#70819a') },
      { w: 32, d: 26, h: 84, jitter: 62, material: this._makeSolidBuildingMaterial('#647790') },
      { w: 56, d: 26, h: 40, jitter: 62, material: this._makeSolidBuildingMaterial('#62708a') },
      { w: 72, d: 30, h: 22, jitter: 68, material: this._makeSolidBuildingMaterial('#516274') },
    ];

    specs.forEach((spec, specIndex) => {
      const geometry = new THREE.BoxGeometry(spec.w, 1, spec.d);
      const mesh = new THREE.InstancedMesh(geometry, spec.material, 460);
      let instanceIndex = 0;

      for (let gx = 0; gx < roadBands.length - 1; gx++) {
        for (let gz = 0; gz < roadBands.length - 1; gz++) {
          const baseX = (roadBands[gx] + roadBands[gx + 1]) * 0.5;
          const baseZ = (roadBands[gz] + roadBands[gz + 1]) * 0.5;
          if (this._isAirportZone(baseX, baseZ, 70)) continue;
          const parkBlock = this.noise.get(gx * 0.9 + 12, gz * 0.9 - 8) >= 0.38;
          if (parkBlock) continue;

          const density = (this.noise.get(gx * 1.4 + specIndex * 4.2, gz * 1.4 - specIndex * 3.6) + 1) * 0.5;
          const threshold = specIndex === 0 ? 0.18 : specIndex === 1 ? 0.06 : specIndex === 2 ? 0.0 : specIndex === 3 ? -0.02 : 0.02;
          if (density < threshold) continue;

          const blockWidth = Math.max(70, roadBands[gx + 1] - roadBands[gx] - roadWidth - 18);
          const blockDepth = Math.max(70, roadBands[gz + 1] - roadBands[gz] - roadWidth - 18);
          const x = baseX + this.noise.get(gx * 0.7 + 8.1, gz * 0.7 - 2.4) * Math.min(spec.jitter, blockWidth * 0.24);
          const z = baseZ + this.noise.get(gz * 0.7 - 5.3, gx * 0.7 + 7.7) * Math.min(spec.jitter, blockDepth * 0.24);
          const footprint = this._sampleFootprintStats(x, z, spec.w * 0.52, spec.d * 0.52);
          const terrainY = footprint.max - 1.2;
          const downtownBias = 1 - Math.min(Math.sqrt(x * x + z * z) / 1200, 1);
          const height = spec.h * (0.68 + Math.abs(this.noise.get(x * 0.01, z * 0.01)) * 0.78 + downtownBias * 0.35);

          const matrix = new THREE.Matrix4();
          matrix.compose(
            new THREE.Vector3(x, terrainY + height * 0.5, z),
            new THREE.Quaternion(),
            new THREE.Vector3(1, height, 1)
          );
          mesh.setMatrixAt(instanceIndex++, matrix);

          this.obstacles.push({
            center: new THREE.Vector3(x, terrainY + height * 0.5, z),
            hx: spec.w * 0.5,
            hy: height * 0.5,
            hz: spec.d * 0.5,
          });
        }
      }

      mesh.count = instanceIndex;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    });

    this.city = group;
    this.scene.add(group);
  }

  _createForestClusters() {
    const group = new THREE.Group();
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5d402b, roughness: 0.95 });
    const leavesMat = new THREE.MeshStandardMaterial({ color: 0x385d2d, roughness: 0.88, envMapIntensity: 0.1 });
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.6, 1, 6), trunkMat, 480);
    const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(2.8, 6.4, 7), leavesMat, 480);
    const heroPlacements = [];
    const profile = {
      mountains: { clusters: 46, clusterRadius: 132, minTrees: 10, maxTrees: 18 },
      coastal: { clusters: 44, clusterRadius: 128, minTrees: 8, maxTrees: 16 },
      desert: { clusters: 12, clusterRadius: 78, minTrees: 3, maxTrees: 6 },
      canyon: { clusters: 0, clusterRadius: 0, minTrees: 0, maxTrees: 0 },
      air_race: { clusters: 28, clusterRadius: 88, minTrees: 6, maxTrees: 10 },
      city: { clusters: 0, clusterRadius: 0, minTrees: 0, maxTrees: 0 },
    }[this.envKey] ?? { clusters: 38, clusterRadius: 112, minTrees: 8, maxTrees: 15 };

    let count = 0;
    for (let cluster = 0; cluster < profile.clusters; cluster++) {
      const cx = (Math.random() - 0.5) * RENDER.TERRAIN_SIZE * 0.78;
      const cz = (Math.random() - 0.5) * RENDER.TERRAIN_SIZE * 0.78;
      if (this._isAirportZone(cx, cz, 180)) continue;
      if (this._isRaceTrackZone(cx, cz, 240)) continue;
      if (this.envKey === 'mountains' && Math.hypot(cx - 8600, cz + 7600) < 2500) continue;

      const treesInCluster = profile.minTrees + Math.floor(Math.random() * Math.max(1, profile.maxTrees - profile.minTrees + 1));
      for (let i = 0; i < treesInCluster && count < 460; i++) {
        const x = cx + (Math.random() - 0.5) * profile.clusterRadius;
        const z = cz + (Math.random() - 0.5) * profile.clusterRadius;
        if (this._isAirportZone(x, z, 110)) continue;
        if (this._isRaceTrackZone(x, z, 140)) continue;
        if (this.envKey === 'mountains' && Math.hypot(x - 8600, z + 7600) < 1900) continue;
        const terrainY = this.getSurfaceHeight(x, z);
        const waterMargin = (this.envConfig?.waterLevel ?? -200) + (this.envKey === 'coastal' ? 5.5 : 1.8);
        if (terrainY <= waterMargin) continue;
        const footprint = this._sampleFootprintStats(x, z, 4.5, 4.5);
        if (footprint.max - footprint.min > 9) continue;
        const height = 12 + Math.random() * 14;

        const trunkMatrix = new THREE.Matrix4().compose(
          new THREE.Vector3(x, terrainY + height * 0.22, z),
          new THREE.Quaternion(),
          new THREE.Vector3(1, height * 0.45, 1)
        );
        trunk.setMatrixAt(count, trunkMatrix);

        const crownScale = 1.35 + Math.random() * 0.7;
        const crownMatrix = new THREE.Matrix4().compose(
          new THREE.Vector3(x, terrainY + height * 0.8, z),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI),
          new THREE.Vector3(crownScale, 1.4 + Math.random() * 0.8, crownScale)
        );
        crown.setMatrixAt(count, crownMatrix);

        this.obstacles.push({
          center: new THREE.Vector3(x, terrainY + height * 0.6, z),
          hx: 3.2,
          hy: height * 0.6,
          hz: 3.2,
        });
        if (heroPlacements.length < 64 && Math.random() > 0.38) {
          heroPlacements.push({
            x,
            y: terrainY,
            z,
            scale: 0.16 + Math.random() * 0.08,
            rotationY: Math.random() * Math.PI * 2,
          });
        }
        count++;
      }
    }

    trunk.count = count;
    crown.count = count;
    trunk.instanceMatrix.needsUpdate = true;
    crown.instanceMatrix.needsUpdate = true;
    trunk.castShadow = true;
    crown.castShadow = true;
    group.add(trunk, crown);

    this.forest = group;
    this.scene.add(group);

    this.assets.loadFBX(ASSET_SOURCES.scenery.tree).then(treeAsset => {
      if (!treeAsset || this.forest !== group) return;

      treeAsset.traverse(node => {
        if (!node.isMesh) return;
        node.castShadow = true;
        node.receiveShadow = true;
        if (!node.geometry) return;
        node.geometry = node.geometry.clone();
        node.geometry.computeVertexNormals();
        node.geometry.computeBoundingBox();
        const bbox = node.geometry.boundingBox;
        const span = Math.max(0.001, bbox.max.y - bbox.min.y);
        const pos = node.geometry.attributes.position;
        const colors = new Float32Array(pos.count * 3);
        const low = new THREE.Color(0x5b4028);
        const mid = new THREE.Color(0x486735);
        const high = new THREE.Color(0x83b25a);
        const tint = new THREE.Color();
        for (let i = 0; i < pos.count; i++) {
          const yNorm = THREE.MathUtils.clamp((pos.getY(i) - bbox.min.y) / span, 0, 1);
          if (yNorm < 0.18) tint.copy(low);
          else if (yNorm < 0.42) tint.copy(low).lerp(mid, (yNorm - 0.18) / 0.24);
          else tint.copy(mid).lerp(high, (yNorm - 0.42) / 0.58);
          colors[i * 3] = tint.r;
          colors[i * 3 + 1] = tint.g;
          colors[i * 3 + 2] = tint.b;
        }
        node.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        node.material = new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.94,
          metalness: 0,
          envMapIntensity: 0.08,
          transparent: false,
        });
      });

      heroPlacements.forEach(placement => {
        const tree = treeAsset.clone(true);
        tree.scale.setScalar(placement.scale);
        tree.rotation.y = placement.rotationY;
        tree.position.set(placement.x, 0, placement.z);
        tree.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(tree);
        const groundedY = bounds.isEmpty() ? placement.y : placement.y - bounds.min.y;
        tree.position.y = groundedY;
        group.add(tree);
      });
    });
  }

  _createDesertOases() {
    const group = new THREE.Group();
    const pondMaterial = new THREE.MeshStandardMaterial({
      color: 0x3d8ca5,
      transparent: true,
      opacity: 0.82,
      roughness: 0.24,
      metalness: 0.05,
      envMapIntensity: 0.45,
    });
    const shoreMaterial = new THREE.MeshStandardMaterial({
      color: 0xa08a57,
      roughness: 0.98,
      metalness: 0.0,
    });

    const candidates = [
      { x: 880, z: -1260, radius: 54 },
      { x: -1320, z: -420, radius: 42 },
      { x: 1460, z: 980, radius: 36 },
    ];

    candidates.forEach(candidate => {
      if (this._isAirportZone(candidate.x, candidate.z, 220)) return;
      const shore = this._createTerrainSurface({
        width: candidate.radius * 2.8,
        depth: candidate.radius * 2.2,
        centerX: candidate.x,
        centerZ: candidate.z,
        segmentsX: 12,
        segmentsZ: 10,
        material: shoreMaterial.clone(),
        yOffset: 0.05,
      });
      group.add(shore);

      const pond = this._createTerrainSurface({
        width: candidate.radius * 1.7,
        depth: candidate.radius * 1.25,
        centerX: candidate.x,
        centerZ: candidate.z,
        segmentsX: 12,
        segmentsZ: 10,
        material: pondMaterial.clone(),
        yOffset: 0.025,
      });
      group.add(pond);
    });

    this.desertDetails = group;
    this.scene.add(group);
  }

  _makeGlassMaterial(baseColor) {
    const neonCity = this.envKey === 'city';
    const windowTexture = neonCity ? this._cityWindowTexture : this._windowTexture;
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(baseColor),
      map: windowTexture,
      emissiveMap: windowTexture,
      emissive: new THREE.Color(neonCity ? 0x173654 : 0x2a231b),
      roughness: neonCity ? 0.16 : 0.24,
      metalness: neonCity ? 0.42 : 0.35,
      envMapIntensity: neonCity ? 1.35 : 1.15,
    });
  }

  _makeSolidBuildingMaterial(baseColor) {
    const neonCity = this.envKey === 'city';
    const windowTexture = neonCity ? this._cityWindowTexture : this._windowTexture;
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(baseColor),
      map: windowTexture,
      emissiveMap: windowTexture,
      emissive: new THREE.Color(neonCity ? 0x102d48 : 0x221b16),
      roughness: neonCity ? 0.56 : 0.72,
      metalness: neonCity ? 0.14 : 0.08,
      envMapIntensity: neonCity ? 0.48 : 0.35,
    });
  }

  cleanup() {
    const dispose = object => {
      if (!object) return;
      object.traverse?.(node => {
        if (!node.isMesh) return;
        node.geometry?.dispose();
        if (Array.isArray(node.material)) {
          node.material.forEach(material => material.dispose?.());
        } else {
          node.material?.dispose?.();
        }
      });
      if (object.isObject3D) this.scene.remove(object);
    };

    dispose(this.terrain); this.terrain = null;
    dispose(this.terrainUnderlay); this.terrainUnderlay = null;
    dispose(this.water); this.water = null;
    dispose(this.sky); this.sky = null;
    dispose(this.clouds); this.clouds = null;
    dispose(this.runway); this.runway = null;
    dispose(this.city); this.city = null;
    dispose(this.forest); this.forest = null;
    dispose(this.roadNetwork); this.roadNetwork = null;
    dispose(this.raceVenue); this.raceVenue = null;
    dispose(this.desertDetails); this.desertDetails = null;
    dispose(this.alpineOutpost); this.alpineOutpost = null;
    dispose(this.landingPath); this.landingPath = null;

    [this.sun, this.sunGlow, this.sunTarget, this.hemisphereLight, this.ambientLight].forEach(light => {
      if (light) this.scene.remove(light);
    });
    this.sun = null;
    this.sunGlow = null;
    this.sunTarget = null;
    this.hemisphereLight = null;
    this.ambientLight = null;

    this.scene.fog = null;
    this.scene.environment = null;
    this.scene.background = null;
    this._backgroundTexture?.dispose?.();
    this._backgroundTexture = null;
    this._environmentTexture?.dispose?.();
    this._environmentTexture = null;
    this._satelliteTexture?.dispose?.();
    this._satelliteTexture = null;
    this.obstacles = [];
    this._clearRings();
    this._heightCache.clear();
  }

  _clearRings() {
    this.rings.forEach(ring => {
      if (ring.mesh) {
        ring.mesh.geometry?.dispose();
        ring.mesh.material?.dispose();
        this.scene.remove(ring.mesh);
      }
      if (ring.glow) {
        ring.glow.geometry?.dispose();
        ring.glow.material?.dispose();
        this.scene.remove(ring.glow);
      }
    });
    this.rings = [];
  }

  destroy() {
    this.cleanup();
  }
}
