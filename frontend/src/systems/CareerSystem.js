import { AIRCRAFT, RACE } from '../config.js';

const STORAGE_KEY = 'flightsim-career-v1';

function defaultCareerState() {
  return {
    money: 5000,
    rankIndex: 0,
    rankProgress: 0,
    legendScore: 0,
    ownedPlanes: ['prop', 'fighter'],
    ownedGuns: ['standard'],
    equippedGun: 'standard',
    raceHistory: [],
  };
}

export class CareerSystem {
  constructor(storageKey = STORAGE_KEY) {
    this.storageKey = storageKey;
    this.state = this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return defaultCareerState();
      return { ...defaultCareerState(), ...JSON.parse(raw) };
    } catch {
      return defaultCareerState();
    }
  }

  _save() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.state));
    } catch {
      // Ignore storage failures.
    }
  }

  exportState() {
    return JSON.parse(JSON.stringify(this.state));
  }

  hydrate(nextState = null) {
    this.state = {
      ...defaultCareerState(),
      ...(nextState ?? {}),
    };
    this._save();
    return this.getState();
  }

  getState() {
    const rank = RACE.RANKS[this.state.rankIndex] ?? RACE.RANKS[0];
    const nextRank = RACE.RANKS[Math.min(this.state.rankIndex + 1, RACE.RANKS.length - 1)] ?? rank;
    return {
      ...this.state,
      rankName: rank.name,
      rank: rank,
      nextRankName: nextRank.name,
      rankMaxed: this.state.rankIndex >= RACE.RANKS.length - 1,
    };
  }

  canUsePlane(type, gameMode = 'free_fly') {
    if (gameMode === 'free_fly') return true;
    return this.state.ownedPlanes.includes(type);
  }

  purchasePlane(type) {
    const cost = RACE.PLANE_COSTS[type];
    if (cost === undefined) return { ok: false, reason: 'Unavailable' };
    if (this.state.ownedPlanes.includes(type)) return { ok: false, reason: 'Already owned' };
    if (this.state.money < cost) return { ok: false, reason: 'Not enough money' };
    this.state.money -= cost;
    this.state.ownedPlanes.push(type);
    this._save();
    return { ok: true, cost };
  }

  purchaseGun(id) {
    const gun = RACE.GUNS[id];
    if (!gun) return { ok: false, reason: 'Unavailable' };
    if (this.state.ownedGuns.includes(id)) return { ok: false, reason: 'Already owned' };
    if (this.state.money < gun.cost) return { ok: false, reason: 'Not enough money' };
    this.state.money -= gun.cost;
    this.state.ownedGuns.push(id);
    this.state.equippedGun = id;
    this._save();
    return { ok: true, cost: gun.cost };
  }

  equipGun(id) {
    if (!this.state.ownedGuns.includes(id)) return false;
    this.state.equippedGun = id;
    this._save();
    return true;
  }

  getEquippedGun() {
    return RACE.GUNS[this.state.equippedGun] ?? RACE.GUNS.standard;
  }

  getAvailablePlanes() {
    return Object.entries(AIRCRAFT)
      .filter(([type]) => !type.startsWith('custom'))
      .map(([type, aircraft]) => ({
      type,
      name: aircraft.name,
      owned: this.state.ownedPlanes.includes(type),
      cost: RACE.PLANE_COSTS[type] ?? 0,
      }));
  }

  getAvailableGuns() {
    return Object.entries(RACE.GUNS).map(([id, gun]) => ({
      id,
      ...gun,
      owned: this.state.ownedGuns.includes(id),
      equipped: this.state.equippedGun === id,
    }));
  }

  getDifficultyScale() {
    const rank = RACE.RANKS[this.state.rankIndex] ?? RACE.RANKS[0];
    return rank.aiSkill;
  }

  applyChallengeResult(score, time) {
    const cleanScore = Math.max(0, Math.round(score ?? 0));
    const cleanTime = Math.max(30, Number(time) || 30);
    const moneyDelta = Math.round(850 + cleanScore * 0.065 + Math.max(0, 180 - cleanTime) * 8);
    this.state.money += moneyDelta;
    this.state.raceHistory.unshift({
      mode: 'challenge',
      place: '-',
      at: new Date().toISOString(),
      moneyDelta,
      rankDelta: 0,
      legendScoreDelta: 0,
    });
    this.state.raceHistory = this.state.raceHistory.slice(0, 20);
    this._save();
    return { moneyDelta };
  }

  getRepairCost(type, condition = 100) {
    const aircraft = AIRCRAFT[type];
    if (!aircraft) return 0;
    const missing = Math.max(0, 100 - (condition ?? 100));
    if (missing <= 0) return 0;
    const base = 110 + Math.round((RACE.PLANE_COSTS[type] ?? 2000) * 0.012);
    return Math.round(base + missing * (5 + Math.max(aircraft.stats?.speed ?? 2, aircraft.stats?.agility ?? 2) * 2.1));
  }

  payRepair(type, condition = 100) {
    const cost = this.getRepairCost(type, condition);
    if (cost <= 0) return { ok: true, cost: 0 };
    if (this.state.money < cost) return { ok: false, reason: 'Not enough money', cost };
    this.state.money -= cost;
    this._save();
    return { ok: true, cost };
  }

  payRepairAll(fleet = []) {
    const totalCost = fleet.reduce((sum, item) => sum + this.getRepairCost(item.type, item.condition), 0);
    if (totalCost <= 0) return { ok: true, cost: 0 };
    if (this.state.money < totalCost) return { ok: false, reason: 'Not enough money', cost: totalCost };
    this.state.money -= totalCost;
    this._save();
    return { ok: true, cost: totalCost };
  }

  applyRaceResult(mode, place) {
    const placementMultiplier = RACE.PLACEMENT_MULTIPLIERS[place] ?? 0;
    const result = {
      moneyDelta: 0,
      rankDelta: 0,
      legendScoreDelta: 0,
      promoted: false,
      demoted: false,
      place,
    };

    if (mode === 'race_online_casual') {
      result.moneyDelta = RACE.MONEY_REWARDS[place] ?? 0;
      this.state.money += result.moneyDelta;
    }

    if (mode === 'race_online_ranked') {
      const finalRankIndex = RACE.RANKS.length - 1;
      if (this.state.rankIndex >= finalRankIndex) {
        const scoreDelta = Math.round(placementMultiplier * 180);
        this.state.legendScore = Math.max(0, this.state.legendScore + scoreDelta);
        result.legendScoreDelta = scoreDelta;
      } else {
        const rank = RACE.RANKS[this.state.rankIndex];
        const delta = placementMultiplier >= 0
          ? Math.round(rank.winGain * placementMultiplier)
          : Math.round(rank.lossPenalty * placementMultiplier);
        this.state.rankProgress += delta;
        result.rankDelta = delta;

        while (this.state.rankProgress >= 100 && this.state.rankIndex < finalRankIndex) {
          this.state.rankProgress -= 100;
          this.state.rankIndex++;
          result.promoted = true;
        }

        while (this.state.rankProgress < 0 && this.state.rankIndex > 0) {
          this.state.rankIndex--;
          this.state.rankProgress += 100;
          result.demoted = true;
        }

        if (this.state.rankIndex === 0) {
          this.state.rankProgress = Math.max(0, this.state.rankProgress);
        }
      }
    }

    this.state.raceHistory.unshift({
      mode,
      place,
      at: new Date().toISOString(),
      moneyDelta: result.moneyDelta,
      rankDelta: result.rankDelta,
      legendScoreDelta: result.legendScoreDelta,
    });
    this.state.raceHistory = this.state.raceHistory.slice(0, 20);
    this._save();
    return result;
  }
}
