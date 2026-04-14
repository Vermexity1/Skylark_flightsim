import { RENDER } from '../config.js';

export class Minimap {
  constructor(container, worldMgr) {
    this.worldMgr = worldMgr;
    this.SIZE = 180;
    this._expanded = false;
    this._lastState = null;
    this.WORLD_HALF = RENDER.TERRAIN_SIZE * 0.46;

    this._wrap = document.createElement('button');
    this._wrap.id = 'hud-minimap';
    this._wrap.type = 'button';
    Object.assign(this._wrap.style, {
      position: 'absolute',
      top: '88px',
      right: '26px',
      width: `${this.SIZE}px`,
      height: `${this.SIZE}px`,
      borderRadius: '50%',
      overflow: 'hidden',
      border: '1px solid rgba(167,225,255,0.28)',
      boxShadow: '0 18px 38px rgba(0,0,0,0.34), inset 0 0 20px rgba(0,0,0,0.26)',
      pointerEvents: 'auto',
      cursor: 'pointer',
      padding: '0',
      background: 'transparent',
    });

    this._canvas = document.createElement('canvas');
    this._canvas.width = this.SIZE;
    this._canvas.height = this.SIZE;
    Object.assign(this._canvas.style, { display: 'block' });
    this._wrap.appendChild(this._canvas);

    this._hdg = document.createElement('div');
    Object.assign(this._hdg.style, {
      position: 'absolute',
      top: '-20px',
      left: '50%',
      transform: 'translateX(-50%)',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '10px',
      fontWeight: '700',
      color: '#00e5ff',
      letterSpacing: '1px',
      background: 'rgba(0,0,0,0.6)',
      padding: '2px 6px',
      borderRadius: '4px',
      border: '1px solid rgba(0,229,255,0.2)',
      pointerEvents: 'none',
    });
    this._wrap.appendChild(this._hdg);

    this._nLabel = document.createElement('div');
    Object.assign(this._nLabel.style, {
      position: 'absolute',
      top: '2px',
      left: '50%',
      transform: 'translateX(-50%)',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '9px',
      color: 'rgba(0,229,255,0.5)',
      fontWeight: '700',
      pointerEvents: 'none',
    });
    this._nLabel.textContent = 'N';
    this._wrap.appendChild(this._nLabel);

    this._hint = document.createElement('div');
    Object.assign(this._hint.style, {
      position: 'absolute',
      bottom: '10px',
      left: '50%',
      transform: 'translateX(-50%)',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '8px',
      color: 'rgba(214,239,255,0.7)',
      letterSpacing: '1px',
      textTransform: 'uppercase',
      pointerEvents: 'none',
    });
    this._hint.textContent = 'Expand';
    this._wrap.appendChild(this._hint);

    this._overlay = document.createElement('div');
    Object.assign(this._overlay.style, {
      position: 'absolute',
      top: '72px',
      right: '18px',
      width: 'min(34vw, 520px)',
      minWidth: '360px',
      height: 'min(44vh, 380px)',
      padding: '14px',
      borderRadius: '22px',
      background: 'linear-gradient(180deg, rgba(6,18,30,0.92), rgba(5,12,24,0.82))',
      border: '1px solid rgba(130,214,255,0.18)',
      boxShadow: '0 30px 60px rgba(0,0,0,0.38)',
      backdropFilter: 'blur(14px)',
      display: 'none',
      pointerEvents: 'auto',
    });

    this._overlayHeader = document.createElement('div');
    Object.assign(this._overlayHeader.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      marginBottom: '12px',
      fontFamily: "'JetBrains Mono', monospace",
      color: '#dff4ff',
      fontSize: '11px',
      letterSpacing: '2px',
      textTransform: 'uppercase',
    });
    this._overlayHeader.innerHTML = `<span>World Map</span><span id="hud-map-location" style="color:rgba(130,214,255,0.78); font-size:10px;">Global</span>`;

    this._overlayCanvas = document.createElement('canvas');
    this._overlayCanvas.width = 920;
    this._overlayCanvas.height = 620;
    Object.assign(this._overlayCanvas.style, {
      width: '100%',
      height: 'calc(100% - 30px)',
      borderRadius: '16px',
      display: 'block',
      background: 'linear-gradient(180deg, rgba(18,36,54,0.7), rgba(6,12,20,0.92))',
    });

    this._overlay.append(this._overlayHeader, this._overlayCanvas);
    container.append(this._wrap, this._overlay);

    this._ctx = this._canvas.getContext('2d');
    this._overlayCtx = this._overlayCanvas.getContext('2d');
    this._overlayLabel = this._overlayHeader.querySelector('#hud-map-location');
    this._onResize = () => this._applyLayout();
    this._onClick = () => this.toggleExpanded();
    this._wrap.addEventListener('click', this._onClick);
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
    this._wrap.style.right = tiny ? '14px' : compact ? '18px' : '26px';
    this._wrap.style.top = tiny ? '72px' : compact ? '82px' : '88px';
    this._overlay.style.right = tiny ? '10px' : '18px';
    this._overlay.style.top = tiny ? '56px' : '72px';
    this._overlay.style.minWidth = tiny ? '300px' : '360px';
  }

  toggleExpanded(force = null) {
    this._expanded = typeof force === 'boolean' ? force : !this._expanded;
    this._overlay.style.display = this._expanded ? 'block' : 'none';
    if (this._lastState) this.update(this._lastState);
    return this._expanded;
  }

  _worldToOverlay(wx, wz, width, height, worldHalf) {
    return {
      x: ((wx + worldHalf) / (worldHalf * 2)) * width,
      y: ((wz + worldHalf) / (worldHalf * 2)) * height,
    };
  }

  _drawAirport(ctx, airport, width, height, worldHalf) {
    const point = this._worldToOverlay(airport.x, airport.z, width, height, worldHalf);
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.fillStyle = '#7ee6ff';
    ctx.strokeStyle = 'rgba(223,244,255,0.9)';
    ctx.lineWidth = 1.2;
    ctx.fillRect(-4, -10, 8, 20);
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(10, 0);
    ctx.stroke();
    ctx.restore();
    return point;
  }

  update(state) {
    if (!state) return;
    this._lastState = state;
    this._drawLocal(state);
    if (this._expanded) this._drawExpanded(state);
  }

  _drawLocal(state) {
    const ctx = this._ctx;
    const S = this.SIZE;
    const cx = S / 2;
    const cy = S / 2;
    const HALF = this.WORLD_HALF;
    const scale = (S * 0.44) / HALF;
    const toMap = (wx, wz) => ({
      x: cx + (wx - state.position.x) * scale,
      y: cy + (wz - state.position.z) * scale,
    });

    ctx.clearRect(0, 0, S, S);
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, S / 2);
    bg.addColorStop(0, 'rgba(0,15,35,0.92)');
    bg.addColorStop(1, 'rgba(0,5,15,0.97)');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(cx, cy, S / 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(0,229,255,0.06)';
    ctx.lineWidth = 1;
    [S * 0.2, S * 0.35, S * 0.45].forEach(r => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.beginPath();
    ctx.moveTo(cx, 4);
    ctx.lineTo(cx, S - 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(4, cy);
    ctx.lineTo(S - 4, cy);
    ctx.stroke();

    if (this.worldMgr?.rings?.length) {
      this.worldMgr.rings.forEach((ring, index) => {
        const mp = toMap(ring.position.x, ring.position.z);
        if (mp.x < 0 || mp.x > S || mp.y < 0 || mp.y > S) return;
        ctx.beginPath();
        ctx.arc(mp.x, mp.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = ring.passed
          ? 'rgba(80,80,80,0.6)'
          : index === this._nextRingIndex()
            ? 'rgba(255,255,0,0.9)'
            : 'rgba(0,255,130,0.7)';
        ctx.fill();
      });
    }

    const mapData = this.worldMgr?.getNavigationMapData?.();
    (mapData?.airports ?? []).forEach(airport => {
      const mp = toMap(airport.x, airport.z);
      if (mp.x < -8 || mp.x > S + 8 || mp.y < -8 || mp.y > S + 8) return;
      ctx.fillStyle = 'rgba(126,230,255,0.88)';
      ctx.fillRect(mp.x - 2, mp.y - 6, 4, 12);
      ctx.fillRect(mp.x - 6, mp.y - 1, 12, 2);
    });

    const hdgRad = (state.heading * Math.PI) / 180;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(hdgRad);
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 7);
    ctx.lineTo(0, 4);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fillStyle = '#00e5ff';
    ctx.fill();
    ctx.shadowBlur = 0;
    const vLen = Math.min(state.speed * 0.08, 24);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -vLen);
    ctx.strokeStyle = 'rgba(0,255,136,0.7)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    ctx.globalCompositeOperation = 'destination-in';
    ctx.beginPath();
    ctx.arc(cx, cy, S / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    const vig = ctx.createRadialGradient(cx, cy, S * 0.3, cx, cy, S / 2);
    vig.addColorStop(0, 'transparent');
    vig.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vig;
    ctx.beginPath();
    ctx.arc(cx, cy, S / 2, 0, Math.PI * 2);
    ctx.fill();

    this._hdg.textContent = `${Math.round(state.heading).toString().padStart(3, '0')}°`;
  }

  _drawExpanded(state) {
    const ctx = this._overlayCtx;
    const width = this._overlayCanvas.width;
    const height = this._overlayCanvas.height;
    const mapData = this.worldMgr?.getNavigationMapData?.() ?? {};
    const worldHalf = mapData.worldHalf ?? this.WORLD_HALF;

    ctx.clearRect(0, 0, width, height);
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, '#245d92');
    sky.addColorStop(1, '#0c1624');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = 'rgba(76, 120, 72, 0.88)';
    ctx.fillRect(26, 26, width - 52, height - 52);

    const waterBands = mapData.envKey === 'coastal'
      ? [{ x: -worldHalf * 0.5, z: -worldHalf * 0.55, w: worldHalf * 1.05, h: worldHalf * 0.7 }]
      : mapData.envKey === 'city'
        ? [{ x: worldHalf * 0.24, z: -worldHalf * 0.2, w: worldHalf * 0.38, h: worldHalf * 0.48 }]
        : [];
    waterBands.forEach(band => {
      const topLeft = this._worldToOverlay(band.x, band.z, width, height, worldHalf);
      const bottomRight = this._worldToOverlay(band.x + band.w, band.z + band.h, width, height, worldHalf);
      ctx.fillStyle = 'rgba(35, 97, 155, 0.88)';
      ctx.fillRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
    });

    ctx.strokeStyle = 'rgba(223,244,255,0.18)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      const x = (width / 5) * i;
      const y = (height / 5) * i;
      ctx.beginPath();
      ctx.moveTo(x, 22);
      ctx.lineTo(x, height - 22);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(22, y);
      ctx.lineTo(width - 22, y);
      ctx.stroke();
    }

    (mapData.regions ?? []).forEach(region => {
      const center = this._worldToOverlay(region.x, region.z, width, height, worldHalf);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(center.x, center.y, Math.max(28, (region.radius / (worldHalf * 2)) * width), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = "12px 'JetBrains Mono'";
      ctx.fillText(region.locality, center.x + 12, center.y - 10);
    });

    (mapData.settlements ?? []).forEach(settlement => {
      const point = this._worldToOverlay(settlement.x, settlement.z, width, height, worldHalf);
      ctx.fillStyle = settlement.type === 'city' ? '#ffe082' : '#b4efff';
      ctx.beginPath();
      ctx.arc(point.x, point.y, settlement.type === 'city' ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(230,243,255,0.92)';
      ctx.font = "11px 'JetBrains Mono'";
      ctx.fillText(settlement.name, point.x + 10, point.y - 6);
    });

    (mapData.airports ?? []).forEach(airport => {
      const point = this._drawAirport(ctx, airport, width, height, worldHalf);
      ctx.fillStyle = '#f4fbff';
      ctx.font = "12px 'JetBrains Mono'";
      ctx.fillText(airport.name, point.x + 12, point.y + 6);
    });

    const aircraft = this._worldToOverlay(state.position.x, state.position.z, width, height, worldHalf);
    ctx.save();
    ctx.translate(aircraft.x, aircraft.y);
    ctx.rotate((state.heading * Math.PI) / 180);
    ctx.fillStyle = '#7effd4';
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(9, 10);
    ctx.lineTo(0, 4);
    ctx.lineTo(-9, 10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    this._overlayLabel.textContent = state.locationLabel ?? mapData.country ?? mapData.worldName ?? 'World';
  }

  _nextRingIndex() {
    if (!this.worldMgr) return -1;
    for (let i = 0; i < this.worldMgr.rings.length; i++) {
      if (!this.worldMgr.rings[i].passed) return i;
    }
    return -1;
  }

  show() {
    this._wrap.style.display = 'block';
  }

  hide() {
    this._wrap.style.display = 'none';
    this._overlay.style.display = 'none';
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    this._wrap.removeEventListener('click', this._onClick);
    this._wrap.remove();
    this._overlay.remove();
  }
}
