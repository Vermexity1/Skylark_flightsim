// ============================================================
// Minimap — Canvas 2D overhead view
// Shows aircraft position, heading, challenge rings, border
// ============================================================

export class Minimap {
  /**
   * @param {HTMLElement} container  Parent element to inject into
   * @param {object}      worldMgr   WorldManager reference (for rings)
   */
  constructor(container, worldMgr) {
    this.worldMgr = worldMgr;
    this.SIZE     = 180; // px
    this.SCALE    = 1 / 120; // world units → map pixels  (7500 world u → 62.5 px at 120 scale... tweak)
    this.WORLD_HALF = 7500;

    // Outer wrapper
    this._wrap = document.createElement('div');
    this._wrap.id = 'hud-minimap';
    Object.assign(this._wrap.style, {
      position: 'absolute',
      top: '86px',
      right: '28px',
      width:  this.SIZE + 'px',
      height: this.SIZE + 'px',
      borderRadius: '50%',
      overflow: 'hidden',
      border: '1px solid rgba(167,225,255,0.28)',
      boxShadow: '0 18px 38px rgba(0,0,0,0.34), inset 0 0 20px rgba(0,0,0,0.26)',
      pointerEvents: 'none',
    });

    // BG canvas
    this._canvas = document.createElement('canvas');
    this._canvas.width  = this.SIZE;
    this._canvas.height = this.SIZE;
    Object.assign(this._canvas.style, { display: 'block' });
    this._wrap.appendChild(this._canvas);

    // Heading badge above map
    this._hdg = document.createElement('div');
    Object.assign(this._hdg.style, {
      position: 'absolute',
      top: '-20px', left: '50%', transform: 'translateX(-50%)',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '10px', fontWeight: '700',
      color: '#00e5ff', letterSpacing: '1px',
      background: 'rgba(0,0,0,0.6)',
      padding: '2px 6px', borderRadius: '4px',
      border: '1px solid rgba(0,229,255,0.2)',
    });
    this._wrap.appendChild(this._hdg);

    // N marker
    this._nLabel = document.createElement('div');
    Object.assign(this._nLabel.style, {
      position: 'absolute', top: '2px', left: '50%', transform: 'translateX(-50%)',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '9px', color: 'rgba(0,229,255,0.5)', fontWeight: '700',
    });
    this._nLabel.textContent = 'N';
    this._wrap.appendChild(this._nLabel);

    container.appendChild(this._wrap);
    this._ctx = this._canvas.getContext('2d');
    this._onResize = () => this._applyLayout();
    window.addEventListener('resize', this._onResize);
    this._applyLayout();
  }

  _applyLayout() {
    const compact = window.innerWidth < 1180 || window.innerHeight < 760;
    const tiny = window.innerWidth < 900 || window.innerHeight < 680;
    const size = tiny ? 104 : compact ? 118 : 144;
    this.SIZE = size;
    this._canvas.width = size;
    this._canvas.height = size;
    this._wrap.style.width = `${size}px`;
    this._wrap.style.height = `${size}px`;
    this._wrap.style.left = 'auto';
    this._wrap.style.bottom = 'auto';
    this._wrap.style.right = tiny ? '14px' : compact ? '18px' : '26px';
    this._wrap.style.top = tiny ? '72px' : compact ? '82px' : '88px';
    this._hdg.style.top = tiny ? '-18px' : '-20px';
    this._hdg.style.fontSize = tiny ? '9px' : '10px';
  }

  // ── Update each frame ──────────────────────────────────────
  update(state) {
    if (!state) return;
    const ctx  = this._ctx;
    const S    = this.SIZE;
    const cx   = S / 2, cy = S / 2;
    const HALF = this.WORLD_HALF;
    const scale = (S * 0.44) / HALF; // world → canvas px

    // World-to-map (centred on aircraft)
    const toMap = (wx, wz) => ({
      x: cx + (wx - state.position.x) * scale,
      y: cy + (wz - state.position.z) * scale,
    });

    // ── Background ─────────────────────────────────────────
    ctx.clearRect(0, 0, S, S);

    // Radar sweep background
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, S / 2);
    bg.addColorStop(0, 'rgba(0,15,35,0.92)');
    bg.addColorStop(1, 'rgba(0,5,15,0.97)');
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.arc(cx, cy, S / 2, 0, Math.PI * 2); ctx.fill();

    // Grid rings
    ctx.strokeStyle = 'rgba(0,229,255,0.06)';
    ctx.lineWidth = 1;
    [S * 0.2, S * 0.35, S * 0.45].forEach(r => {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    });

    // Cross-hairs
    ctx.strokeStyle = 'rgba(0,229,255,0.07)';
    ctx.beginPath(); ctx.moveTo(cx, 4); ctx.lineTo(cx, S - 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, cy); ctx.lineTo(S - 4, cy); ctx.stroke();

    // ── World boundary ─────────────────────────────────────
    const bx = cx - HALF * scale, by = cy - HALF * scale;
    const bw = HALF * 2 * scale, bh = HALF * 2 * scale;
    ctx.strokeStyle = 'rgba(0,229,255,0.15)';
    ctx.lineWidth   = 1;
    ctx.strokeRect(bx, by, bw, bh);

    // ── Challenge rings ─────────────────────────────────────
    if (this.worldMgr && this.worldMgr.rings.length > 0) {
      this.worldMgr.rings.forEach((ring, i) => {
        const mp = toMap(ring.position.x, ring.position.z);
        if (mp.x < 0 || mp.x > S || mp.y < 0 || mp.y > S) return;
        const passed = ring.passed;
        ctx.beginPath();
        ctx.arc(mp.x, mp.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = passed
          ? 'rgba(80,80,80,0.6)'
          : i === this._nextRingIndex()
          ? 'rgba(255,255,0,0.9)'
          : 'rgba(0,255,130,0.7)';
        ctx.fill();

        // Ring number
        ctx.fillStyle = passed ? 'rgba(80,80,80,0.6)' : '#fff';
        ctx.font = '7px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(i + 1, mp.x, mp.y);
      });
    }

    // ── Aircraft triangle ───────────────────────────────────
    const hdgRad = (state.heading * Math.PI) / 180;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(hdgRad);

    // Glow
    ctx.shadowColor  = '#00e5ff';
    ctx.shadowBlur   = 10;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 7);
    ctx.lineTo(0, 4);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fillStyle = '#00e5ff';
    ctx.fill();

    // Speed vector line
    ctx.shadowBlur  = 0;
    const vLen = Math.min(state.speed * 0.08, 24);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -vLen);
    ctx.strokeStyle = 'rgba(0,255,136,0.7)';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    ctx.restore();

    // ── Clip to circle ─────────────────────────────────────
    ctx.globalCompositeOperation = 'destination-in';
    ctx.beginPath(); ctx.arc(cx, cy, S / 2, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // ── Vignette ───────────────────────────────────────────
    const vig = ctx.createRadialGradient(cx, cy, S * 0.3, cx, cy, S / 2);
    vig.addColorStop(0, 'transparent');
    vig.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vig;
    ctx.beginPath(); ctx.arc(cx, cy, S / 2, 0, Math.PI * 2); ctx.fill();

    // ── Heading badge ───────────────────────────────────────
    this._hdg.textContent = Math.round(state.heading).toString().padStart(3, '0') + '°';
  }

  _nextRingIndex() {
    if (!this.worldMgr) return -1;
    for (let i = 0; i < this.worldMgr.rings.length; i++) {
      if (!this.worldMgr.rings[i].passed) return i;
    }
    return -1;
  }

  show() { this._wrap.style.display = 'block'; }
  hide() { this._wrap.style.display = 'none';  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    this._wrap.remove();
  }
}
