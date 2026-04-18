/**
 * FlightSim Local Backend
 * Express server for:
 * - leaderboard endpoints
 * - local auth/session endpoints
 * - cloud-style profile sync across devices
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const storage = require('./storage');
const raceRooms = require('./raceRooms');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

function normalizeIdentity(value = '') {
  return String(value).trim().toLowerCase();
}

function createPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash = '') {
  const [salt, expectedHash] = String(storedHash).split(':');
  if (!salt || !expectedHash) return false;
  const actualHash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actualHash, 'hex'), Buffer.from(expectedHash, 'hex'));
}

function sanitizeProfile(profile = {}) {
  const objectOrNull = value => (value && typeof value === 'object' && !Array.isArray(value) ? value : null);
  return {
    career: objectOrNull(profile.career),
    damage: objectOrNull(profile.damage),
    settings: objectOrNull(profile.settings),
    controls: objectOrNull(profile.controls),
    activity: objectOrNull(profile.activity),
    customPlane: objectOrNull(profile.customPlane),
    updatedAt: new Date().toISOString(),
  };
}

const STARTER_PLANES = ['prop', 'fighter'];
const STARTER_GUNS = ['standard'];

function uniqueStringList(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(entry => String(entry ?? '').trim())
    .filter(Boolean))];
}

function normalizeCareerState(career = {}) {
  const ownedPlanes = uniqueStringList(career.ownedPlanes);
  const ownedGuns = uniqueStringList(career.ownedGuns);
  return {
    money: Math.max(0, Math.round(Number(career.money) || 0)),
    rankIndex: Math.max(0, Math.round(Number(career.rankIndex) || 0)),
    rankProgress: Math.max(0, Math.round(Number(career.rankProgress) || 0)),
    legendScore: Math.max(0, Math.round(Number(career.legendScore) || 0)),
    ownedPlanes: uniqueStringList([...STARTER_PLANES, ...ownedPlanes]),
    ownedGuns: uniqueStringList([...STARTER_GUNS, ...ownedGuns]),
    equippedGun: String(career.equippedGun ?? 'standard').trim() || 'standard',
    raceHistory: Array.isArray(career.raceHistory) ? career.raceHistory.slice(0, 20) : [],
  };
}

function normalizeDamageState(damage = {}) {
  if (!damage || typeof damage !== 'object' || Array.isArray(damage)) return {};
  return Object.fromEntries(
    Object.entries(damage).map(([type, condition]) => [
      type,
      Math.max(0, Math.min(100, Math.round(Number(condition) || 0))),
    ])
  );
}

function buildAdminProfileMutation(targetUser, changes = {}) {
  const currentProfile = sanitizeProfile(targetUser?.profile ?? {});
  const career = normalizeCareerState(currentProfile.career ?? {});
  const damage = normalizeDamageState(currentProfile.damage ?? {});
  const grantPlanes = uniqueStringList(changes.grantPlanes);
  const revokePlanes = new Set(uniqueStringList(changes.revokePlanes));
  const grantGuns = uniqueStringList(changes.grantGuns);
  const revokeGuns = new Set(uniqueStringList(changes.revokeGuns));
  const moneyDelta = Math.round(Number(changes.moneyDelta) || 0);
  const repairAll = !!changes.repairAll;

  career.money = Math.max(0, career.money + moneyDelta);
  career.ownedPlanes = uniqueStringList([...career.ownedPlanes, ...grantPlanes])
    .filter(type => !revokePlanes.has(type) || STARTER_PLANES.includes(type));
  career.ownedPlanes = uniqueStringList([...STARTER_PLANES, ...career.ownedPlanes]);
  career.ownedGuns = uniqueStringList([...career.ownedGuns, ...grantGuns])
    .filter(type => !revokeGuns.has(type) || STARTER_GUNS.includes(type));
  career.ownedGuns = uniqueStringList([...STARTER_GUNS, ...career.ownedGuns]);
  if (!career.ownedGuns.includes(career.equippedGun)) {
    career.equippedGun = career.ownedGuns[0] ?? 'standard';
  }

  if (repairAll) {
    Object.keys(damage).forEach(type => {
      damage[type] = 100;
    });
    career.ownedPlanes.forEach(type => {
      damage[type] = 100;
    });
  }

  return sanitizeProfile({
    ...currentProfile,
    career: {
      ...(currentProfile.career ?? {}),
      ...career,
    },
    damage,
  });
}

function getDefaultUserStatus() {
  return {
    banned: false,
    banReason: '',
    lastLoginAt: null,
    lastActiveAt: null,
    currentStorage: storage.isMongoConfigured() ? 'mongo' : 'local',
  };
}

function resolveUserRole(usernameKey = '') {
  const configured = String(process.env.DEV_USERNAMES ?? '')
    .split(',')
    .map(value => normalizeIdentity(value))
    .filter(Boolean);
  if (configured.includes(usernameKey)) return 'dev';
  if (usernameKey === 'admin' || usernameKey === 'developer' || usernameKey === 'dev') return 'dev';
  return 'player';
}

function summarizePlayerStats(user) {
  const activity = user?.profile?.activity ?? {};
  const career = user?.profile?.career ?? {};
  return {
    launches: Number(activity.totalLaunches) || 0,
    landings: Number(activity.totalLandings) || 0,
    crashes: Number(activity.totalCrashes) || 0,
    races: Number(activity.totalRaceStarts) || 0,
    challenges: Number(activity.totalChallengeStarts) || 0,
    money: Number(career.money) || 0,
    rankIndex: Number(career.rankIndex) || 0,
    rankProgress: Number(career.rankProgress) || 0,
    legendScore: Number(career.legendScore) || 0,
    planes: Array.isArray(career.ownedPlanes) ? career.ownedPlanes.length : STARTER_PLANES.length,
    guns: Array.isArray(career.ownedGuns) ? career.ownedGuns.length : STARTER_GUNS.length,
  };
}

function getPublicUser(user) {
  return {
    id: user.id,
    playerId: user.id,
    username: user.username,
    createdAt: user.createdAt,
    role: user.role ?? 'player',
    status: {
      ...(getDefaultUserStatus()),
      ...(user.status ?? {}),
    },
    stats: summarizePlayerStats(user),
  };
}

function summarizeUserForAdmin(user) {
  return {
    ...getPublicUser(user),
    usernameKey: user.usernameKey,
  };
}

function getWorldStreamingStatus() {
  const providers = {
    cesium: !!String(process.env.CESIUM_ION_TOKEN || '').trim(),
    mapbox: !!String(process.env.MAPBOX_ACCESS_TOKEN || '').trim(),
    arcgis: !!String(process.env.ARCGIS_API_KEY || '').trim(),
  };
  const requiredReady = providers.cesium && providers.mapbox;
  return {
    enabled: false,
    ready: false,
    phase: requiredReady ? 'credentials_configured' : 'not_configured',
    providers,
    migrationRequired: true,
    note: requiredReady
      ? 'Provider credentials are present, but the simulator still needs a globe-streaming engine migration before exact Earth mode can launch.'
      : 'Exact Earth mode requires external terrain and imagery providers and is not configured yet.',
    checkedAt: new Date().toISOString(),
  };
}

function getBearerToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.toLowerCase().startsWith('bearer ')) return null;
  return auth.slice(7).trim();
}

async function requireSession(req, res, next) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Missing session token' });
      return;
    }

    const session = await storage.getSession(token);
    if (!session?.userId) {
      res.status(401).json({ error: 'Invalid session token' });
      return;
    }

    const user = await storage.findUserById(session.userId);
    if (!user) {
      await storage.deleteSession(token);
      res.status(401).json({ error: 'Session user not found' });
      return;
    }
    if (user.status?.banned) {
      await storage.deleteSession(token);
      res.status(403).json({ error: 'This account is banned', reason: user.status?.banReason || '' });
      return;
    }

    req.sessionToken = token;
    req.session = session;
    req.user = user;
    next();
  } catch (error) {
    console.error('[Auth] Session lookup failed:', error.message);
    res.status(500).json({ error: 'Session storage unavailable' });
  }
}

function requireAdmin(req, res, next) {
  if ((req.user?.role ?? 'player') !== 'dev') {
    res.status(403).json({ error: 'Developer access required' });
    return;
  }
  next();
}

async function touchUser(userId, patch = {}) {
  const now = new Date().toISOString();
  const existing = await storage.findUserById(userId);
  if (!existing) return null;
  return storage.updateUserFields(userId, {
    ...patch,
    status: {
      ...getDefaultUserStatus(),
      ...(existing.status ?? {}),
      ...(patch.status ?? {}),
      lastActiveAt: patch.status?.lastActiveAt ?? now,
      currentStorage: storage.isMongoConfigured() ? 'mongo' : 'local',
    },
  });
}

async function issueSession(userId, extras = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  await storage.createSession(token, {
    userId,
    createdAt: new Date().toISOString(),
    ...extras,
  });
  return token;
}

app.get('/api', (req, res) => {
  res.json({ message: 'Flight Simulator API' });
});

app.get('/api/health', async (req, res) => {
  const storageHealth = await storage.checkStorageHealth();
  res.status(storageHealth.ok ? 200 : 503).json({
    ok: storageHealth.ok,
    storage: storageHealth.storage,
    mongoConfigured: storageHealth.mongoConfigured,
    dbName: storageHealth.dbName,
    error: storageHealth.error ?? null,
  });
});

app.get('/api/world-streaming/status', (req, res) => {
  res.json(getWorldStreamingStatus());
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    const scores = await storage.listScores();
    const sorted = [...scores].sort((a, b) => b.score - a.score);
    res.json(sorted);
  } catch (error) {
    console.error('[Leaderboard] Failed to load scores:', error.message);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

app.post('/api/submit-score', async (req, res) => {
  const { player_name, aircraft_type, game_mode, environment, score, player_id } = req.body;

  if (!player_name || !aircraft_type || !game_mode || !environment || score === undefined) {
    return res.status(400).json({
      error: 'Missing required fields: player_name, aircraft_type, game_mode, environment, score'
    });
  }

  if (typeof score !== 'number' || Number.isNaN(score)) {
    return res.status(400).json({ error: 'score must be a number' });
  }

  const entry = {
    id: uuidv4(),
    player_name: String(player_name).trim(),
    player_id: player_id ? String(player_id).trim() : '',
    aircraft_type: String(aircraft_type).trim(),
    game_mode: String(game_mode).trim(),
    environment: String(environment).trim(),
    score: Number(score),
    timestamp: new Date().toISOString(),
  };

  try {
    await storage.createScore(entry);
    console.log(`[Score] Saved: ${entry.player_name} - ${entry.score} (${entry.game_mode}/${entry.environment})`);
    res.status(201).json(entry);
  } catch (error) {
    console.error('[Score] Failed to save:', error.message);
    res.status(500).json({ error: 'Failed to save score' });
  }
});

app.post('/api/auth/signup', async (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  const usernameKey = normalizeIdentity(username);

  if (username.length < 3) {
    res.status(400).json({ error: 'Username must be at least 3 characters' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' });
    return;
  }

  try {
    const existingUser = await storage.findUserByUsernameKey(usernameKey);
    if (existingUser) {
      res.status(409).json({ error: 'Username already exists' });
      return;
    }

    const user = {
      id: uuidv4(),
      username,
      usernameKey,
      role: resolveUserRole(usernameKey),
      passwordHash: createPasswordHash(password),
      createdAt: new Date().toISOString(),
      status: {
        ...getDefaultUserStatus(),
        lastLoginAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
      },
      profile: sanitizeProfile({}),
    };

    await storage.createUser(user);

    const token = await issueSession(user.id);
    res.status(201).json({
      token,
      user: getPublicUser(user),
      profile: user.profile,
      storage: storage.isMongoConfigured() ? 'mongo' : 'local',
    });
  } catch (error) {
    console.error('[Auth] Signup failed:', error.message);
    res.status(500).json({ error: 'Unable to create account right now' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const username = normalizeIdentity(req.body?.username);
  const password = String(req.body?.password ?? '');
  try {
    const user = await storage.findUserByUsernameKey(username);

    if (!user || !verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }
    if (user.status?.banned) {
      res.status(403).json({ error: 'This account is banned', reason: user.status?.banReason || '' });
      return;
    }

    const updatedUser = await touchUser(user.id, {
      status: {
        lastLoginAt: new Date().toISOString(),
      },
    });

    const token = await issueSession(user.id);
    res.json({
      token,
      user: getPublicUser(updatedUser ?? user),
      profile: (updatedUser ?? user).profile ?? sanitizeProfile({}),
      storage: storage.isMongoConfigured() ? 'mongo' : 'local',
    });
  } catch (error) {
    console.error('[Auth] Login failed:', error.message);
    res.status(500).json({ error: 'Unable to sign in right now' });
  }
});

app.get('/api/auth/me', requireSession, async (req, res) => {
  await touchUser(req.user.id);
  res.json({
    user: getPublicUser(req.user),
    profile: req.user.profile ?? sanitizeProfile({}),
  });
});

app.post('/api/auth/logout', requireSession, async (req, res) => {
  try {
    await storage.deleteSession(req.sessionToken);
    res.json({ ok: true });
  } catch (error) {
    console.error('[Auth] Logout failed:', error.message);
    res.status(500).json({ error: 'Unable to sign out right now' });
  }
});

app.get('/api/profile', requireSession, (req, res) => {
  res.json(req.user.profile ?? sanitizeProfile({}));
});

app.post('/api/profile/sync', requireSession, async (req, res) => {
  try {
    const updatedUser = await storage.updateUserProfile(req.user.id, sanitizeProfile(req.body ?? {}));
    await touchUser(req.user.id);
    if (!updatedUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      ok: true,
      profile: updatedUser.profile,
      storage: storage.isMongoConfigured() ? 'mongo' : 'local',
    });
  } catch (error) {
    console.error('[Profile] Sync failed:', error.message);
    res.status(500).json({ error: 'Failed to sync profile' });
  }
});

app.get('/api/admin/users', requireSession, requireAdmin, async (req, res) => {
  try {
    const users = await storage.listUsers();
    res.json({
      users: users.map(summarizeUserForAdmin),
    });
  } catch (error) {
    console.error('[Admin] Failed to list users:', error.message);
    res.status(500).json({ error: 'Unable to load user roster' });
  }
});

app.post('/api/admin/users/:userId/ban', requireSession, requireAdmin, async (req, res) => {
  const targetId = String(req.params.userId ?? '').trim();
  const banned = !!req.body?.banned;
  const reason = String(req.body?.reason ?? '').trim();
  try {
    const target = await storage.findUserById(targetId);
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const updated = await storage.updateUserFields(targetId, {
      status: {
        ...getDefaultUserStatus(),
        ...(target.status ?? {}),
        banned,
        banReason: banned ? reason : '',
        lastActiveAt: target.status?.lastActiveAt ?? null,
        lastLoginAt: target.status?.lastLoginAt ?? null,
        currentStorage: storage.isMongoConfigured() ? 'mongo' : 'local',
      },
    });
    res.json({
      ok: true,
      user: summarizeUserForAdmin(updated ?? target),
    });
  } catch (error) {
    console.error('[Admin] Failed to update ban:', error.message);
    res.status(500).json({ error: 'Unable to update player status' });
  }
});

app.post('/api/admin/users/:userId/inventory', requireSession, requireAdmin, async (req, res) => {
  const targetId = String(req.params.userId ?? '').trim();
  try {
    const target = await storage.findUserById(targetId);
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const nextProfile = buildAdminProfileMutation(target, req.body ?? {});
    const updated = await storage.updateUserProfile(targetId, nextProfile);
    res.json({
      ok: true,
      user: summarizeUserForAdmin(updated ?? { ...target, profile: nextProfile }),
      profile: nextProfile,
    });
  } catch (error) {
    console.error('[Admin] Failed to update player inventory:', error.message);
    res.status(500).json({ error: 'Unable to update player inventory' });
  }
});

app.post('/api/admin/users/:userId/impersonate', requireSession, requireAdmin, async (req, res) => {
  const targetId = String(req.params.userId ?? '').trim();
  try {
    const target = await storage.findUserById(targetId);
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    if (target.status?.banned) {
      res.status(403).json({ error: 'Cannot impersonate a banned account' });
      return;
    }
    const token = await issueSession(target.id, {
      impersonatedBy: req.user.id,
    });
    res.json({
      ok: true,
      token,
      user: getPublicUser(target),
      profile: target.profile ?? sanitizeProfile({}),
      storage: storage.isMongoConfigured() ? 'mongo' : 'local',
    });
  } catch (error) {
    console.error('[Admin] Failed to impersonate user:', error.message);
    res.status(500).json({ error: 'Unable to impersonate player right now' });
  }
});

app.get('/api/race/lobby', requireSession, (req, res) => {
  const mode = req.query?.mode ? String(req.query.mode) : null;
  res.json({
    rooms: raceRooms.listPublicRooms(mode),
  });
});

app.post('/api/race/matchmaking/join', requireSession, (req, res) => {
  const aircraftType = String(req.body?.aircraftType ?? 'prop').trim() || 'prop';
  const mode = String(req.body?.mode ?? 'casual').trim();
  const session = raceRooms.joinMatchmaking(req.user, { mode, aircraftType });
  res.json(session);
});

app.post('/api/race/private/create', requireSession, (req, res) => {
  const aircraftType = String(req.body?.aircraftType ?? 'prop').trim() || 'prop';
  const name = String(req.body?.name ?? '').trim();
  const rules = req.body?.rules ?? {};
  const session = raceRooms.createPrivateRoom(req.user, { aircraftType, name, rules });
  res.status(201).json(session);
});

app.post('/api/race/private/join', requireSession, (req, res) => {
  const aircraftType = String(req.body?.aircraftType ?? 'prop').trim() || 'prop';
  const code = String(req.body?.code ?? '').trim();
  if (!code) {
    res.status(400).json({ error: 'Room code is required' });
    return;
  }

  const session = raceRooms.joinPrivateRoom(req.user, { code, aircraftType });
  if (session?.error) {
    res.status(404).json({ error: session.error });
    return;
  }
  res.json(session);
});

app.get('/api/race/rooms/:roomId', requireSession, (req, res) => {
  const room = raceRooms.getRoom(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }
  res.json(raceRooms.serializeRoom(room, req.user.id));
});

app.post('/api/race/rooms/:roomId/sync', requireSession, (req, res) => {
  const snapshot = raceRooms.syncPlayerState(req.params.roomId, req.user, req.body ?? {});
  if (snapshot?.error) {
    res.status(404).json({ error: snapshot.error });
    return;
  }
  res.json(snapshot);
});

app.post('/api/race/rooms/:roomId/leave', requireSession, (req, res) => {
  const ok = raceRooms.leaveRoom(req.params.roomId, req.user.id);
  res.json({ ok });
});

module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\nFlightSim backend running at http://localhost:${PORT}`);
    console.log(`Frontend:    http://localhost:${PORT}/`);
    console.log(`Leaderboard: http://localhost:${PORT}/api/leaderboard`);
    console.log(`Submit:      POST http://localhost:${PORT}/api/submit-score`);
    console.log(`Auth:        POST http://localhost:${PORT}/api/auth/signup`);
    console.log(`Profile:     POST http://localhost:${PORT}/api/profile/sync`);
    console.log(`Storage:     ${storage.isMongoConfigured() ? 'MongoDB' : 'Local JSON'}\n`);
  });
}
