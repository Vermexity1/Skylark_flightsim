// ============================================================
// Input Handler
// Keyboard + Mouse steering + Gamepad
// UPGRADE: proper multi-modal control with mode switching
// ============================================================
import { CONTROLS } from '../config.js';

const CONTROL_STORAGE_KEY = 'flightsim-controls-v2';
const AIM_ONLY_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const FLIGHT_ONLY_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE']);

export class InputHandler {
  constructor() {
    this.keys    = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.gamepadIndex = null;

    // Control mode: 'keyboard' | 'mouse' | 'hybrid'
    this.controlMode = 'keyboard';
    this.mouseSteeringEnabled = false;
    this.bindings = this._loadBindings();

    // One-shot callbacks
    this.onCameraToggle = null;
    this.onGuidanceToggle = null;
    this.onTrick        = null;
    this.onAssistToggle = null;
    this.onReload       = null;
    this.onAimModeToggle = null;
    this.onLandingGearToggle = null;
    this.onPause        = null;
    this.onHelpToggle   = null;
    this.onMouseToggle  = null;

    // Debounce flags for toggle keys
    this._camPressed    = false;
    this._guidancePressed = false;
    this._trickPressed  = false;
    this._assistPressed = false;
    this._reloadPressed = false;
    this._aimModePressed = false;
    this._landingGearPressed = false;
    this._pausePressed  = false;
    this._helpPressed   = false;
    this._mousePressed  = false;

    // Bind
    this._kd  = this._onKeyDown.bind(this);
    this._ku  = this._onKeyUp.bind(this);
    this._mm  = this._onMouseMove.bind(this);
    this._gpc = e => { this.gamepadIndex = e.gamepad.index; };
    this._gpd = ()=> { this.gamepadIndex = null; };

    window.addEventListener('keydown',            this._kd);
    window.addEventListener('keyup',              this._ku);
    window.addEventListener('mousemove',          this._mm);
    window.addEventListener('gamepadconnected',   this._gpc);
    window.addEventListener('gamepaddisconnected',this._gpd);
  }

  _onKeyDown(e) {
    this.keys.add(e.code);
    const keyboard = this.bindings;
    if (this._shouldPreventDefault(e.code, keyboard)) {
      e.preventDefault();
    }

    if (keyboard.cameraToggle.includes(e.code) && !this._camPressed) {
      this._camPressed = true;
      this.onCameraToggle?.();
    }
    if (keyboard.guidanceToggle.includes(e.code) && !this._guidancePressed) {
      this._guidancePressed = true;
      this.onGuidanceToggle?.();
    }
    if (keyboard.trick?.includes(e.code) && !this._trickPressed) {
      this._trickPressed = true;
      this.onTrick?.();
    }
    if (keyboard.assistToggle?.includes(e.code) && !this._assistPressed) {
      this._assistPressed = true;
      this.onAssistToggle?.();
    }
    if (keyboard.reload?.includes(e.code) && !this._reloadPressed) {
      this._reloadPressed = true;
      this.onReload?.();
    }
    if (keyboard.aimModeToggle?.includes(e.code) && !this._aimModePressed) {
      this._aimModePressed = true;
      this.onAimModeToggle?.();
    }
    if (keyboard.landingGearToggle?.includes(e.code) && !this._landingGearPressed) {
      this._landingGearPressed = true;
      this.onLandingGearToggle?.();
    }
    if (keyboard.pause.includes(e.code) && !this._pausePressed) {
      this._pausePressed = true;
      this.onPause?.();
    }
    if (keyboard.helpToggle.includes(e.code) && !this._helpPressed) {
      this._helpPressed = true;
      this.onHelpToggle?.();
    }
    if (keyboard.mouseToggle.includes(e.code) && !this._mousePressed) {
      this._mousePressed = true;
      this.mouseSteeringEnabled = !this.mouseSteeringEnabled;
      this.onMouseToggle?.(this.mouseSteeringEnabled);
    }
  }

  _onKeyUp(e) {
    this.keys.delete(e.code);
    const keyboard = this.bindings;
    if (this._shouldPreventDefault(e.code, keyboard)) {
      e.preventDefault();
    }
    if (keyboard.cameraToggle.includes(e.code)) this._camPressed   = false;
    if (keyboard.guidanceToggle.includes(e.code)) this._guidancePressed = false;
    if (keyboard.trick?.includes(e.code)) this._trickPressed = false;
    if (keyboard.assistToggle?.includes(e.code)) this._assistPressed = false;
    if (keyboard.reload?.includes(e.code)) this._reloadPressed = false;
    if (keyboard.aimModeToggle?.includes(e.code)) this._aimModePressed = false;
    if (keyboard.landingGearToggle?.includes(e.code)) this._landingGearPressed = false;
    if (keyboard.pause.includes(e.code))        this._pausePressed = false;
    if (keyboard.helpToggle.includes(e.code))   this._helpPressed  = false;
    if (keyboard.mouseToggle.includes(e.code))  this._mousePressed = false;
  }

  _onMouseMove(e) {
    if (this.mouseSteeringEnabled) {
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    }
  }

  /** Returns normalised input state for this frame */
  getState() {
    const st = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: false, boost: false, fire: false, aimX: 0, aimY: 0 };
    const has = keys => keys.some(k => this.keys.has(k));
    const kb  = this.bindings;

    // Keyboard axes
    if (has(kb.pitchUp))      st.pitch    +=  1;
    if (has(kb.pitchDown))    st.pitch    += -1;
    if (has(kb.rollLeft))     st.roll     += -1;
    if (has(kb.rollRight))    st.roll     +=  1;
    if (has(kb.yawLeft))      st.yaw      += -1;
    if (has(kb.yawRight))     st.yaw      +=  1;
    if (has(kb.throttleUp))   st.throttle +=  1;
    if (has(kb.throttleDown)) st.throttle += -1;
    if (has(kb.brake))        st.brake     = true;
    if (has(kb.boost))        st.boost     = true;
    if (has(kb.shoot ?? []))  st.fire      = true;
    if (has(kb.aimLeft ?? []))  st.aimX    -= 1;
    if (has(kb.aimRight ?? [])) st.aimX    += 1;
    if (has(kb.aimUp ?? []))    st.aimY    += 1;
    if (has(kb.aimDown ?? []))  st.aimY    -= 1;

    // Mouse steering (hybrid mode)
    if (this.mouseSteeringEnabled) {
      const sens = CONTROLS.mouse.sensitivity * 150;
      st.pitch -= this.mouseDY * sens;
      st.roll  += this.mouseDX * sens;
    }
    this.mouseDX = 0;
    this.mouseDY = 0;

    // Gamepad
    if (this.gamepadIndex !== null) {
      const gp = navigator.getGamepads()[this.gamepadIndex];
      if (gp) {
        const dz = CONTROLS.gamepad.deadzone;
        const dz_ = v => Math.abs(v) < dz ? 0 : v;
        st.pitch  -= dz_(gp.axes[CONTROLS.gamepad.pitchAxis]);
        st.roll   += dz_(gp.axes[CONTROLS.gamepad.rollAxis]);
        st.yaw    += dz_(gp.axes[CONTROLS.gamepad.yawAxis]);
        st.throttle -= dz_(gp.axes[CONTROLS.gamepad.throttleAxis]);
        if (gp.buttons[0]?.pressed) st.boost = true;
        if (gp.buttons[1]?.pressed) st.brake = true;
      }
    }

    // Clamp all axes
    st.pitch    = Math.max(-1, Math.min(1, st.pitch));
    st.roll     = Math.max(-1, Math.min(1, st.roll));
    st.yaw      = Math.max(-1, Math.min(1, st.yaw));
    st.throttle = Math.max(-1, Math.min(1, st.throttle));
    st.aimX     = Math.max(-1, Math.min(1, st.aimX));
    st.aimY     = Math.max(-1, Math.min(1, st.aimY));

    return st;
  }

  getBindings() {
    return JSON.parse(JSON.stringify(this.bindings));
  }

  setBinding(action, code) {
    if (!this.bindings[action]) return this.getBindings();
    this.bindings[action] = [this._normalizeBinding(action, code)];
    this._saveBindings();
    return this.getBindings();
  }

  resetBindings() {
    this.bindings = this._sanitizeBindings(JSON.parse(JSON.stringify(CONTROLS.keyboard)));
    this._saveBindings();
    return this.getBindings();
  }

  _loadBindings() {
    try {
      const raw = localStorage.getItem(CONTROL_STORAGE_KEY);
      if (!raw) return this._sanitizeBindings(JSON.parse(JSON.stringify(CONTROLS.keyboard)));
      const parsed = JSON.parse(raw);
      const merged = JSON.parse(JSON.stringify(CONTROLS.keyboard));
      Object.entries(merged).forEach(([action, defaults]) => {
        if (Array.isArray(parsed?.[action]) && parsed[action].length) {
          merged[action] = parsed[action]
            .filter(code => typeof code === 'string' && code.length > 0)
            .map(code => this._normalizeBinding(action, code));
        } else {
          merged[action] = defaults;
        }
      });
      return this._sanitizeBindings(merged);
    } catch {
      return this._sanitizeBindings(JSON.parse(JSON.stringify(CONTROLS.keyboard)));
    }
  }

  _saveBindings() {
    try {
      localStorage.setItem(CONTROL_STORAGE_KEY, JSON.stringify(this.bindings));
    } catch {
      // Ignore storage failures and keep active in-memory bindings.
    }
  }

  _normalizeBinding(action, code) {
    const fallback = CONTROLS.keyboard[action]?.[0] ?? code;
    if (this._isAimAction(action) && FLIGHT_ONLY_KEYS.has(code)) return fallback;
    if (!this._isAimAction(action) && AIM_ONLY_KEYS.has(code)) return fallback;
    return code;
  }

  _sanitizeBindings(bindings) {
    const next = JSON.parse(JSON.stringify(bindings));
    Object.keys(next).forEach(action => {
      next[action] = (next[action] ?? []).map(code => this._normalizeBinding(action, code));
    });
    return next;
  }

  _isAimAction(action) {
    return action === 'aimUp' || action === 'aimDown' || action === 'aimLeft' || action === 'aimRight';
  }

  _shouldPreventDefault(code, keyboard) {
    return Object.values(keyboard).some(binding => Array.isArray(binding) && binding.includes(code))
      || AIM_ONLY_KEYS.has(code)
      || code === 'Space';
  }

  destroy() {
    window.removeEventListener('keydown',            this._kd);
    window.removeEventListener('keyup',              this._ku);
    window.removeEventListener('mousemove',          this._mm);
    window.removeEventListener('gamepadconnected',   this._gpc);
    window.removeEventListener('gamepaddisconnected',this._gpd);
  }
}
