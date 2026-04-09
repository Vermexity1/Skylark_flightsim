import { AIRCRAFT } from '../config.js';

const STORAGE_KEY = 'flightsim-aircraft-condition-v1';

export class DamageSystem {
  constructor(storageKey = STORAGE_KEY) {
    this.storageKey = storageKey;
    this._conditionMap = this._load();
  }

  _defaultMap() {
    return Object.fromEntries(Object.keys(AIRCRAFT).map(type => [type, 100]));
  }

  _load() {
    const defaults = this._defaultMap();
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      return {
        ...defaults,
        ...Object.fromEntries(
          Object.entries(parsed).map(([type, condition]) => [
            type,
            Math.max(0, Math.min(100, Number(condition) || 0)),
          ])
        ),
      };
    } catch (_) {
      return defaults;
    }
  }

  _save() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this._conditionMap));
    } catch (_) {}
  }

  exportState() {
    return { ...this._conditionMap };
  }

  hydrate(conditionMap = null) {
    const defaults = this._defaultMap();
    this._conditionMap = {
      ...defaults,
      ...Object.fromEntries(
        Object.entries(conditionMap ?? {}).map(([type, condition]) => [
          type,
          Math.max(0, Math.min(100, Number(condition) || 0)),
        ])
      ),
    };
    this._save();
    return this.getFleetStatus();
  }

  getCondition(type) {
    return this._conditionMap[type] ?? 100;
  }

  setCondition(type, condition) {
    this._conditionMap[type] = Math.max(0, Math.min(100, Math.round(condition)));
    this._save();
    return this._conditionMap[type];
  }

  applyDamage(type, amount) {
    return this.setCondition(type, this.getCondition(type) - Math.max(0, amount));
  }

  repair(type) {
    return this.setCondition(type, 100);
  }

  repairAll() {
    Object.keys(AIRCRAFT).forEach(type => {
      this._conditionMap[type] = 100;
    });
    this._save();
    return this.getFleetStatus();
  }

  reset() {
    this._conditionMap = this._defaultMap();
    this._save();
  }

  getFleetStatus() {
    return Object.entries(AIRCRAFT).map(([type, aircraft]) => ({
      type,
      name: aircraft.name,
      condition: this.getCondition(type),
      status: this.getStatusLabel(this.getCondition(type)),
    }));
  }

  getStatusLabel(condition) {
    if (condition >= 90) return 'Excellent';
    if (condition >= 70) return 'Good';
    if (condition >= 45) return 'Worn';
    if (condition >= 20) return 'Damaged';
    return 'Critical';
  }
}
