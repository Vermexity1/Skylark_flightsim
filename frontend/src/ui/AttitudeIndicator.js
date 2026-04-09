// ============================================================
// Attitude Indicator (Artificial Horizon)
// Shows pitch (up/down tilt) and bank angle (roll)
// Classic flight sim instrument drawn on 2D canvas
// ============================================================

export class AttitudeIndicator {
  constructor(container) {
    this.SIZE = 130;

    this._wrap = document.createElement('div');
    this._wrap.id = 'hud-attitude';
    Object.assign(this._wrap.style, {
      position:     'absolute',
      top:          '258px',
      right:        '42px',
      width:        this.SIZE + 'px',
      height:       this.SIZE + 'px',
      borderRadius: '50%',
      overflow:     'hidden',
      border:       '1px solid rgba(167,225,255,0.24)',
      boxShadow:    '0 18px 34px rgba(0,0,0,0.34), inset 0 0 14px rgba(0,0,0,0.28)',
      pointerEvents: 'none',
    });

    this._canvas = document.createElement('canvas');
    this._canvas.width  = this.SIZE;
    this._canvas.height = this.SIZE;
    this._canvas.style.display = 'block';
    this._wrap.appendChild(this._canvas);

    // Label
    const label = document.createElement('div');
    Object.assign(label.style, {
      position: 'absolute', top: '4px', left: '50%', transform: 'translateX(-50%)',
      fontFamily: "'JetBrains Mono', monospace", fontSize: '8px',
      color: 'rgba(0,229,255,0.5)', letterSpacing: '1.5px', fontWeight: '700',
    });
    label.textContent = 'ATT';
    this._wrap.appendChild(label);

    container.appendChild(this._wrap);
    this._ctx = this._canvas.getContext('2d');
    this._onResize = () => this._applyLayout();
    window.addEventListener('resize', this._onResize);
    this._applyLayout();
  }

  _applyLayout() {
    const compact = window.innerWidth < 1180 || window.innerHeight < 760;
    const tiny = window.innerWidth < 900 || window.innerHeight < 680;
    this.SIZE = tiny ? 94 : compact ? 104 : 116;
    this._canvas.width = this.SIZE;
    this._canvas.height = this.SIZE;
    this._wrap.style.width = `${this.SIZE}px`;
    this._wrap.style.height = `${this.SIZE}px`;
    this._wrap.style.left = 'auto';
    this._wrap.style.bottom = 'auto';
    this._wrap.style.right = tiny ? '18px' : compact ? '22px' : '26px';
    this._wrap.style.top = tiny ? '194px' : compact ? '214px' : '248px';
  }

  // ── Update ─────────────────────────────────────────────────
  update(state) {
    if (!state) return;

    // Extract pitch and roll from quaternion
    const { quaternion } = state;
    const pitch = this._getPitch(quaternion);   // radians, positive = nose up
    const roll  = this._getRoll(quaternion);    // radians, positive = right bank

    this._draw(pitch, roll);
  }

  _getPitch(q) {
    // From quaternion to Euler pitch (X axis rotation in body frame)
    const sinP = 2 * (q.w * q.x - q.y * q.z);
    return Math.asin(Math.max(-1, Math.min(1, sinP)));
  }

  _getRoll(q) {
    const sinR_cosP = 2 * (q.w * q.z + q.x * q.y);
    const cosR_cosP = 1 - 2 * (q.x * q.x + q.z * q.z);
    return Math.atan2(sinR_cosP, cosR_cosP);
  }

  _draw(pitch, roll) {
    const ctx = this._ctx;
    const S   = this.SIZE;
    const cx  = S / 2, cy = S / 2;
    const R   = S / 2 - 1;

    ctx.clearRect(0, 0, S, S);

    ctx.save();
    // Clip to circle
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();

    // ── Rotate for bank angle ─────────────────────────────
    ctx.translate(cx, cy);
    ctx.rotate(-roll);   // canvas rotate = opposite of aircraft roll
    ctx.translate(-cx, -cy);

    // ── Sky (upper half, shifts with pitch) ───────────────
    const pitchPx = pitch * (S / 1.1); // pitch in pixels (scale factor)
    const horizY  = cy + pitchPx;

    // Sky gradient
    const skyGrad = ctx.createLinearGradient(0, 0, 0, horizY);
    skyGrad.addColorStop(0,   '#0a2a55');
    skyGrad.addColorStop(1,   '#1a5599');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, S, Math.max(0, horizY));

    // Ground gradient
    const gndGrad = ctx.createLinearGradient(0, horizY, 0, S);
    gndGrad.addColorStop(0, '#5c3a1e');
    gndGrad.addColorStop(1, '#3a2010');
    ctx.fillStyle = gndGrad;
    ctx.fillRect(0, Math.min(S, horizY), S, S);

    // ── Horizon line ──────────────────────────────────────
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(0, horizY);
    ctx.lineTo(S, horizY);
    ctx.stroke();

    // Pitch ladder lines
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth   = 1;
    ctx.font        = '8px JetBrains Mono, monospace';
    ctx.fillStyle   = 'rgba(255,255,255,0.8)';
    ctx.textAlign   = 'left';
    ctx.textBaseline = 'middle';

    [-30,-20,-10,10,20,30].forEach(deg => {
      const lineY = horizY - (deg * S) / 110;
      const w     = deg % 20 === 0 ? 28 : 18;
      ctx.beginPath();
      ctx.moveTo(cx - w, lineY);
      ctx.lineTo(cx + w, lineY);
      ctx.stroke();
      if (deg % 10 === 0) {
        ctx.fillText(Math.abs(deg), cx + w + 3, lineY);
      }
    });

    ctx.restore();

    // ── Fixed aircraft symbol (always centre) ────────────
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 2.5;
    // Wings
    ctx.beginPath();
    ctx.moveTo(cx - 28, cy);
    ctx.lineTo(cx - 8, cy);
    ctx.lineTo(cx - 4, cy + 4);
    ctx.moveTo(cx + 28, cy);
    ctx.lineTo(cx + 8, cy);
    ctx.lineTo(cx + 4, cy + 4);
    ctx.stroke();
    // Centre dot
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // ── Bank angle arc ────────────────────────────────────
    const bankDeg = (roll * 180) / Math.PI;
    // Triangle pointer at top shows bank
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-roll);
    ctx.beginPath();
    ctx.moveTo(0, -R + 4);
    ctx.lineTo(-5, -R + 14);
    ctx.lineTo(5,  -R + 14);
    ctx.closePath();
    ctx.fillStyle = bankDeg !== 0 ? '#ffdd00' : '#ffffff';
    ctx.fill();
    ctx.restore();

    // ── Clip circle rim ───────────────────────────────────
    ctx.strokeStyle = 'rgba(0,229,255,0.3)';
    ctx.lineWidth   = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  }

  show() { this._wrap.style.display = 'block'; }
  hide() { this._wrap.style.display = 'none';  }
  destroy() {
    window.removeEventListener('resize', this._onResize);
    this._wrap.remove();
  }
}
