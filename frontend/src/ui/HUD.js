import { Minimap } from './Minimap.js';
import { AttitudeIndicator } from './AttitudeIndicator.js';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const mapRange = (v, inMin, inMax, outMin, outMax) => {
  const t = clamp((v - inMin) / Math.max(0.0001, inMax - inMin), 0, 1);
  return outMin + (outMax - outMin) * t;
};

export class HUD {
  constructor(container, worldMgr = null) {
    this.container = container;
    this._worldMgr = worldMgr;
    this._el = {};
    this._visible = true;
    this._helpVisible = false;
    this._advancedMode = false;
    this._build();
    this._minimap = new Minimap(container, worldMgr);
    this._attitude = new AttitudeIndicator(container);
    this._minimap.hide();
    this._attitude.hide();
    this._onResize = () => this.setAdvancedMode(this._advancedMode);
    window.addEventListener('resize', this._onResize);
  }

  _build() {
    this.container.insertAdjacentHTML('beforeend', `
      <style id="hud-layout-style">
        #hud-root{position:fixed;inset:0;z-index:10;pointer-events:none;color:#eef7ff;font-family:'Outfit',sans-serif;text-shadow:0 1px 10px rgba(0,0,0,.28)}
        #hud-root[data-help='on']>*:not(#hud-help){display:none!important}
        .hud-glass{background:none;border:none;backdrop-filter:none;box-shadow:none}
        #hud-title{position:absolute;top:138px;left:22px;max-width:148px}
        #hud-aircraft-name{font-size:11px;font-weight:700;letter-spacing:2.1px;text-transform:uppercase}
        #hud-game-mode{margin-top:5px;font-size:8px;letter-spacing:1.8px;color:rgba(221,235,248,.72);text-transform:uppercase}
        #hud-statusline{display:none}
        #hud-toprail{position:absolute;top:18px;left:50%;transform:translateX(-50%);display:flex;flex-wrap:wrap;justify-content:center;gap:6px 10px;align-items:flex-end;padding:0 12px 10px;border-radius:0;width:min(26vw,360px)}
        #hud-toprail::before{content:'';position:absolute;left:-28px;right:-28px;bottom:0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.34),transparent);opacity:.78}
        #hud-toprail>*{position:relative;z-index:1}
        .hud-chip{min-width:0;padding:0 2px;border-radius:0;text-align:center;font:10px 'JetBrains Mono',monospace;letter-spacing:2px;text-transform:uppercase;background:none;border:none}
        .hud-chip::after{content:'';display:block;height:1px;margin-top:6px;background:currentColor;opacity:.22;border-radius:999px}
        #hud-compass{position:absolute;top:18px;left:18px;width:112px;height:112px;border-radius:50%}
        #hud-compass::before,#hud-speed::before,#hud-alt::before{content:'';position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle,rgba(10,18,30,.06),rgba(5,10,18,.28));border:1px solid rgba(255,255,255,.14)}
        #hud-compass-rose{position:absolute;inset:14px;border-radius:50%;transition:transform .12s linear}
        .hud-letter{position:absolute;left:50%;top:50%;font:10px 'JetBrains Mono',monospace;color:rgba(240,248,255,.84)}
        #hud-hdg{position:absolute;left:0;right:0;top:40px;text-align:center;font-size:24px;font-weight:700}
        #hud-cardinal{position:absolute;left:0;right:0;top:70px;text-align:center;font-size:10px;letter-spacing:3px;color:rgba(221,235,248,.74)}
        .hud-dial{position:absolute;width:156px;height:156px;border-radius:50%}
        .hud-dial .needle{position:absolute;left:50%;top:50%;width:3px;height:56px;margin-left:-1.5px;margin-top:-54px;border-radius:999px;transform-origin:50% calc(100% - 8px);background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(123,212,255,.34))}
        .hud-dial .needle::after{content:'';position:absolute;left:50%;bottom:2px;width:10px;height:10px;margin-left:-5px;border-radius:50%;background:#fff}
        .hud-dial .label{position:absolute;left:0;right:0;top:30px;text-align:center;font:10px 'JetBrains Mono',monospace;letter-spacing:2px;color:rgba(221,235,248,.74);text-transform:uppercase}
        .hud-dial .value{position:absolute;left:0;right:0;top:58px;text-align:center;font-size:32px;font-weight:700}
        .hud-dial .unit{position:absolute;left:0;right:0;top:95px;text-align:center;font-size:10px;letter-spacing:2px;color:rgba(221,235,248,.74);text-transform:uppercase}
        .hud-dial .sub{position:absolute;left:0;right:0;top:114px;text-align:center;font-size:11px;color:rgba(237,246,255,.84)}
        #hud-speed{left:22px;bottom:24px}
        #hud-alt{right:22px;bottom:24px}
        #hud-info{position:absolute;left:22px;bottom:194px;right:auto;top:auto;transform:none;display:flex;flex-direction:column;gap:10px;width:min(188px,18vw);min-width:0}
        .hud-meter{display:flex;flex-direction:column;gap:4px}
        .hud-meter-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
        .hud-meter .label{font:8px 'JetBrains Mono',monospace;letter-spacing:2px;color:rgba(221,235,248,.68);text-transform:uppercase}
        .hud-meter .value{font-size:11px;font-weight:700;color:#eef7ff}
        .hud-meter-track{position:relative;height:6px;border-radius:999px;background:rgba(255,255,255,.1);overflow:hidden}
        .hud-meter-track::after{content:'';position:absolute;inset:0;border-radius:999px;border:1px solid rgba(255,255,255,.05)}
        .hud-meter-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,rgba(132,216,255,.28),rgba(132,216,255,.95));box-shadow:0 0 16px rgba(132,216,255,.18);transform-origin:left center}
        #hud-advice{position:absolute;left:50%;top:82px;transform:translateX(-50%);padding:0;font-size:10px;letter-spacing:2px;text-transform:uppercase;display:none;max-width:min(20vw,220px);text-align:center}
        #hud-location{position:absolute;left:50%;top:116px;transform:translateX(-50%);display:none;font:11px 'JetBrains Mono',monospace;letter-spacing:2px;color:rgba(238,247,255,.92);text-transform:uppercase;text-align:center;padding:8px 16px;border-radius:999px;background:rgba(7,16,28,.32);backdrop-filter:blur(10px)}
        #hud-alert{position:absolute;left:50%;top:20%;transform:translate(-50%,-50%);text-align:center;min-width:220px}
        #hud-crosshair{position:absolute;left:50%;top:50%;width:24px;height:24px;margin-left:-12px;margin-top:-12px;border:1px solid rgba(143,214,255,.8);border-radius:50%;display:none;box-shadow:0 0 18px rgba(127,214,255,.18)}
        #hud-crosshair::before,#hud-crosshair::after{content:'';position:absolute;left:50%;top:50%;background:rgba(222,244,255,.86)}
        #hud-crosshair::before{width:1px;height:16px;margin-left:-.5px;margin-top:-8px}
        #hud-crosshair::after{width:16px;height:1px;margin-left:-8px;margin-top:-.5px}
        #hud-mouse{position:absolute;right:26px;bottom:198px;padding:0;font-size:10px;letter-spacing:1.8px;color:#84d8ff;display:none}
        #hud-challenge{position:absolute;bottom:196px;right:22px;top:auto;display:none;min-width:188px;max-width:208px;text-align:right}
        #hud-advanced-top{position:absolute;top:86px;left:50%;transform:translateX(-50%);display:none;gap:12px}
        #hud-advanced-bottom{position:absolute;left:50%;bottom:132px;transform:translateX(-50%);display:none}
        .hud-adv{min-width:210px;padding:12px 14px;border-radius:16px}
        .hud-adv-title{font:9px 'JetBrains Mono',monospace;letter-spacing:2px;color:rgba(221,235,248,.74);text-transform:uppercase;margin-bottom:8px}
        #hud-advanced-grid{display:grid;grid-template-columns:repeat(5,minmax(88px,1fr));gap:10px;padding:10px 14px;border-radius:16px}
        #hud-help{position:absolute;inset:0;display:none;background:rgba(3,9,16,.88);pointer-events:auto;align-items:center;justify-content:center}
        #hud-help-card{width:min(92vw,700px);padding:26px 28px;border-radius:24px;background:rgba(8,16,28,.94);border:1px solid rgba(255,255,255,.16);box-shadow:0 30px 60px rgba(0,0,0,.35)}
        @media (max-width:1360px){#hud-title{max-width:132px}#hud-toprail{width:min(30vw,360px)}#hud-challenge{max-width:172px}}
        @media (max-width:1120px){#hud-title{left:18px;top:124px;max-width:120px}#hud-info{left:18px;bottom:184px;width:154px}#hud-challenge{right:18px;bottom:184px;min-width:156px;max-width:162px}#hud-advice{max-width:calc(100vw - 340px)}}
        @media (max-width:860px){#hud-toprail{width:calc(100vw - 180px);left:auto;right:14px;transform:none;justify-content:flex-end;padding:0 4px 8px;gap:8px 10px}.hud-chip{min-width:0;padding:0 3px;font-size:9px}#hud-compass{top:16px;left:14px;width:96px;height:96px}#hud-hdg{top:34px;font-size:20px}#hud-cardinal{top:60px}#hud-title{display:none}#hud-speed,#hud-alt{width:146px;height:146px}.hud-dial .value{font-size:28px}#hud-advanced-top,#hud-advanced-bottom{display:none!important}#hud-info{left:16px;bottom:178px;width:136px}#hud-challenge{display:none!important}#hud-advice{left:50%;top:126px;max-width:calc(100vw - 40px)}#hud-mouse{right:18px;bottom:336px}}
      </style>
      <div id="hud-root">
        <div id="hud-title">
          <div id="hud-aircraft-name"></div>
          <div id="hud-game-mode"></div>
          <div id="hud-statusline"></div>
        </div>
        <div id="hud-toprail" class="hud-glass">
          <div id="hud-guidance" class="hud-chip">Laser On</div>
          <div id="hud-assist" class="hud-chip">Assist Off</div>
          <div id="hud-autoland" class="hud-chip">Manual</div>
          <div id="hud-gear" class="hud-chip">Gear Down</div>
          <div id="hud-camera" class="hud-chip">Follow</div>
          <div id="hud-gun" class="hud-chip" style="display:none">Gun</div>
          <div id="hud-ammo" class="hud-chip" style="display:none">Ammo</div>
        </div>
        <div id="hud-compass" class="hud-glass">
          <div id="hud-compass-rose">
            <div class="hud-letter" style="transform:translate(-50%,-50%) translateY(-38px)">N</div>
            <div class="hud-letter" style="transform:translate(-50%,-50%) translateX(38px)">E</div>
            <div class="hud-letter" style="transform:translate(-50%,-50%) translateY(38px)">S</div>
            <div class="hud-letter" style="transform:translate(-50%,-50%) translateX(-38px)">W</div>
          </div>
          <div id="hud-hdg">000°</div>
          <div id="hud-cardinal">N</div>
        </div>
        <div id="hud-speed" class="hud-dial hud-glass">
          <div class="label">Airspeed</div>
          <div id="hud-speed-needle" class="needle"></div>
          <div id="hud-speed-value" class="value">0</div>
          <div class="unit">KTS</div>
          <div id="hud-speed-sub" class="sub">Stall 0 KT</div>
        </div>
        <div id="hud-alt" class="hud-dial hud-glass">
          <div class="label">Altitude</div>
          <div id="hud-alt-needle" class="needle"></div>
          <div id="hud-alt-value" class="value">0</div>
          <div class="unit">FT</div>
          <div id="hud-alt-sub" class="sub">V/S 0 FPM</div>
        </div>
        <div id="hud-info">
          ${this._meter('Condition','hud-cond')}
          ${this._meter('Throttle','hud-thr')}
          ${this._meter('Boost','hud-boost')}
          ${this._meter('G Force','hud-g')}
        </div>
        <div id="hud-advice" class="hud-glass"></div>
        <div id="hud-location"></div>
        <div id="hud-alert"></div>
        <div id="hud-crosshair"></div>
        <div id="hud-mouse" class="hud-glass">Mouse Steer</div>
        <div id="hud-challenge"></div>
        <div id="hud-advanced-top">
          <div class="hud-adv hud-glass"><div class="hud-adv-title">Objective</div><div id="hud-adv-objective" style="font-size:12px;line-height:1.5;min-height:40px"></div></div>
          <div class="hud-adv hud-glass"><div class="hud-adv-title">Approach</div><div id="hud-adv-target" style="font-size:12px;line-height:1.5;min-height:40px"></div></div>
        </div>
        <div id="hud-advanced-bottom">
          <div id="hud-advanced-grid" class="hud-glass">
            ${this._advancedMetric('Airspeed','hud-adv-speed')}
            ${this._advancedMetric('Altitude','hud-adv-alt')}
            ${this._advancedMetric('Vertical','hud-adv-vs')}
            ${this._advancedMetric('Boost','hud-adv-boost')}
            ${this._advancedMetric('Status','hud-adv-status')}
          </div>
        </div>
        <div id="hud-help"><div id="hud-help-card">${this._helpContent()}</div></div>
      </div>
    `);

    const q = id => document.getElementById(id);
    this._el = {
      root: q('hud-root'),
      aircraftName: q('hud-aircraft-name'),
      gameMode: q('hud-game-mode'),
      statusLine: q('hud-statusline'),
      guidance: q('hud-guidance'),
      assist: q('hud-assist'),
      autoland: q('hud-autoland'),
      gear: q('hud-gear'),
      camera: q('hud-camera'),
      gun: q('hud-gun'),
      ammo: q('hud-ammo'),
      compassRose: q('hud-compass-rose'),
      hdg: q('hud-hdg'),
      cardinal: q('hud-cardinal'),
      speedNeedle: q('hud-speed-needle'),
      speedValue: q('hud-speed-value'),
      speedSub: q('hud-speed-sub'),
      altNeedle: q('hud-alt-needle'),
      altValue: q('hud-alt-value'),
      altSub: q('hud-alt-sub'),
      cond: q('hud-cond-fill'),
      condValue: q('hud-cond-val'),
      thr: q('hud-thr-fill'),
      thrValue: q('hud-thr-val'),
      boost: q('hud-boost-fill'),
      boostValue: q('hud-boost-val'),
      g: q('hud-g-fill'),
      gValue: q('hud-g-val'),
      advice: q('hud-advice'),
      location: q('hud-location'),
      alert: q('hud-alert'),
      crosshair: q('hud-crosshair'),
      mouse: q('hud-mouse'),
      challenge: q('hud-challenge'),
      advTop: q('hud-advanced-top'),
      advBottom: q('hud-advanced-bottom'),
      advObjective: q('hud-adv-objective'),
      advTarget: q('hud-adv-target'),
      advSpeed: q('hud-adv-speed'),
      advAlt: q('hud-adv-alt'),
      advVs: q('hud-adv-vs'),
      advBoost: q('hud-adv-boost'),
      advStatus: q('hud-adv-status'),
      help: q('hud-help'),
    };
  }

  _meter(label, id) {
    return `
      <div class="hud-meter">
        <div class="hud-meter-head">
          <div class="label">${label}</div>
          <div id="${id}-val" class="value">--</div>
        </div>
        <div class="hud-meter-track">
          <div id="${id}-fill" class="hud-meter-fill" style="width:0%"></div>
        </div>
      </div>
    `;
  }

  _advancedMetric(label, id) {
    return `<div><div style="font:9px 'JetBrains Mono',monospace;letter-spacing:2px;color:rgba(221,235,248,.74);text-transform:uppercase">${label}</div><div id="${id}" style="margin-top:5px;font-size:15px;font-weight:700">--</div></div>`;
  }

  _helpContent() {
    const row = (key, action) => `<tr><td style="padding:4px 16px 4px 0;color:#8fd6ff;font:11px 'JetBrains Mono',monospace;white-space:nowrap">${key}</td><td style="color:#eef7ff">${action}</td></tr>`;
    return `
      <div style="font:11px 'JetBrains Mono',monospace;letter-spacing:3px;color:#8fd6ff;text-transform:uppercase;text-align:center;margin-bottom:18px">Controls</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;line-height:1.6">
        <tbody>
          ${row('W / S','Pitch up / down')}
          ${row('A / D','Roll left / right')}
          ${row('Q / E','Yaw left / right')}
          ${row('Shift / Ctrl','Throttle up / down')}
          ${row('Arrow Keys','Move gun cursor')}
          ${row('Space / R','Fire / reload')}
          ${row('V','Switch gun mode')}
          ${row('K','Toggle landing gear')}
          ${row('F','Boost')}
          ${row('B','Air brake')}
          ${row('T','Random trick')}
          ${row('L','Stability assist')}
          ${row('G','Landing laser')}
          ${row('C','Cycle camera')}
          ${row('Mouse Wheel','Zoom camera')}
          ${row('M','Toggle mouse steer')}
          ${row('H','Toggle this overlay')}
          ${row('Esc','Pause menu')}
        </tbody>
      </table>
      <div style="margin-top:14px;text-align:center;font-size:10px;color:rgba(221,235,248,.7)">Press H to return to flight</div>
    `;
  }

  update(state) {
    if (!state || !this._visible) return;
    if (window.innerWidth >= 1240 && window.innerHeight >= 720) this._minimap?.update(state);
    if ((this._advancedMode || (window.innerWidth >= 1380 && window.innerHeight >= 820))) this._attitude?.update(state);
    const el = this._el;
    const kts = state.speed * 1.944;
    const ft = state.altitude * 3.281;
    const fpm = state.verticalSpeed * 196.85;
    const condition = Math.round(state.condition ?? 100);
    const throttlePct = Math.round((state.throttle ?? 0) * 100);
    const boostPct = Math.round(state.boostFuel ?? 100);
    const heading = state.heading ?? 0;
    const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const cardinal = cardinals[Math.round((((heading % 360) + 360) % 360) / 45) % cardinals.length];
    const cameraLabels = { cockpit: 'Cockpit', follow: 'Follow', free: 'Free', cinematic: 'Cinema' };
    const modeLabels = {
      free_fly: 'Free Flight',
      challenge: 'Challenge',
      race_practice: 'Bot Practice',
      race_online_casual: 'Online Casual',
      race_online_ranked: 'Online Ranked',
      race_online_private: 'Private Room',
    };

    el.aircraftName.textContent = state.aircraftName?.toUpperCase?.() ?? '';
    el.gameMode.textContent = state.replayActive ? 'Race Replay' : (modeLabels[state.gameMode] ?? 'Free Flight');
    el.statusLine.textContent = '';

    el.guidance.textContent = state.guidanceEnabled !== false ? 'Laser On' : 'Laser Off';
    el.guidance.style.color = state.guidanceEnabled !== false ? '#84d8ff' : '#eef7ff';
    el.assist.textContent = state.assistEnabled ? 'Assist On' : 'Assist Off';
    el.assist.style.color = state.assistEnabled ? '#84ffd4' : '#eef7ff';
    el.autoland.textContent = state.autoLandAllowed === false ? 'Auto Locked' : state.autoLandEnabled ? 'Autoland' : 'Manual';
    el.autoland.style.color = state.autoLandAllowed === false ? '#ffd470' : state.autoLandEnabled ? '#84ffd4' : '#eef7ff';
    el.gear.textContent = state.gearDeployed ? 'Gear Down' : 'Gear Up';
    el.gear.style.color = state.gearDeployed ? '#ffd470' : '#eef7ff';
    el.camera.textContent = cameraLabels[state.cameraMode] ?? 'Follow';

    el.gun.style.display = state.gunAvailable ? 'block' : 'none';
    el.ammo.style.display = state.gunAvailable ? 'block' : 'none';
    if (state.gunAvailable) {
      el.gun.textContent = `Gun ${(state.gunAimMode ?? 'follow').toUpperCase()}`;
      el.gun.style.color = state.gunAimMode === 'free' ? '#ffd470' : '#84d8ff';
      el.ammo.textContent = state.gunReloading ? `Reload ${Math.round((state.gunReloadProgress ?? 0) * 100)}%` : `${state.gunAmmo ?? 0}/${state.gunMagazineSize ?? 0}`;
      el.ammo.style.color = state.gunReloading ? '#84ffd4' : '#eef7ff';
    }

    el.hdg.textContent = `${Math.round(heading).toString().padStart(3, '0')}°`;
    el.cardinal.textContent = cardinal;
    el.compassRose.style.transform = `rotate(${-heading}deg)`;
    el.speedNeedle.style.transform = `rotate(${mapRange(kts, 0, Math.max(220, (state.maxSpeed ?? 260) * 1.944), -126, 126)}deg)`;
    el.altNeedle.style.transform = `rotate(${mapRange(ft, 0, Math.max(6000, ft + 500), -126, 126)}deg)`;
    el.speedValue.textContent = `${Math.max(0, kts).toFixed(0)}`;
    el.speedSub.textContent = `Stall ${Math.round((state.stallSpeed ?? 0) * 1.944)} KT`;
    el.altValue.textContent = `${Math.max(0, ft).toFixed(0)}`;
    el.altSub.textContent = `V/S ${fpm >= 0 ? '+' : ''}${fpm.toFixed(0)} FPM`;
    el.altSub.style.color = fpm > 50 ? '#84ffd4' : fpm < -50 ? '#ffd470' : 'rgba(237,246,255,.84)';

    const gForce = Math.max(0, state.gForce ?? 1);
    const gPct = Math.round(clamp((gForce - 0.5) / 5.5, 0, 1) * 100);
    el.condValue.textContent = `${condition}%`;
    el.thrValue.textContent = `${throttlePct}%`;
    el.boostValue.textContent = `${boostPct}%`;
    el.gValue.textContent = `${gForce.toFixed(1)}g`;
    el.cond.style.width = `${condition}%`;
    el.thr.style.width = `${throttlePct}%`;
    el.boost.style.width = `${boostPct}%`;
    el.g.style.width = `${gPct}%`;
    el.cond.style.background = condition >= 80
      ? 'linear-gradient(90deg,rgba(132,216,255,.32),rgba(132,216,255,.98))'
      : condition >= 45
        ? 'linear-gradient(90deg,rgba(255,212,112,.32),rgba(255,212,112,.96))'
        : 'linear-gradient(90deg,rgba(255,120,120,.28),rgba(255,120,120,.96))';
    el.boost.style.background = 'linear-gradient(90deg,rgba(111,255,212,.28),rgba(111,255,212,.94))';
    el.g.style.background = gForce < 1.8
      ? 'linear-gradient(90deg,rgba(132,216,255,.26),rgba(132,216,255,.92))'
      : gForce < 3.8
        ? 'linear-gradient(90deg,rgba(255,212,112,.28),rgba(255,212,112,.92))'
        : 'linear-gradient(90deg,rgba(255,126,126,.26),rgba(255,126,126,.92))';

    if (state.guidanceEnabled && state.landingAdvice) {
      el.advice.style.display = 'block';
      el.advice.textContent = state.landingAdvice;
      el.advice.style.color = state.landingAdviceTone === 'warn' ? '#ffd470' : state.landingAdviceTone === 'ok' ? '#84ffd4' : '#eef7ff';
    } else {
      el.advice.style.display = 'none';
    }

    if (state.locationBannerActive && state.locationBanner) {
      el.location.style.display = 'block';
      el.location.textContent = state.locationBanner;
    } else {
      el.location.style.display = 'none';
    }

    if (state.landed) {
      const map = { crash: ['CRASHED', '#ff8f8f'], smooth: ['SMOOTH LANDING', '#84ffd4'], hard: ['HARD LANDING', '#ffd470'] };
      const [text, color] = map[state.landed] ?? ['', '#eef7ff'];
      el.alert.innerHTML = text ? `<div style="font-size:28px;font-weight:800;letter-spacing:4px;color:${color};text-transform:uppercase">${text}</div>` : '';
    } else if (state.trickName) {
      el.alert.innerHTML = `<div style="font-size:22px;font-weight:800;letter-spacing:4px;color:#8fd6ff;text-transform:uppercase">${state.trickName}</div>`;
    } else if (state.raceCountdownActive) {
      el.alert.innerHTML = `<div style="font-size:52px;font-weight:800;letter-spacing:5px;color:#84ffd4">${Math.ceil(state.raceCountdown || 0)}</div>`;
    } else if (state.replayActive) {
      el.alert.innerHTML = `<div style="font-size:16px;font-weight:700;letter-spacing:3px;color:#eef7ff;text-transform:uppercase">Race Replay</div>`;
    } else if (state.awaitingLandingTarget) {
      el.alert.innerHTML = `<div style="font-size:13px;font-weight:700;letter-spacing:3px;color:#84ffd4;text-transform:uppercase">Click terrain to arm autoland</div>`;
    } else if (state.guidanceEnabled && state.landingTargetSelected === false) {
      el.alert.innerHTML = `<div style="font-size:13px;font-weight:700;letter-spacing:3px;color:#84ffd4;text-transform:uppercase">Click terrain to set landing point</div>`;
    } else {
      el.alert.innerHTML = '';
    }

    el.mouse.style.display = state.mouseEnabled ? 'block' : 'none';
    el.crosshair.style.display = state.gunAvailable ? 'block' : 'none';
    if (state.gunAvailable) {
      el.crosshair.style.transform = `translate(calc(-50% + ${(state.aimX ?? 0) * 34}px), calc(-50% + ${-(state.aimY ?? 0) * 30}px))`;
      el.crosshair.style.borderColor = state.gunAimMode === 'free' ? 'rgba(255,212,112,.92)' : 'rgba(143,214,255,.82)';
    }

    if (this._advancedMode) {
      const gateDistanceText = Number.isFinite(state.raceNextGateDistance) ? `${Math.round(state.raceNextGateDistance)}m` : '--';
      el.advObjective.textContent = state.gameMode?.startsWith?.('race')
        ? (state.raceCountdownActive ? `Race launch in ${Math.ceil(state.raceCountdown || 0)}` : `Race live | Position ${state.racePlace ?? 1}/${state.raceTotal ?? 5}`)
        : state.guidanceEnabled
          ? (state.landingTargetSelected ? `Land at selected point | ${state.landingAdvice ?? 'On profile'}` : 'Select a landing point on terrain')
          : 'Free flight';
      el.advTarget.innerHTML = state.gameMode?.startsWith?.('race')
        ? `NEXT GATE ${state.raceNextGate ?? 1} · ${gateDistanceText}<br/>${state.raceDirectionHint ?? 'FOLLOW CHEVRONS'}<br/>${state.raceCountdownActive ? 'COUNTDOWN ACTIVE' : 'RACE LIVE'}`
        : `HDG ${Math.round(heading).toString().padStart(3, '0')} | THR ${throttlePct}%<br/>${state.awaitingLandingTarget ? 'SELECT LANDING TARGET' : state.autoLandEnabled ? `AUTO ${state.autoLandStage ?? 'ACTIVE'}` : 'MANUAL APPROACH'}<br/>${state.guidanceEnabled ? (state.landingAdvice ?? 'GUIDANCE READY') : 'GUIDANCE OFF'}`;
      el.advSpeed.textContent = `${kts.toFixed(0)} KT`;
      el.advAlt.textContent = `${ft.toFixed(0)} FT`;
      el.advVs.textContent = `${fpm >= 0 ? '+' : ''}${fpm.toFixed(0)} FPM`;
      el.advBoost.textContent = `${boostPct}%`;
      el.advStatus.textContent = state.gunAvailable ? (state.gunReloading ? `RELOAD ${Math.round((state.gunReloadProgress ?? 0) * 100)}%` : `${(state.gunAimMode ?? 'follow').toUpperCase()} ${state.gunAmmo ?? 0}/${state.gunMagazineSize ?? 0}`) : (state.autoLandEnabled ? 'AUTOLAND' : 'MONITOR');
    }

    if (state.gameMode === 'challenge') {
      const mins = Math.floor((state.challengeTimer ?? 0) / 60);
      const secs = ((state.challengeTimer ?? 0) % 60).toFixed(1).padStart(4, '0');
      el.challenge.style.display = 'block';
      el.challenge.innerHTML = `
        <div style="font:9px 'JetBrains Mono',monospace;letter-spacing:2px;color:rgba(221,235,248,.72);text-transform:uppercase">Challenge</div>
        <div style="margin-top:6px;font-size:14px;font-weight:700;color:#eef7ff">${state.ringsCompleted ?? 0}/${state.totalRings ?? 0} rings</div>
        <div style="margin-top:4px;height:1px;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(132,216,255,.34),rgba(255,255,255,0));"></div>
        <div style="margin-top:6px;font-size:12px;color:rgba(237,246,255,.82)">${mins}:${secs}</div>
      `;
    } else if (state.gameMode?.startsWith?.('race_')) {
      el.challenge.style.display = 'block';
      const gateDistance = Number.isFinite(state.raceNextGateDistance) ? `${Math.round(state.raceNextGateDistance)}m` : '--';
      const roomHeadline = state.raceWaitingForPlayers
        ? `ROOM ${state.raceRoomCode ?? '--'} | WAITING`
        : state.raceCountdownActive
          ? `ROOM ${state.raceRoomCode ?? '--'} | START ${Math.ceil(state.raceCountdown || 0)}`
          : null;
      const roomDetail = state.raceWaitingForPlayers
        ? `Waiting for pilots | ${state.raceTotal ?? 1} joined`
        : state.raceCountdownActive
          ? 'Hold your lane for launch'
          : null;
      el.challenge.innerHTML = `
        <div style="font:9px 'JetBrains Mono',monospace;letter-spacing:2px;color:rgba(221,235,248,.72);text-transform:uppercase">Race</div>
        <div style="margin-top:6px;font-size:14px;font-weight:700;color:#eef7ff">P${state.racePlace ?? 1}/${state.raceTotal ?? 5} · Lap ${state.raceLap ?? 1}/${state.raceTotalLaps ?? 3}</div>
        <div style="margin-top:4px;height:1px;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(132,216,255,.34),rgba(255,255,255,0));"></div>
        <div style="margin-top:6px;font-size:11px;color:rgba(237,246,255,.82)">${state.raceDirectionHint ?? 'Follow the lane'} · ${gateDistance}</div>
      `;
      if (roomHeadline) {
        el.challenge.innerHTML = `
          <div style="font:9px 'JetBrains Mono',monospace;letter-spacing:2px;color:rgba(221,235,248,.72);text-transform:uppercase">Race Room</div>
          <div style="margin-top:6px;font-size:14px;font-weight:700;color:#eef7ff">${roomHeadline}</div>
          <div style="margin-top:4px;height:1px;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(132,216,255,.34),rgba(255,255,255,0));"></div>
          <div style="margin-top:6px;font-size:11px;color:rgba(237,246,255,.82)">${roomDetail}</div>
        `;
      } else {
        el.challenge.innerHTML = `
          <div style="font:9px 'JetBrains Mono',monospace;letter-spacing:2px;color:rgba(221,235,248,.72);text-transform:uppercase">Race</div>
          <div style="margin-top:6px;font-size:14px;font-weight:700;color:#eef7ff">P${state.racePlace ?? 1}/${state.raceTotal ?? 5} · Lap ${state.raceLap ?? 1}/${state.raceTotalLaps ?? 3}</div>
          <div style="margin-top:4px;height:1px;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(132,216,255,.34),rgba(255,255,255,0));"></div>
          <div style="margin-top:6px;font-size:11px;color:rgba(237,246,255,.82)">${state.raceDirectionHint ?? 'Follow the lane'} · ${gateDistance}</div>
        `;
      }
    } else {
      el.challenge.style.display = 'none';
    }
  }

  toggleHelp() {
    this._helpVisible = !this._helpVisible;
    this._el.root.dataset.help = this._helpVisible ? 'on' : 'off';
    this._el.help.style.display = this._helpVisible ? 'flex' : 'none';
    return this._helpVisible;
  }

  isHelpVisible() { return this._helpVisible; }

  setAdvancedMode(enabled) {
    this._advancedMode = !!enabled;
    this._el.advTop.style.display = this._advancedMode ? 'flex' : 'none';
    this._el.advBottom.style.display = this._advancedMode ? 'block' : 'none';
    const showMinimap = window.innerWidth >= 1240 && window.innerHeight >= 720;
    const showAttitude = this._advancedMode || (window.innerWidth >= 1380 && window.innerHeight >= 820);
    if (showMinimap) {
      this._minimap.show();
    } else {
      this._minimap.hide();
    }
    if (showAttitude) this._attitude.show();
    else this._attitude.hide();
  }

  show() { this._el.root.style.display = 'block'; this._visible = true; }
  hide() { this._el.root.style.display = 'none'; this._visible = false; }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    document.getElementById('hud-layout-style')?.remove();
    document.getElementById('hud-root')?.remove();
    this._minimap?.destroy();
    this._attitude?.destroy();
  }
}
