import * as THREE from 'three';
import { RGBELoader } from 'https://cdn.jsdelivr.net/npm/three@0.162.0/examples/jsm/loaders/RGBELoader.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.162.0/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'https://cdn.jsdelivr.net/npm/three@0.162.0/examples/jsm/loaders/FBXLoader.js';

function clampByte(value) {
  return Math.max(0, Math.min(255, value | 0));
}

export function createNoiseTexture(colors, size = 128, contrast = 28) {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const c = colors[i % colors.length];
    const jitter = (Math.random() - 0.5) * contrast;
    data[i * 4] = clampByte(c[0] + jitter);
    data[i * 4 + 1] = clampByte(c[1] + jitter);
    data[i * 4 + 2] = clampByte(c[2] + jitter);
    data[i * 4 + 3] = 255;
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createFlatNormalTexture(size = 4) {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = 128;
    data[i * 4 + 1] = 128;
    data[i * 4 + 2] = 255;
    data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export function createScalarTexture(level, size = 4) {
  const byte = clampByte(level * 255);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = byte;
    data[i * 4 + 1] = byte;
    data[i * 4 + 2] = byte;
    data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export class AssetLoader {
  constructor(renderer) {
    this.renderer = renderer;
    this.textureLoader = new THREE.TextureLoader();
    this.rgbeLoader = new RGBELoader();
    this.gltfLoader = new GLTFLoader();
    this.fbxLoader = new FBXLoader();
  }

  _prepareTexture(texture, { repeat = 1, srgb = true } = {}) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat, repeat);
    texture.anisotropy = this.renderer?.capabilities?.getMaxAnisotropy?.() ?? 1;
    texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  loadTexture(url, options = {}) {
    const fallback = options.fallback;
    return new Promise(resolve => {
      this.textureLoader.load(
        url,
        texture => resolve(this._prepareTexture(texture, options)),
        undefined,
        () => resolve(this._prepareTexture(fallback(), options))
      );
    });
  }

  loadTextureSet(definition, repeat = 1) {
    return Promise.all([
      this.loadTexture(definition.files.color, {
        repeat,
        srgb: true,
        fallback: () => createNoiseTexture([[82, 110, 58], [110, 134, 74], [57, 79, 39]], 128, 35),
      }),
      this.loadTexture(definition.files.normal, {
        repeat,
        srgb: false,
        fallback: () => createFlatNormalTexture(),
      }),
      this.loadTexture(definition.files.roughness, {
        repeat,
        srgb: false,
        fallback: () => createScalarTexture(0.8),
      }),
    ]).then(([color, normal, roughness]) => ({ color, normal, roughness }));
  }

  loadHDRI(definition) {
    return new Promise(resolve => {
      this.rgbeLoader.load(
        definition.file,
        texture => {
          texture.mapping = THREE.EquirectangularReflectionMapping;
          resolve(texture);
        },
        undefined,
        () => resolve(null)
      );
    });
  }

  loadGLTF(definition) {
    if (definition?.fileObject) {
      return new Promise(resolve => {
        const tryParse = () => {
          const file = definition.fileObject;
          const loadSource = file.name?.toLowerCase?.().endsWith('.gltf')
            ? file.text()
            : file.arrayBuffer();
          const basePath = typeof definition.file === 'string' && definition.file.includes('/')
            ? definition.file.slice(0, definition.file.lastIndexOf('/') + 1)
            : '';

          loadSource
            .then(source => new Promise(parseResolve => {
              this.gltfLoader.parse(
                source,
                basePath,
                gltf => parseResolve(gltf.scene),
                () => parseResolve(null)
              );
            }))
            .then(scene => resolve(scene))
            .catch(() => resolve(null));
        };

        tryParse();
      });
    }
    return new Promise(resolve => {
      this.gltfLoader.load(
        definition.file,
        gltf => resolve(gltf.scene),
        undefined,
        () => resolve(null)
      );
    });
  }

  loadFBX(definition) {
    return new Promise(resolve => {
      this.fbxLoader.load(
        definition.file,
        object => resolve(object),
        undefined,
        () => resolve(null)
      );
    });
  }
}
