import * as THREE from 'three';

function createSolidTexture(r, g, b, colorSpace = THREE.SRGBColorSpace) {
  const data = new Uint8Array([r, g, b, 255]);
  const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  texture.colorSpace = colorSpace;
  return texture;
}

const DEFAULT_COLOR = createSolidTexture(120, 142, 96);
const DEFAULT_NORMAL = createSolidTexture(128, 128, 255, THREE.NoColorSpace);
const DEFAULT_ROUGHNESS = createSolidTexture(214, 214, 214, THREE.NoColorSpace);

function pickTextureSet(textureSets, terrainMode) {
  if (terrainMode === 1 || terrainMode === 4) return textureSets.dirt ?? textureSets.rock ?? textureSets.grass;
  if (terrainMode === 2) return textureSets.grass ?? textureSets.dirt ?? textureSets.rock;
  if (terrainMode === 3) return textureSets.grass ?? textureSets.rock ?? textureSets.dirt;
  return textureSets.grass ?? textureSets.dirt ?? textureSets.rock;
}

export function createLayeredTerrainMaterial(textureSets, env, options = {}) {
  const terrainMode = options.terrainMode ?? 0;
  const activeSet = pickTextureSet(textureSets, terrainMode);
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(...env.baseColor).lerp(new THREE.Color(1, 1, 1), 0.38),
    map: activeSet?.color ?? DEFAULT_COLOR,
    normalMap: activeSet?.normal ?? DEFAULT_NORMAL,
    roughnessMap: activeSet?.roughness ?? DEFAULT_ROUGHNESS,
    vertexColors: true,
    metalness: 0,
    roughness: 0.99,
    envMapIntensity: 0.04,
    side: THREE.DoubleSide,
    transparent: false,
  });

  material.userData.updateTextures = nextSets => {
    const next = pickTextureSet(nextSets, terrainMode);
    material.map = next?.color ?? DEFAULT_COLOR;
    material.normalMap = next?.normal ?? DEFAULT_NORMAL;
    material.roughnessMap = next?.roughness ?? DEFAULT_ROUGHNESS;
    material.needsUpdate = true;
  };

  return material;
}
