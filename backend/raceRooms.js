const { v4: uuidv4 } = require('uuid');

const MAX_PLAYERS = 5;
const MIN_PUBLIC_START_PLAYERS = 3;
const PLAYER_TIMEOUT_MS = 12000;
const ROOM_IDLE_MS = 1000 * 60 * 20;
const COUNTDOWN_MS = 5500;
const BOT_FILL_DELAY_MS = 35000;
const BOT_NAMES = ['Sable', 'Comet', 'Aster', 'Nova', 'Vortex', 'Mistral', 'Ember', 'Onyx'];
const LAP_COUNT = 3;
const RACE_TRACK = [
  { x: 0, y: 520, z: 1760 },
  { x: 880, y: 560, z: 1320 },
  { x: 1820, y: 610, z: 620 },
  { x: 2460, y: 700, z: -420 },
  { x: 2280, y: 770, z: -1600 },
  { x: 1280, y: 840, z: -2480 },
  { x: 0, y: 878, z: -2860 },
  { x: -1340, y: 834, z: -2480 },
  { x: -2340, y: 760, z: -1580 },
  { x: -2620, y: 676, z: -320 },
  { x: -2100, y: 612, z: 980 },
  { x: -980, y: 556, z: 1760 },
];
const RACE_START_POSITIONS = [
  { x: -300, y: 520, z: 2550 },
  { x: -180, y: 520, z: 2485 },
  { x: -60, y: 520, z: 2420 },
  { x: 60, y: 520, z: 2420 },
  { x: 180, y: 520, z: 2485 },
  { x: 300, y: 520, z: 2550 },
];

const rooms = new Map();

function nowMs() {
  return Date.now();
}

function nowIso() {
  return new Date().toISOString();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function normalizeMode(value) {
  return value === 'ranked' ? 'ranked' : value === 'private' ? 'private' : 'casual';
}

function sanitizeRules(rules = {}, mode = 'casual') {
  return {
    speedMultiplier: clamp(Number(rules.speedMultiplier) || 1, 0.7, 1.35),
    physicsPreset: ['sim', 'sport', 'arcade'].includes(rules.physicsPreset) ? rules.physicsPreset : 'sim',
    autoLandAllowed: mode === 'ranked' ? false : !!rules.autoLandAllowed,
  };
}

function sanitizeNumericVector(vector = {}, defaults = {}) {
  return {
    x: Number.isFinite(Number(vector.x)) ? Number(vector.x) : (defaults.x ?? 0),
    y: Number.isFinite(Number(vector.y)) ? Number(vector.y) : (defaults.y ?? 0),
    z: Number.isFinite(Number(vector.z)) ? Number(vector.z) : (defaults.z ?? 0),
  };
}

function sanitizeQuaternion(quaternion = {}) {
  return {
    x: Number.isFinite(Number(quaternion.x)) ? Number(quaternion.x) : 0,
    y: Number.isFinite(Number(quaternion.y)) ? Number(quaternion.y) : 0,
    z: Number.isFinite(Number(quaternion.z)) ? Number(quaternion.z) : 0,
    w: Number.isFinite(Number(quaternion.w)) ? Number(quaternion.w) : 1,
  };
}

function createRoom({ mode, ownerId, ownerName, rules, privacy = 'public', name = null }) {
  const normalizedMode = normalizeMode(mode);
  const room = {
    id: uuidv4(),
    code: createCode(),
    name: name?.trim?.() || `${normalizedMode.toUpperCase()} FLIGHT`,
    mode: normalizedMode,
    privacy,
    ownerId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    countdownEndsAt: null,
    startedAt: null,
    finishedAt: null,
    botFillAt: normalizedMode !== 'private' ? nowMs() + BOT_FILL_DELAY_MS : null,
    botCursor: 0,
    rules: sanitizeRules(rules, normalizedMode),
    players: new Map(),
    lastSnapshot: null,
    ownerName,
  };
  rooms.set(room.id, room);
  return room;
}

function getRoom(roomId) {
  cleanupRooms();
  return rooms.get(roomId) ?? null;
}

function getRoomByCode(code = '') {
  cleanupRooms();
  const wanted = String(code).trim().toUpperCase();
  if (!wanted) return null;
  for (const room of rooms.values()) {
    if (room.code === wanted) return room;
  }
  return null;
}

function getFreshPlayers(room) {
  const now = nowMs();
  return [...room.players.values()].filter(player => player.isBot || now - player.updatedAtMs <= PLAYER_TIMEOUT_MS);
}

function getHumanPlayers(room) {
  return getFreshPlayers(room).filter(player => !player.isBot);
}

function getTrackPoint(index) {
  return RACE_TRACK[index % RACE_TRACK.length];
}

function buildQuaternion(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const length = Math.max(0.0001, Math.sqrt(dx * dx + dy * dy + dz * dz));
  const dir = { x: dx / length, y: dy / length, z: dz / length };
  const yaw = Math.atan2(dir.x, dir.z);
  const pitch = -Math.asin(dir.y);
  const cy = Math.cos(yaw * 0.5);
  const sy = Math.sin(yaw * 0.5);
  const cp = Math.cos(pitch * 0.5);
  const sp = Math.sin(pitch * 0.5);
  return {
    x: sp * cy,
    y: cp * sy,
    z: -sp * sy,
    w: cp * cy,
  };
}

function positionOnTrack(segmentIndex, t) {
  const start = getTrackPoint(segmentIndex);
  const end = getTrackPoint(segmentIndex + 1);
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
    z: start.z + (end.z - start.z) * t,
  };
}

function ensureBotField(player, fallbackIndex = 0) {
  if (!player.botState) {
    const start = RACE_START_POSITIONS[fallbackIndex % RACE_START_POSITIONS.length];
    const gate = getTrackPoint(0);
    player.botState = {
      segmentIndex: 0,
      segmentT: 0,
      currentSpeed: 0,
      baseSpeed: 250 + (fallbackIndex % 4) * 28,
      acceleration: 140 + (fallbackIndex % 5) * 18,
    };
    player.state = {
      position: { ...start },
      quaternion: buildQuaternion(start, gate),
      speed: 0,
      throttle: 0,
    };
  }
}

function fillRoomWithBots(room, countNeeded) {
  for (let i = 0; i < countNeeded; i++) {
    const index = room.botCursor++;
    const userId = `bot-${room.id}-${index}`;
    if (room.players.has(userId)) continue;
    const start = RACE_START_POSITIONS[(index + 1) % RACE_START_POSITIONS.length];
    const gate = getTrackPoint(0);
    room.players.set(userId, {
      userId,
      username: BOT_NAMES[index % BOT_NAMES.length],
      aircraftType: ['prop', 'jet', 'fighter', 'mustang', 'raptor', 'concorde'][index % 6],
      ready: true,
      isHost: false,
      isBot: true,
      joinedAt: nowIso(),
      updatedAt: nowIso(),
      updatedAtMs: nowMs(),
      progress: 0,
      lap: 1,
      gate: 0,
      finished: false,
      place: null,
      state: {
        position: { ...start },
        quaternion: buildQuaternion(start, gate),
        speed: 0,
        throttle: 0,
      },
      botState: {
        segmentIndex: 0,
        segmentT: 0,
        currentSpeed: 0,
        baseSpeed: 250 + (index % 4) * 28,
        acceleration: 140 + (index % 5) * 18,
      },
    });
  }
}

function updateBotPlayers(room) {
  const freshPlayers = getFreshPlayers(room);
  const humanPlayers = freshPlayers.filter(player => !player.isBot);
  if (room.privacy === 'public' && !room.startedAt && !room.finishedAt && humanPlayers.length > 0 && nowMs() >= (room.botFillAt ?? Infinity)) {
    fillRoomWithBots(room, Math.max(0, MAX_PLAYERS - freshPlayers.length));
  }

  const currentPlayers = getFreshPlayers(room).filter(player => player.isBot);
  if (!currentPlayers.length) return;

  const currentTime = nowMs();
  currentPlayers.forEach((player, index) => {
    ensureBotField(player, index);
    player.updatedAt = nowIso();
    player.updatedAtMs = currentTime;
    if (!room.startedAt || room.finishedAt) {
      player.state.speed = 0;
      player.state.throttle = 0;
      return;
    }
    if (player.finished) return;

    const state = player.botState;
    const dt = Math.min(0.45, Math.max(0.016, (currentTime - (state.lastStepAt ?? currentTime - 100)) / 1000));
    state.lastStepAt = currentTime;
    const targetSpeed = state.baseSpeed;
    if (Math.abs(targetSpeed - state.currentSpeed) <= state.acceleration * dt) state.currentSpeed = targetSpeed;
    else state.currentSpeed += Math.sign(targetSpeed - state.currentSpeed) * state.acceleration * dt;

    let remaining = state.currentSpeed * dt;
    while (remaining > 0 && !player.finished) {
      const start = getTrackPoint(state.segmentIndex);
      const end = getTrackPoint(state.segmentIndex + 1);
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const dz = end.z - start.z;
      const length = Math.max(1, Math.sqrt(dx * dx + dy * dy + dz * dz));
      const left = length * (1 - state.segmentT);
      if (remaining >= left) {
        remaining -= left;
        state.segmentIndex = (state.segmentIndex + 1) % RACE_TRACK.length;
        state.segmentT = 0;
        if (state.segmentIndex === 0) {
          player.lap += 1;
          if (player.lap > LAP_COUNT) {
            player.finished = true;
            break;
          }
        }
      } else {
        state.segmentT += remaining / length;
        remaining = 0;
      }
    }

    if (player.finished) {
      player.progress = LAP_COUNT * RACE_TRACK.length;
      if (!player.place) {
        const occupied = [...room.players.values()].map(entry => entry.place).filter(Boolean);
        let nextPlace = 1;
        while (occupied.includes(nextPlace)) nextPlace += 1;
        player.place = nextPlace;
      }
      return;
    }

    const position = positionOnTrack(state.segmentIndex, state.segmentT);
    const nextPosition = positionOnTrack(state.segmentIndex + 1, Math.min(1, state.segmentT + 0.04));
    player.gate = state.segmentIndex;
    player.progress = (player.lap - 1) * RACE_TRACK.length + state.segmentIndex + state.segmentT;
    player.state = {
      position,
      quaternion: buildQuaternion(position, nextPosition),
      speed: state.currentSpeed,
      throttle: Math.min(1, state.currentSpeed / Math.max(280, state.baseSpeed)),
    };
  });
}

function ensurePlayer(room, user, aircraftType = 'prop') {
  let player = room.players.get(user.id);
  if (!player) {
    player = {
      userId: user.id,
      username: user.username,
      aircraftType,
      ready: true,
      isHost: room.ownerId === user.id,
      joinedAt: nowIso(),
      updatedAt: nowIso(),
      updatedAtMs: nowMs(),
      progress: 0,
      lap: 1,
      gate: 0,
      finished: false,
      place: null,
      state: {
        position: { x: 0, y: 0, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        speed: 0,
        throttle: 0,
      },
    };
    room.players.set(user.id, player);
  }

  player.username = user.username;
  player.aircraftType = aircraftType || player.aircraftType;
  player.isHost = room.ownerId === user.id;
  player.updatedAt = nowIso();
  player.updatedAtMs = nowMs();
  room.updatedAt = nowIso();
  return player;
}

function updatePlaces(room) {
  const players = [...room.players.values()];
  players.sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.finished && b.finished && a.place !== b.place) return (a.place ?? 999) - (b.place ?? 999);
    return (b.progress ?? 0) - (a.progress ?? 0);
  });
  players.forEach((player, index) => {
    if (!player.finished) player.place = index + 1;
  });
}

function maybeAdvanceRoomState(room) {
  updateBotPlayers(room);
  const now = nowMs();
  const freshPlayers = getFreshPlayers(room);
  const humanPlayers = freshPlayers.filter(player => !player.isBot);
  const requiredPlayers = room.privacy === 'public' ? MIN_PUBLIC_START_PLAYERS : Math.min(2, MAX_PLAYERS);

  if (room.finishedAt) return;

  if (!humanPlayers.length) {
    room.countdownEndsAt = null;
    room.startedAt = null;
    return;
  }

  const everyoneFinished = freshPlayers.length >= 2 && freshPlayers.every(player => player.finished);
  if (everyoneFinished) {
    room.finishedAt = nowIso();
    room.countdownEndsAt = null;
    return;
  }

  if (!room.startedAt) {
    if (humanPlayers.length >= requiredPlayers || freshPlayers.length >= requiredPlayers) {
      if (!room.countdownEndsAt) {
        room.countdownEndsAt = now + COUNTDOWN_MS;
      } else if (now >= room.countdownEndsAt) {
        room.startedAt = nowIso();
        room.countdownEndsAt = null;
      }
    } else {
      room.countdownEndsAt = null;
    }
  }
}

function serializePlayer(player, viewerId) {
  return {
    userId: player.userId,
    username: player.username,
    isBot: !!player.isBot,
    aircraftType: player.aircraftType,
    ready: !!player.ready,
    isHost: !!player.isHost,
    isSelf: player.userId === viewerId,
    progress: Number(player.progress) || 0,
    lap: Number(player.lap) || 1,
    gate: Number(player.gate) || 0,
    finished: !!player.finished,
    place: player.place ?? null,
    updatedAt: player.updatedAt,
    state: {
      position: { ...player.state.position },
      quaternion: { ...player.state.quaternion },
      speed: Number(player.state.speed) || 0,
      throttle: Number(player.state.throttle) || 0,
    },
  };
}

function serializeRoom(room, viewerId) {
  maybeAdvanceRoomState(room);
  updatePlaces(room);

  const freshPlayers = getFreshPlayers(room);
  const players = freshPlayers
    .sort((a, b) => (a.place ?? 999) - (b.place ?? 999))
    .map(player => serializePlayer(player, viewerId));

  const countdownRemaining = room.countdownEndsAt
    ? Math.max(0, (room.countdownEndsAt - nowMs()) / 1000)
    : 0;

  return {
    room: {
      id: room.id,
      code: room.code,
      name: room.name,
      mode: room.mode,
      privacy: room.privacy,
      ownerId: room.ownerId,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      playerCount: players.length,
      maxPlayers: MAX_PLAYERS,
      status: room.finishedAt ? 'finished' : room.startedAt ? 'live' : countdownRemaining > 0 ? 'countdown' : 'waiting',
      countdownRemaining,
      rules: { ...room.rules },
    },
    players,
  };
}

function cleanupRooms() {
  const now = nowMs();
  for (const [roomId, room] of rooms.entries()) {
    for (const [playerId, player] of room.players.entries()) {
      if (player.isBot) continue;
      if (now - player.updatedAtMs > ROOM_IDLE_MS) {
        room.players.delete(playerId);
      }
    }
    const humansLeft = [...room.players.values()].some(player => !player.isBot);
    if (!humansLeft || (!room.players.size && now - new Date(room.updatedAt).getTime() > ROOM_IDLE_MS)) {
      rooms.delete(roomId);
    }
  }
}

function listPublicRooms(mode = null) {
  cleanupRooms();
  return [...rooms.values()]
    .filter(room => room.privacy === 'public')
    .filter(room => !mode || room.mode === normalizeMode(mode))
    .map(room => serializeRoom(room, null).room)
    .filter(room => room.status !== 'finished');
}

function joinMatchmaking(user, { mode = 'casual', aircraftType = 'prop' } = {}) {
  cleanupRooms();
  const normalizedMode = normalizeMode(mode);
  let room = [...rooms.values()].find(candidate => (
    candidate.mode === normalizedMode
    && candidate.privacy === 'public'
    && !candidate.startedAt
    && !candidate.finishedAt
    && candidate.players.size < MAX_PLAYERS
  ));

  if (!room) {
    room = createRoom({
      mode: normalizedMode,
      privacy: 'public',
      name: normalizedMode === 'ranked' ? 'Ranked Flight' : 'Casual Flight',
      ownerId: user.id,
      ownerName: user.username,
      rules: normalizedMode === 'ranked'
        ? { speedMultiplier: 1, physicsPreset: 'sim', autoLandAllowed: false }
        : { speedMultiplier: 1, physicsPreset: 'sport', autoLandAllowed: false },
    });
  }

  ensurePlayer(room, user, aircraftType);
  return serializeRoom(room, user.id);
}

function createPrivateRoom(user, { aircraftType = 'prop', name = null, rules = {} } = {}) {
  cleanupRooms();
  const room = createRoom({
    mode: 'private',
    privacy: 'private',
    name,
    ownerId: user.id,
    ownerName: user.username,
    rules,
  });
  ensurePlayer(room, user, aircraftType);
  return serializeRoom(room, user.id);
}

function joinPrivateRoom(user, { code, aircraftType = 'prop' } = {}) {
  const room = getRoomByCode(code);
  if (!room) {
    return { error: 'Private room not found' };
  }
  if (room.players.size >= MAX_PLAYERS && !room.players.has(user.id)) {
    return { error: 'Room is full' };
  }
  if (room.finishedAt) {
    return { error: 'Room already finished' };
  }
  ensurePlayer(room, user, aircraftType);
  return serializeRoom(room, user.id);
}

function syncPlayerState(roomId, user, payload = {}) {
  const room = getRoom(roomId);
  if (!room) return { error: 'Room not found' };

  const player = ensurePlayer(room, user, payload.aircraftType);
  player.progress = Number(payload.progress) || 0;
  player.lap = Math.max(1, Number(payload.lap) || 1);
  player.gate = Math.max(0, Number(payload.gate) || 0);
  player.finished = !!payload.finished;
  if (player.finished && !player.place) {
    const occupiedPlaces = [...room.players.values()].map(entry => entry.place).filter(Boolean);
    let nextPlace = 1;
    while (occupiedPlaces.includes(nextPlace)) nextPlace += 1;
    player.place = nextPlace;
  }
  player.state = {
    position: sanitizeNumericVector(payload.state?.position, player.state?.position),
    quaternion: sanitizeQuaternion(payload.state?.quaternion),
    speed: Number(payload.state?.speed) || 0,
    throttle: Number(payload.state?.throttle) || 0,
  };
  player.updatedAt = nowIso();
  player.updatedAtMs = nowMs();
  room.updatedAt = nowIso();

  return serializeRoom(room, user.id);
}

function leaveRoom(roomId, userId) {
  const room = getRoom(roomId);
  if (!room) return false;
  room.players.delete(userId);
  room.updatedAt = nowIso();
  if (!room.players.size) {
    rooms.delete(roomId);
  }
  return true;
}

module.exports = {
  listPublicRooms,
  joinMatchmaking,
  createPrivateRoom,
  joinPrivateRoom,
  syncPlayerState,
  getRoom,
  serializeRoom,
  leaveRoom,
  sanitizeRules,
};
