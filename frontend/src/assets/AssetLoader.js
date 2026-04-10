import * as THREE from 'three';
import { RGBELoader } from 'https://cdn.jsdelivr.net/npm/three@0.162.0/examples/jsm/loaders/RGBELoader.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.162.0/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'https://cdn.jsdelivr.net/npm/three@0.162.0/examples/jsm/loaders/FBXLoader.js';

function clampByte(value) {
  return Math.max(0, Math.min(255, value | 0));
}

function applyCanvasTextureSettings(texture, { repeat = 1, colorSpace = THREE.SRGBColorSpace } = {}) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.colorSpace = colorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function createCanvasPatternTexture(draw, size = 512, options = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  draw(ctx, size);
  return applyCanvasTextureSettings(new THREE.CanvasTexture(canvas), options);
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

function paintSpeckleField(ctx, size, palette, {
  contrast = 0.22,
  grain = 8200,
  streaks = 0,
  streakColor = 'rgba(255,255,255,0.08)',
  blotches = 90,
} = {}) {
  ctx.fillStyle = palette[0];
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < blotches; i++) {
    const radius = size * (0.03 + Math.random() * 0.11);
    const x = Math.random() * size;
    const y = Math.random() * size;
    const gradient = ctx.createRadialGradient(x, y, radius * 0.1, x, y, radius);
    gradient.addColorStop(0, palette[1 + (i % Math.max(1, palette.length - 1))]);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.globalAlpha = 0.18 + Math.random() * contrast;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  for (let i = 0; i < grain; i++) {
    const color = palette[Math.floor(Math.random() * palette.length)];
    const alpha = 0.08 + Math.random() * contrast;
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    const x = Math.random() * size;
    const y = Math.random() * size;
    const w = 1 + Math.random() * 3.2;
    const h = 1 + Math.random() * 3.2;
    ctx.fillRect(x, y, w, h);
  }

  ctx.globalAlpha = 0.14;
  ctx.strokeStyle = streakColor;
  for (let i = 0; i < streaks; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const len = size * (0.08 + Math.random() * 0.24);
    ctx.lineWidth = 1 + Math.random() * 2.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y + (Math.random() - 0.5) * 18);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export function createProceduralTerrainSet(kind, { repeat = 1 } = {}) {
  const definitions = {
    grass: {
      palette: ['#587842', '#6f8f4b', '#7ca95d', '#466336', '#88b56b'],
      options: { contrast: 0.18, grain: 9200, blotches: 110, streaks: 36, streakColor: 'rgba(180,220,150,0.12)' },
      roughness: 0.88,
    },
    dirt: {
      palette: ['#7a5b3d', '#8e6945', '#6a4d34', '#9e7d57', '#5a412b'],
      options: { contrast: 0.16, grain: 7600, blotches: 90, streaks: 22, streakColor: 'rgba(40,24,14,0.15)' },
      roughness: 0.92,
    },
    rock: {
      palette: ['#6f7478', '#8a8f93', '#555d63', '#9aa2a8', '#4b5056'],
      options: { contrast: 0.14, grain: 6800, blotches: 70, streaks: 26, streakColor: 'rgba(255,255,255,0.1)' },
      roughness: 0.8,
    },
    snow: {
      palette: ['#f7fbff', '#e4edf6', '#d6e0ea', '#ffffff', '#c8d4e0'],
      options: { contrast: 0.1, grain: 5200, blotches: 60, streaks: 30, streakColor: 'rgba(170,190,210,0.18)' },
      roughness: 0.7,
    },
    sand: {
      palette: ['#b89963', '#c8ab72', '#d9bf87', '#9f804e', '#e1ca9a'],
      options: { contrast: 0.14, grain: 8200, blotches: 120, streaks: 46, streakColor: 'rgba(255,245,210,0.14)' },
      roughness: 0.95,
    },
    gravel: {
      palette: ['#77716a', '#8a837c', '#615b56', '#9d948a', '#504b47'],
      options: { contrast: 0.18, grain: 9600, blotches: 50, streaks: 0 },
      roughness: 0.9,
    },
    asphalt: {
      palette: ['#363d43', '#41484f', '#2b3137', '#545d66', '#24292e'],
      options: { contrast: 0.1, grain: 10500, blotches: 36, streaks: 90, streakColor: 'rgba(255,255,255,0.05)' },
      roughness: 0.84,
    },
    water: {
      palette: ['#2a7fb5', '#3c98cb', '#1f678e', '#57b7dd', '#15506f'],
      options: { contrast: 0.16, grain: 6200, blotches: 80, streaks: 120, streakColor: 'rgba(255,255,255,0.11)' },
      roughness: 0.18,
    },
  };

  const definition = definitions[kind] ?? definitions.grass;
  const color = createCanvasPatternTexture((ctx, size) => {
    paintSpeckleField(ctx, size, definition.palette, definition.options);
  }, 512, { repeat, colorSpace: THREE.SRGBColorSpace });

  const normal = createFlatNormalTexture(16);
  normal.repeat.set(repeat, repeat);
  const roughness = createScalarTexture(definition.roughness, 16);
  roughness.repeat.set(repeat, repeat);

  return { color, normal, roughness };
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
