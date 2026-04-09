// ============================================================
// Audio System — Procedural sounds via Web Audio API
// ============================================================

export class AudioSystem {
  constructor() {
    this.ctx          = null;
    this.masterGain   = null;
    this.engineOsc    = null;
    this.engineGain   = null;
    this.windNoise    = null;
    this.windGain     = null;
    this.stallOsc     = null;
    this.stallGain    = null;
    this.initialized  = false;
    this._muted       = false;
    this._voice = null;
  }

  async init() {
    try {
      this.ctx        = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.22;
      this.masterGain.connect(this.ctx.destination);

      // ── Engine — filtered sawtooth ───────────────────────
      this.engineOsc  = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 75;

      const engFilter = this.ctx.createBiquadFilter();
      engFilter.type = 'lowpass';
      engFilter.frequency.value = 350;
      engFilter.Q.value = 1.2;

      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;

      this.engineOsc.connect(engFilter);
      engFilter.connect(this.engineGain);
      this.engineGain.connect(this.masterGain);
      this.engineOsc.start();

      // ── Wind — bandpass filtered white noise ─────────────
      const bufSize  = this.ctx.sampleRate * 2;
      const buf      = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
      const data     = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * 0.4;

      this.windNoise  = this.ctx.createBufferSource();
      this.windNoise.buffer = buf;
      this.windNoise.loop   = true;

      const windFilter = this.ctx.createBiquadFilter();
      windFilter.type  = 'bandpass';
      windFilter.frequency.value = 900;
      windFilter.Q.value = 0.4;

      this.windGain = this.ctx.createGain();
      this.windGain.gain.value = 0;

      this.windNoise.connect(windFilter);
      windFilter.connect(this.windGain);
      this.windGain.connect(this.masterGain);
      this.windNoise.start();

      // ── Stall — low rumble ───────────────────────────────
      this.stallOsc = this.ctx.createOscillator();
      this.stallOsc.type = 'triangle';
      this.stallOsc.frequency.value = 30;

      this.stallGain = this.ctx.createGain();
      this.stallGain.gain.value = 0;

      this.stallOsc.connect(this.stallGain);
      this.stallGain.connect(this.masterGain);
      this.stallOsc.start();

      this.initialized = true;
      this._selectVoice();
    } catch (e) {
      console.warn('[Audio] Init failed:', e.message);
    }
  }

  _selectVoice() {
    if (!('speechSynthesis' in window)) return;
    const pickVoice = () => {
      const voices = window.speechSynthesis.getVoices?.() ?? [];
      if (!voices.length) return;
      const preferred = voices.find(voice => /en/i.test(voice.lang) && /(zira|aria|jenny|susan|samantha|google us english|michelle|emma|olivia)/i.test(voice.name))
        ?? voices.find(voice => /en/i.test(voice.lang) && /female|woman|girl/i.test(voice.name))
        ?? voices.find(voice => /en/i.test(voice.lang))
        ?? voices[0];
      this._voice = preferred ?? null;
    };

    pickVoice();
    if (!this._voice) {
      window.speechSynthesis.addEventListener?.('voiceschanged', pickVoice, { once: true });
    }
  }

  update(throttle, speed, maxSpeed, isStalling) {
    if (!this.initialized || !this.ctx) return;
    const now = this.ctx.currentTime + 0.08;

    // Engine pitch rises with throttle
    this.engineOsc.frequency.linearRampToValueAtTime(55 + throttle * 140, now);
    this.engineGain.gain.linearRampToValueAtTime(0.08 + throttle * 0.38, now);

    // Wind rises with speed
    const speedFraction = Math.min(1, speed / maxSpeed);
    this.windGain.gain.linearRampToValueAtTime(speedFraction * 0.28, now);

    // Stall rumble
    this.stallGain.gain.linearRampToValueAtTime(isStalling ? 0.15 : 0, now);
  }

  triggerCrash(intensity = 1) {
    if (!this.initialized || !this.ctx || !this.masterGain) return;

    const now = this.ctx.currentTime;
    const gain = this.ctx.createGain();
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180 * intensity, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.55);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(110, now + 0.45);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.22 * intensity, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.65);
  }

  triggerGunFire(gunProfile = null) {
    if (!this.initialized || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    const tint = gunProfile?.color ?? 0x8edbff;

    osc.type = 'square';
    osc.frequency.setValueAtTime(720 + ((tint & 0xff) / 255) * 180, now);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.08);
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200, now);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.05, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  triggerReload() {
    if (!this.initialized || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.linearRampToValueAtTime(560, now + 0.12);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.045, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  triggerHit() {
    if (!this.initialized || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.18);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  triggerLanding(kind = 'smooth') {
    if (!this.initialized || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = kind === 'hard' ? 'square' : 'sine';
    osc.frequency.setValueAtTime(kind === 'hard' ? 160 : 420, now);
    osc.frequency.exponentialRampToValueAtTime(kind === 'hard' ? 90 : 260, now + 0.18);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(kind === 'hard' ? 0.08 : 0.04, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.28);
  }

  triggerUi(kind = 'soft') {
    if (!this.initialized || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = kind === 'primary' ? 'triangle' : kind === 'accent' ? 'sine' : 'square';
    osc.frequency.setValueAtTime(kind === 'primary' ? 620 : kind === 'accent' ? 780 : 440, now);
    osc.frequency.exponentialRampToValueAtTime(kind === 'primary' ? 890 : kind === 'accent' ? 1040 : 560, now + 0.06);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(kind === 'primary' ? 0.04 : 0.025, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  speakATC(message) {
    if (!message || !('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.voice = this._voice ?? null;
    utterance.rate = 0.94;
    utterance.pitch = 0.92;
    utterance.volume = 0.72;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  toggleMute() {
    if (!this.masterGain) return;
    this._muted = !this._muted;
    this.masterGain.gain.value = this._muted ? 0 : 0.22;
    return this._muted;
  }

  destroy() {
    try {
      this.engineOsc?.stop();
      this.windNoise?.stop();
      this.stallOsc?.stop();
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      this.ctx?.close();
    } catch (_) {}
  }
}
