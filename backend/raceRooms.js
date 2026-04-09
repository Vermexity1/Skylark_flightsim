const { v4: uuidv4 } = require('uuid');

const MAX_PLAYERS = 5;
const PLAYER_TIMEOUT_MS = 12000;
const ROOM_IDLE_MS = 1000 * 60 * 20;
const COUNTDOWN_MS = 5500;

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
  return [...room.players.values()].filter(player => now - player.updatedAtMs <= PLAYER_TIMEOUT_MS);
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
  const now = nowMs();
  const freshPlayers = getFreshPlayers(room);
  const requiredPlayers = room.privacy === 'public' ? MAX_PLAYERS : Math.min(2, MAX_PLAYERS);

  if (room.finishedAt) return;

  if (!freshPlayers.length) {
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
    if (freshPlayers.length >= requiredPlayers) {
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
      if (now - player.updatedAtMs > ROOM_IDLE_MS) {
        room.players.delete(playerId);
      }
    }
    if (!room.players.size && now - new Date(room.updatedAt).getTime() > ROOM_IDLE_MS) {
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
