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

const DEFAULT_COLOR = createSolidTexture(130, 150, 108);

function getTerrainModeSets(textureSets, terrainMode) {
  const grass = textureSets.grass ?? textureSets.dirt ?? textureSets.rock;
  const dirt = textureSets.dirt ?? textureSets.gravel ?? grass;
  const rock = textureSets.rock ?? textureSets.gravel ?? dirt;
  const snow = textureSets.snow ?? textureSets.rock ?? rock;
  const sand = textureSets.sand ?? textureSets.dirt ?? dirt;
  const gravel = textureSets.gravel ?? textureSets.rock ?? rock;

  switch (terrainMode) {
    case 5:
      return { primary: grass, secondary: gravel, tertiary: rock, peak: snow, shore: dirt };
    case 4:
      return { primary: sand, secondary: dirt, tertiary: rock, peak: rock, shore: sand };
    case 3:
      return { primary: grass, secondary: gravel, tertiary: rock, peak: gravel, shore: dirt };
    case 2:
      return { primary: grass, secondary: sand, tertiary: rock, peak: rock, shore: sand };
    case 1:
      return { primary: sand, secondary: dirt, tertiary: rock, peak: rock, shore: sand };
    default:
      return { primary: grass, secondary: dirt, tertiary: rock, peak: snow, shore: dirt };
  }
}

function textureOrFallback(texture, fallback = DEFAULT_COLOR) {
  return texture ?? fallback;
}

export function createLayeredTerrainMaterial(textureSets, env, options = {}) {
  const terrainMode = options.terrainMode ?? 0;
  const heightScale = Math.max(120, (env?.amplitude ?? 320) * 1.55);
  const snowLine = options.snowLine ?? env?.snowLine ?? 0.7;
  const waterLevel = options.waterLevel ?? env?.waterLevel ?? -200;
  const layers = getTerrainModeSets(textureSets, terrainMode);
  const runtime = {
    shader: null,
    layers,
  };

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    metalness: 0.0,
    roughness: 0.97,
    envMapIntensity: 0.16,
    side: THREE.DoubleSide,
    transparent: false,
  });

  const uniformState = {
    primaryMap: { value: textureOrFallback(layers.primary?.color) },
    secondaryMap: { value: textureOrFallback(layers.secondary?.color) },
    tertiaryMap: { value: textureOrFallback(layers.tertiary?.color) },
    peakMap: { value: textureOrFallback(layers.peak?.color) },
    shoreMap: { value: textureOrFallback(layers.shore?.color) },
    terrainMode: { value: terrainMode },
    terrainHeightScale: { value: heightScale },
    waterLevel: { value: waterLevel },
    snowLine: { value: snowLine },
  };

  material.onBeforeCompile = shader => {
    runtime.shader = shader;
    Object.assign(shader.uniforms, uniformState);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vTerrainWorldPos;
varying vec3 vTerrainWorldNormal;`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vTerrainWorldPos = worldPosition.xyz;
vTerrainWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vTerrainWorldPos;
varying vec3 vTerrainWorldNormal;
uniform sampler2D primaryMap;
uniform sampler2D secondaryMap;
uniform sampler2D tertiaryMap;
uniform sampler2D peakMap;
uniform sampler2D shoreMap;
uniform float terrainMode;
uniform float terrainHeightScale;
uniform float waterLevel;
uniform float snowLine;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec4 sampleTriPlanar(sampler2D tex, vec3 worldPos, vec3 normal, float scale) {
  vec3 blend = pow(abs(normal), vec3(5.0));
  blend /= max(dot(blend, vec3(1.0)), 0.0001);
  vec4 x = texture2D(tex, worldPos.zy * scale);
  vec4 y = texture2D(tex, worldPos.xz * scale);
  vec4 z = texture2D(tex, worldPos.xy * scale);
  return x * blend.x + y * blend.y + z * blend.z;
}

vec3 getTerrainColor() {
  vec3 normal = normalize(vTerrainWorldNormal);
  float slope = 1.0 - clamp(normal.y, 0.0, 1.0);
  float heightNorm = clamp((vTerrainWorldPos.y - waterLevel) / max(terrainHeightScale, 1.0), 0.0, 1.25);
  float macroPatch = valueNoise(vTerrainWorldPos.xz * 0.00085);
  float microPatch = valueNoise(vTerrainWorldPos.xz * 0.0062);
  float shoreBand = 1.0 - smoothstep(8.0, 42.0, vTerrainWorldPos.y - waterLevel);
  float vegetation = smoothstep(0.14, 0.68, macroPatch * 0.82 + microPatch * 0.18);
  float rockBlend = smoothstep(0.18, 0.74, slope + heightNorm * 0.25);
  float dirtBlend = smoothstep(0.18, 0.62, 1.0 - vegetation + microPatch * 0.16) * (1.0 - rockBlend * 0.55);
  float snowStart = mix(0.58, 0.88, clamp(snowLine, 0.0, 1.0));
  float snowBlend = smoothstep(snowStart, min(1.1, snowStart + 0.24), heightNorm + slope * 0.16);
  float sandBlend = shoreBand * (1.0 - snowBlend) + smoothstep(0.32, 0.76, 1.0 - vegetation) * 0.18;
  float gravelBlend = smoothstep(0.36, 0.82, slope + microPatch * 0.18);

  if (terrainMode < 1.5) {
    sandBlend *= 0.25;
  } else if (terrainMode < 2.5) {
    sandBlend = max(sandBlend, smoothstep(0.2, 0.72, 1.0 - vegetation));
    dirtBlend *= 0.55;
  } else if (terrainMode < 3.5) {
    sandBlend *= 1.12;
    rockBlend *= 0.84;
  } else if (terrainMode < 4.5) {
    gravelBlend = max(gravelBlend, smoothstep(0.26, 0.74, macroPatch));
    sandBlend *= 0.14;
  } else if (terrainMode < 5.5) {
    sandBlend = max(sandBlend, smoothstep(0.18, 0.65, 1.0 - vegetation) * 0.88);
    rockBlend = max(rockBlend, smoothstep(0.12, 0.58, slope + heightNorm * 0.1));
    snowBlend *= 0.1;
  } else {
    snowBlend = max(snowBlend, smoothstep(0.44, 0.82, heightNorm + slope * 0.18));
    rockBlend = max(rockBlend, smoothstep(0.12, 0.52, slope + heightNorm * 0.12));
    sandBlend *= 0.12;
  }

  vec3 primary = sampleTriPlanar(primaryMap, vTerrainWorldPos, normal, 0.08).rgb;
  vec3 secondary = sampleTriPlanar(secondaryMap, vTerrainWorldPos, normal, 0.094).rgb;
  vec3 tertiary = sampleTriPlanar(tertiaryMap, vTerrainWorldPos, normal, 0.11).rgb;
  vec3 peak = sampleTriPlanar(peakMap, vTerrainWorldPos, normal, 0.072).rgb;
  vec3 shore = sampleTriPlanar(shoreMap, vTerrainWorldPos, normal, 0.085).rgb;

  vec3 color = primary;
  color = mix(color, secondary, clamp(dirtBlend, 0.0, 1.0) * 0.72);
  color = mix(color, tertiary, clamp(max(rockBlend, gravelBlend * 0.5), 0.0, 1.0) * 0.88);
  color = mix(color, shore, clamp(sandBlend, 0.0, 1.0));
  color = mix(color, peak, clamp(snowBlend, 0.0, 1.0));

  float lightVariation = 0.9 + macroPatch * 0.17 + microPatch * 0.08;
  return clamp(color * lightVariation, 0.0, 1.35);
}`
      )
      .replace(
        '#include <map_fragment>',
        `vec3 terrainColor = getTerrainColor();
diffuseColor.rgb *= terrainColor;`
      );
  };

  material.customProgramCacheKey = () => `terrain-${terrainMode}`;

  material.userData.updateTextures = nextSets => {
    const nextLayers = getTerrainModeSets(nextSets, terrainMode);
    runtime.layers = nextLayers;
    uniformState.primaryMap.value = textureOrFallback(nextLayers.primary?.color);
    uniformState.secondaryMap.value = textureOrFallback(nextLayers.secondary?.color);
    uniformState.tertiaryMap.value = textureOrFallback(nextLayers.tertiary?.color);
    uniformState.peakMap.value = textureOrFallback(nextLayers.peak?.color);
    uniformState.shoreMap.value = textureOrFallback(nextLayers.shore?.color);
    if (runtime.shader) {
      runtime.shader.uniforms.primaryMap.value = uniformState.primaryMap.value;
      runtime.shader.uniforms.secondaryMap.value = uniformState.secondaryMap.value;
      runtime.shader.uniforms.tertiaryMap.value = uniformState.tertiaryMap.value;
      runtime.shader.uniforms.peakMap.value = uniformState.peakMap.value;
      runtime.shader.uniforms.shoreMap.value = uniformState.shoreMap.value;
    }
    material.needsUpdate = true;
  };

  material.userData.updateWaterLevel = nextWaterLevel => {
    uniformState.waterLevel.value = nextWaterLevel;
    if (runtime.shader) runtime.shader.uniforms.waterLevel.value = nextWaterLevel;
  };

  return material;
}
