import * as THREE from 'three';
import { ASSET_SOURCES } from '../assets/AssetCatalog.js';

function makeFallbackTexture(stops) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, size * 0.08, size / 2, size / 2, size * 0.48);
  stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class CrashEffectSystem {
  constructor(scene) {
    this.scene = scene;
    this.loader = new THREE.TextureLoader();
    this.activeEffects = [];
    this.textures = {
      explosion: this._loadTexture(
        ASSET_SOURCES.effects.explosion.file,
        makeFallbackTexture([
          [0, 'rgba(255,255,220,1)'],
          [0.2, 'rgba(255,210,80,0.95)'],
          [0.52, 'rgba(255,90,25,0.8)'],
          [1, 'rgba(20,0,0,0)'],
        ])
      ),
      smoke: this._loadTexture(
        ASSET_SOURCES.effects.smoke.file,
        makeFallbackTexture([
          [0, 'rgba(210,220,225,0.55)'],
          [0.45, 'rgba(70,76,84,0.44)'],
          [1, 'rgba(0,0,0,0)'],
        ])
      ),
      fire: this._loadTexture(
        ASSET_SOURCES.effects.explosion.file,
        makeFallbackTexture([
          [0, 'rgba(255,255,240,1)'],
          [0.24, 'rgba(255,220,90,0.96)'],
          [0.6, 'rgba(255,110,20,0.86)'],
          [1, 'rgba(20,0,0,0)'],
        ])
      ),
    };
  }

  _loadTexture(url, fallback) {
    const texture = fallback;
    this.loader.load(
      url,
      loaded => {
        loaded.colorSpace = THREE.SRGBColorSpace;
        loaded.needsUpdate = true;
        texture.image = loaded.image;
        texture.needsUpdate = true;
      },
      undefined,
      () => {}
    );
    return texture;
  }

  triggerImpact(position, intensity = 1) {
    const group = new THREE.Group();
    group.position.copy(position);
    const sparks = [];
    const smokePuffs = [];
    const debris = [];

    const burst = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.textures.explosion,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        color: 0xffffff,
      })
    );
    burst.scale.setScalar(18 * intensity);
    group.add(burst);

    const fire = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.textures.fire,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        color: new THREE.Color(1, 0.92, 0.85),
      })
    );
    fire.position.y = 1.5;
    fire.scale.setScalar(9 * intensity);
    group.add(fire);

    const smoke = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.textures.smoke,
        transparent: true,
        depthWrite: false,
        color: 0xb8c0c8,
        opacity: 0.72,
      })
    );
    smoke.position.y = 2.5;
    smoke.scale.setScalar(12 * intensity);
    group.add(smoke);

    const shockwave = new THREE.Mesh(
      new THREE.RingGeometry(1.8, 3.8, 40),
      new THREE.MeshBasicMaterial({
        color: 0xffd6a2,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
    );
    shockwave.rotation.x = -Math.PI / 2;
    shockwave.position.y = 0.4;
    shockwave.scale.setScalar(0.2);
    group.add(shockwave);

    const light = new THREE.PointLight(0xff8a3a, 2.6 * intensity, 120 * intensity, 2);
    light.position.y = 3;
    group.add(light);

    const sparkMaterial = new THREE.MeshBasicMaterial({ color: 0xffb45a });
    const debrisMaterial = new THREE.MeshStandardMaterial({
      color: 0x5b636b,
      roughness: 0.92,
      metalness: 0.16,
    });
    const puffMaterial = new THREE.MeshStandardMaterial({
      color: 0x4c555d,
      roughness: 1,
      metalness: 0,
      transparent: true,
      opacity: 0.78,
    });
    for (let i = 0; i < 14; i++) {
      const spark = new THREE.Mesh(new THREE.SphereGeometry(0.18 + Math.random() * 0.16, 6, 6), sparkMaterial.clone());
      spark.position.set((Math.random() - 0.5) * 2.2, 0.8 + Math.random() * 1.6, (Math.random() - 0.5) * 2.2);
      spark.userData.velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 26,
        12 + Math.random() * 18,
        (Math.random() - 0.5) * 26
      ).multiplyScalar(intensity);
      sparks.push(spark);
      group.add(spark);
    }
    for (let i = 0; i < 5; i++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(1.1 + Math.random() * 0.6, 8, 8), puffMaterial.clone());
      puff.position.set((Math.random() - 0.5) * 1.8, 1.4 + i * 1.1, (Math.random() - 0.5) * 1.8);
      puff.userData.rise = 1.4 + Math.random() * 1.2;
      smokePuffs.push(puff);
      group.add(puff);
    }
    for (let i = 0; i < 12; i++) {
      const chunk = new THREE.Mesh(
        new THREE.BoxGeometry(0.28 + Math.random() * 0.42, 0.18 + Math.random() * 0.2, 0.3 + Math.random() * 0.54),
        debrisMaterial.clone()
      );
      chunk.position.set((Math.random() - 0.5) * 2.4, 0.8 + Math.random() * 1.2, (Math.random() - 0.5) * 2.4);
      chunk.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      chunk.userData.velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 18,
        8 + Math.random() * 16,
        (Math.random() - 0.5) * 18
      ).multiplyScalar(intensity);
      chunk.userData.spin = new THREE.Vector3(
        (Math.random() - 0.5) * 9,
        (Math.random() - 0.5) * 9,
        (Math.random() - 0.5) * 9
      );
      debris.push(chunk);
      group.add(chunk);
    }

    this.scene.add(group);
    this.activeEffects.push({
      group,
      burst,
      fire,
      smoke,
      light,
      shockwave,
      sparks,
      debris,
      smokePuffs,
      elapsed: 0,
      duration: 2.8,
      intensity,
    });
  }

  update(dt) {
    for (let i = this.activeEffects.length - 1; i >= 0; i--) {
      const fx = this.activeEffects[i];
      fx.elapsed += dt;
      const t = fx.elapsed / fx.duration;
      const burstT = Math.min(1, t / 0.35);

      fx.burst.scale.setScalar(THREE.MathUtils.lerp(18, 68, burstT) * fx.intensity);
      fx.burst.material.opacity = THREE.MathUtils.lerp(1, 0, burstT);

      fx.fire.position.y += dt * 4.5;
      fx.fire.scale.setScalar(THREE.MathUtils.lerp(9, 24, Math.min(1, t / 0.65)) * fx.intensity);
      fx.fire.material.opacity = Math.max(0, 0.95 - t * 1.4);

      fx.smoke.position.y += dt * 7.5;
      fx.smoke.scale.setScalar(THREE.MathUtils.lerp(12, 52, t) * fx.intensity);
      fx.smoke.material.opacity = Math.max(0, 0.75 - t * 0.65);
      fx.shockwave.scale.setScalar(THREE.MathUtils.lerp(0.2, 9.5, Math.min(1, t / 0.26)));
      fx.shockwave.material.opacity = Math.max(0, 0.55 - t * 1.6);

      fx.sparks.forEach((spark, index) => {
        spark.userData.velocity.y -= dt * 28;
        spark.position.addScaledVector(spark.userData.velocity, dt);
        spark.material.opacity = Math.max(0, 1 - t * 1.6 - index * 0.03);
        spark.scale.setScalar(Math.max(0.18, 1 - t * 1.2));
      });

      fx.debris.forEach(chunk => {
        chunk.userData.velocity.y -= dt * 22;
        chunk.position.addScaledVector(chunk.userData.velocity, dt);
        chunk.rotation.x += chunk.userData.spin.x * dt;
        chunk.rotation.y += chunk.userData.spin.y * dt;
        chunk.rotation.z += chunk.userData.spin.z * dt;
      });

      fx.smokePuffs.forEach((puff, index) => {
        puff.position.y += dt * puff.userData.rise;
        puff.position.x += dt * (0.8 + index * 0.2);
        puff.position.z += dt * ((index % 2 === 0 ? 1 : -1) * 0.5);
        puff.scale.setScalar(1 + t * (2.2 + index * 0.15));
        puff.material.opacity = Math.max(0, 0.72 - t * 0.48 - index * 0.04);
      });

      fx.light.intensity = Math.max(0, (2.6 - t * 3.1) * fx.intensity);

      if (fx.elapsed >= fx.duration) {
        fx.group.traverse(node => {
          node.material?.dispose?.();
        });
        this.scene.remove(fx.group);
        this.activeEffects.splice(i, 1);
      }
    }
  }

  destroy() {
    this.activeEffects.forEach(fx => {
      fx.group.traverse(node => {
        node.material?.dispose?.();
      });
      this.scene.remove(fx.group);
    });
    this.activeEffects = [];
  }
}
