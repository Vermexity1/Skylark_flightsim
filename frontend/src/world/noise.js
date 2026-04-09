// ============================================================
// Simplex / Perlin-style Noise — terrain generation
// ============================================================

export class Noise {
  constructor(seed = 0) {
    this.p = new Uint8Array(512);
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;
    // Seeded shuffle
    let s = seed;
    for (let i = 255; i > 0; i--) {
      s = (s * 16807 + 0) % 2147483647;
      const j = ((s >>> 0) % (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    for (let i = 0; i < 512; i++) this.p[i] = perm[i & 255];
  }

  fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  lerp(a, b, t) { return a + t * (b - a); }

  grad(hash, x, y, z) {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  }

  /** Classic 3D Perlin noise, returns [-1, 1] */
  noise3(x, y, z) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);
    const u = this.fade(x), v = this.fade(y), w = this.fade(z);
    const p = this.p;
    const A = p[X]+Y, AA = p[A]+Z, AB = p[A+1]+Z;
    const B = p[X+1]+Y, BA = p[B]+Z, BB = p[B+1]+Z;
    return this.lerp(
      this.lerp(
        this.lerp(this.grad(p[AA],   x,   y,   z  ), this.grad(p[BA],   x-1, y,   z  ), u),
        this.lerp(this.grad(p[AB],   x,   y-1, z  ), this.grad(p[BB],   x-1, y-1, z  ), u), v),
      this.lerp(
        this.lerp(this.grad(p[AA+1], x,   y,   z-1), this.grad(p[BA+1], x-1, y,   z-1), u),
        this.lerp(this.grad(p[AB+1], x,   y-1, z-1), this.grad(p[BB+1], x-1, y-1, z-1), u), v), w);
  }

  /** 2D convenience — samples the xz plane */
  get(x, z) { return this.noise3(x, 0, z); }

  /**
   * Fractal Brownian Motion — stacks octaves for realistic terrain.
   * Returns approximately [-1, 1].
   */
  fbm(x, z, octaves = 6, lacunarity = 2.0, gain = 0.5) {
    let value = 0, amplitude = 0.5, frequency = 1, max = 0;
    for (let i = 0; i < octaves; i++) {
      value     += this.get(x * frequency, z * frequency) * amplitude;
      max       += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return value / max;
  }
}
