const fs = require('fs');
const path = require('path');

const mongoModule = (() => {
  try {
    return require('mongodb');
  } catch {
    return null;
  }
})();

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'scores.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

const mongoState = {
  dbPromise: null,
  client: null,
};

function ensureDataFile(file, fallbackValue) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(fallbackValue, null, 2), 'utf8');
  }
}

function readJson(file, fallbackValue) {
  ensureDataFile(file, fallbackValue);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    console.error(`[Storage] Failed to read ${path.basename(file)}:`, error.message);
    return fallbackValue;
  }
}

function writeJson(file, value) {
  ensureDataFile(file, value);
  try {
    fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
  } catch (error) {
    console.error(`[Storage] Failed to write ${path.basename(file)}:`, error.message);
  }
}

function isMongoConfigured() {
  return !!process.env.MONGODB_URI;
}

function dbName() {
  return process.env.MONGODB_DB || 'skylarkflight';
}

function normalizeMongoDoc(doc) {
  if (!doc) return null;
  const normalized = { ...doc };
  if (normalized._id && !normalized.id) normalized.id = normalized._id;
  delete normalized._id;
  return normalized;
}

async function getMongoDb() {
  if (!isMongoConfigured()) return null;
  if (!mongoModule?.MongoClient) {
    throw new Error('MONGODB_URI is set but the mongodb package is not installed.');
  }

  if (!mongoState.dbPromise) {
    mongoState.dbPromise = (async () => {
      const client = new mongoModule.MongoClient(process.env.MONGODB_URI, {
        maxPoolSize: 10,
      });
      await client.connect();
      const db = client.db(dbName());
      await Promise.all([
        db.collection('users').createIndex({ usernameKey: 1 }, { unique: true }),
        db.collection('scores').createIndex({ score: -1 }),
        db.collection('sessions').createIndex({ createdAt: 1 }),
      ]);
      mongoState.client = client;
      return db;
    })().catch(error => {
      mongoState.dbPromise = null;
      throw error;
    });
  }

  return mongoState.dbPromise;
}

async function listScores() {
  const db = await getMongoDb();
  if (db) {
    const docs = await db.collection('scores').find({}).sort({ score: -1, timestamp: 1 }).toArray();
    return docs.map(normalizeMongoDoc);
  }
  return readJson(DATA_FILE, []);
}

async function createScore(entry) {
  const db = await getMongoDb();
  if (db) {
    await db.collection('scores').insertOne({ _id: entry.id, ...entry });
    const playerKey = entry.playerId || entry.player_id || entry.player_name;
    if (playerKey) {
      const docs = await db.collection('scores')
        .find({
          $or: [
            { playerId: playerKey },
            { player_id: playerKey },
            { player_name: playerKey },
          ],
        })
        .sort({ score: -1, timestamp: 1 })
        .toArray();
      const overflow = docs.slice(3).map(doc => doc._id);
      if (overflow.length) {
        await db.collection('scores').deleteMany({ _id: { $in: overflow } });
      }
    }
    return entry;
  }
  const scores = readJson(DATA_FILE, []);
  scores.push(entry);
  const playerKey = entry.playerId || entry.player_id || entry.player_name;
  if (playerKey) {
    const keep = [];
    const grouped = scores
      .filter(score => (score.playerId || score.player_id || score.player_name) === playerKey)
      .sort((a, b) => (b.score - a.score) || String(a.timestamp).localeCompare(String(b.timestamp)))
      .slice(0, 3)
      .map(score => score.id);
    scores.forEach(score => {
      const key = score.playerId || score.player_id || score.player_name;
      if (key !== playerKey || grouped.includes(score.id)) keep.push(score);
    });
    writeJson(DATA_FILE, keep);
    return entry;
  }
  writeJson(DATA_FILE, scores);
  return entry;
}

async function findUserByUsernameKey(usernameKey) {
  const db = await getMongoDb();
  if (db) {
    return normalizeMongoDoc(await db.collection('users').findOne({ usernameKey }));
  }
  const users = readJson(USERS_FILE, []);
  return users.find(user => user.usernameKey === usernameKey) ?? null;
}

async function findUserById(id) {
  const db = await getMongoDb();
  if (db) {
    return normalizeMongoDoc(await db.collection('users').findOne({ _id: id }));
  }
  const users = readJson(USERS_FILE, []);
  return users.find(user => user.id === id) ?? null;
}

async function createUser(user) {
  const db = await getMongoDb();
  if (db) {
    await db.collection('users').insertOne({ _id: user.id, ...user });
    return user;
  }
  const users = readJson(USERS_FILE, []);
  users.push(user);
  writeJson(USERS_FILE, users);
  return user;
}

async function listUsers() {
  const db = await getMongoDb();
  if (db) {
    const docs = await db.collection('users').find({}).sort({ createdAt: 1 }).toArray();
    return docs.map(normalizeMongoDoc);
  }
  return readJson(USERS_FILE, []);
}

async function updateUserProfile(userId, profile) {
  const db = await getMongoDb();
  if (db) {
    await db.collection('users').updateOne(
      { _id: userId },
      { $set: { profile } }
    );
    return normalizeMongoDoc(await db.collection('users').findOne({ _id: userId }));
  }

  const users = readJson(USERS_FILE, []);
  const userIndex = users.findIndex(entry => entry.id === userId);
  if (userIndex < 0) return null;
  users[userIndex].profile = profile;
  writeJson(USERS_FILE, users);
  return users[userIndex];
}

async function updateUserFields(userId, fields = {}) {
  const cleanFields = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined)
  );
  const db = await getMongoDb();
  if (db) {
    await db.collection('users').updateOne(
      { _id: userId },
      { $set: cleanFields }
    );
    return normalizeMongoDoc(await db.collection('users').findOne({ _id: userId }));
  }

  const users = readJson(USERS_FILE, []);
  const userIndex = users.findIndex(entry => entry.id === userId);
  if (userIndex < 0) return null;
  users[userIndex] = {
    ...users[userIndex],
    ...cleanFields,
  };
  writeJson(USERS_FILE, users);
  return users[userIndex];
}

async function getSession(token) {
  const db = await getMongoDb();
  if (db) {
    const doc = await db.collection('sessions').findOne({ _id: token });
    if (!doc) return null;
    return { token, userId: doc.userId, createdAt: doc.createdAt };
  }

  const sessions = readJson(SESSIONS_FILE, {});
  const session = sessions[token];
  return session ? { token, ...session } : null;
}

async function createSession(token, session) {
  const db = await getMongoDb();
  if (db) {
    await db.collection('sessions').replaceOne(
      { _id: token },
      { _id: token, ...session },
      { upsert: true }
    );
    return { token, ...session };
  }

  const sessions = readJson(SESSIONS_FILE, {});
  sessions[token] = session;
  writeJson(SESSIONS_FILE, sessions);
  return { token, ...session };
}

async function deleteSession(token) {
  const db = await getMongoDb();
  if (db) {
    await db.collection('sessions').deleteOne({ _id: token });
    return;
  }

  const sessions = readJson(SESSIONS_FILE, {});
  delete sessions[token];
  writeJson(SESSIONS_FILE, sessions);
}

async function checkStorageHealth() {
  try {
    if (!isMongoConfigured()) {
      return {
        ok: true,
        storage: 'local',
        mongoConfigured: false,
        dbName: dbName(),
      };
    }

    const db = await getMongoDb();
    await db.command({ ping: 1 });
    return {
      ok: true,
      storage: 'mongo',
      mongoConfigured: true,
      dbName: dbName(),
    };
  } catch (error) {
    return {
      ok: false,
      storage: isMongoConfigured() ? 'mongo' : 'local',
      mongoConfigured: isMongoConfigured(),
      dbName: dbName(),
      error: error.message,
    };
  }
}

module.exports = {
  isMongoConfigured,
  checkStorageHealth,
  listScores,
  createScore,
  findUserByUsernameKey,
  findUserById,
  createUser,
  listUsers,
  updateUserProfile,
  updateUserFields,
  getSession,
  createSession,
  deleteSession,
};
