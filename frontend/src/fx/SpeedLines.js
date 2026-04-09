// ============================================================
// Speed Lines — Canvas 2D radial streak overlay
// Renders at high speeds to convey velocity sensation
// Pure canvas, zero GPU geometry cost
// ============================================================

export class SpeedLines {
  constructor(container) {
    this._canvas = document.createElement('canvas');
    Object.assign(this._canvas.style, {
      position: 'fixed', inset: '0',
      width: '100%', height: '100%',
      pointerEvents: 'none',
      zIndex: '15',
      mixBlendMode: 'screen',
    });
    container.appendChild(this._canvas);

    this._ctx      = this._canvas.getContext('2d');
    this._lines    = [];
    this._maxLines = 80;
    this._intensity = 0;   // 0..1 driven by speed

    // Pre-generate line angles for stability
    for (let i = 0; i < this._maxLines; i++) {
      this._lines.push({
        angle:  (i / this._maxLines) * Math.PI * 2 + (Math.random() - 0.5) * 0.12,
        r0:     0.05 + Math.random() * 0.15,  // start radius (as fraction of screen half)
        r1:     0.25 + Math.random() * 0.40,  // end radius
        width:  0.4 + Math.random() * 1.0,
        phase:  Math.random(),               // for flicker
      });
    }

    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
    this._onResize();
  }

  _onResize() {
    this._canvas.width  = window.innerWidth;
    this._canvas.height = window.innerHeight;
  }

  /**
   * Call each frame with current speed fraction (0..1 where 1 = maxSpeed).
   * Lines appear at >0.65 and reach full intensity at 0.9+
   */
  update(speedFraction, dt) {
    const ctx = this._ctx;
    const W   = this._canvas.width;
    const H   = this._canvas.height;
    const cx  = W / 2, cy = H / 2;
    const R   = Math.hypot(cx, cy);

    // Target intensity
    const target = speedFraction > 0.65
      ? Math.pow((speedFraction - 0.65) / 0.35, 1.6)
      : 0;

    // Smooth transition
    const lerpRate = target > this._intensity ? 3 : 5;
    this._intensity += (target - this._intensity) * Math.min(1, lerpRate * dt);

    ctx.clearRect(0, 0, W, H);

    if (this._intensity < 0.01) return;

    const t    = performance.now() * 0.001;
    const intI = this._intensity;

    for (const line of this._lines) {
      // Subtle flicker
      const flicker = 0.7 + 0.3 * Math.sin(t * 6.28 + line.phase * 20);
      const alpha   = intI * flicker * 0.55;
      if (alpha < 0.01) continue;

      const cos = Math.cos(line.angle);
      const sin = Math.sin(line.angle);

      const x0 = cx + cos * line.r0 * R;
      const y0 = cy + sin * line.r0 * R;
      const x1 = cx + cos * line.r1 * R * (0.8 + intI * 0.5);
      const y1 = cy + sin * line.r1 * R * (0.8 + intI * 0.5);

      const grad = ctx.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, `rgba(180,220,255,${(alpha * 0.2).toFixed(3)})`);
      grad.addColorStop(0.4, `rgba(200,230,255,${alpha.toFixed(3)})`);
      grad.addColorStop(1, `rgba(160,210,255,0)`);

      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.strokeStyle = grad;
      ctx.lineWidth   = line.width * (0.6 + intI * 0.8);
      ctx.stroke();
    }
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    this._canvas.remove();
  }
}
