// Username + password accounts. Passwords are bcrypt-hashed; sessions are
// stateless JWTs the client keeps in localStorage. All functions no-op safely
// when the database is disabled.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

// In production AUTH_SECRET is set/auto-generated on Render (see render.yaml).
// If it's ever missing we mint a strong random secret for this process rather
// than trust a value committed to a public repo — tokens then simply don't
// survive a restart (players re-log in), but they can never be forged.
const SECRET = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.AUTH_SECRET) {
  console.warn('[auth] AUTH_SECRET not set — using an ephemeral secret (logins reset on restart)');
}
const TOKEN_TTL = '120d';
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function sign(user) {
  return jwt.sign({ uid: user.id, username: user.username }, SECRET, { expiresIn: TOKEN_TTL });
}

function verifyToken(token) {
  try { return jwt.verify(token, SECRET); } catch { return null; }
}

async function register(username, password) {
  if (!db.enabled) return { error: 'Accounts are not set up on this server yet' };
  username = String(username || '').trim();
  if (!USERNAME_RE.test(username)) {
    return { error: 'Username must be 3–20 letters, numbers, or underscores' };
  }
  if (typeof password !== 'string' || password.length < 6) {
    return { error: 'Password must be at least 6 characters' };
  }
  const lower = username.toLowerCase();
  const taken = await db.query('SELECT 1 FROM users WHERE username_lower = $1', [lower]);
  if (taken.rowCount) return { error: 'That username is taken' };

  const hash = await bcrypt.hash(password, 10);
  const ins = await db.query(
    'INSERT INTO users (username, username_lower, pass_hash) VALUES ($1, $2, $3) RETURNING id, username',
    [username, lower, hash]
  );
  const user = ins.rows[0];
  await db.query('INSERT INTO user_data (user_id) VALUES ($1)', [user.id]);
  return { ok: true, token: sign(user), username: user.username };
}

async function login(username, password) {
  if (!db.enabled) return { error: 'Accounts are not set up on this server yet' };
  const lower = String(username || '').trim().toLowerCase();
  const res = await db.query(
    'SELECT id, username, pass_hash FROM users WHERE username_lower = $1',
    [lower]
  );
  if (!res.rowCount) return { error: 'No account with that username' };
  const user = res.rows[0];
  const ok = await bcrypt.compare(String(password || ''), user.pass_hash);
  if (!ok) return { error: 'Wrong password' };
  return { ok: true, token: sign(user), username: user.username };
}

async function getData(uid) {
  const res = await db.query(
    'SELECT study_questions, prefs, stats, career FROM user_data WHERE user_id = $1',
    [uid]
  );
  if (!res.rowCount) return { studyQuestions: [], prefs: {}, stats: {}, career: {} };
  const r = res.rows[0];
  return { studyQuestions: r.study_questions, prefs: r.prefs, stats: r.stats, career: r.career || {} };
}

// Only the fields present in `patch` are overwritten.
async function saveData(uid, patch) {
  const sets = [];
  const vals = [uid];
  if (patch && patch.studyQuestions !== undefined) {
    vals.push(JSON.stringify(patch.studyQuestions));
    sets.push(`study_questions = $${vals.length}`);
  }
  if (patch && patch.prefs !== undefined) {
    vals.push(JSON.stringify(patch.prefs));
    sets.push(`prefs = $${vals.length}`);
  }
  if (patch && patch.career !== undefined) {
    vals.push(JSON.stringify(patch.career));
    sets.push(`career = $${vals.length}`);
  }
  if (!sets.length) return { ok: true };
  sets.push('updated_at = now()');
  await db.query(`UPDATE user_data SET ${sets.join(', ')} WHERE user_id = $1`, vals);
  return { ok: true };
}

// Bump lifetime stats after a finished game (client-reported).
async function recordGame(uid, { won, coins, city } = {}) {
  const cur = await getData(uid);
  const s = cur.stats || {};
  s.games = (s.games || 0) + 1;
  if (won) s.wins = (s.wins || 0) + 1;
  s.coins = (s.coins || 0) + (Number(coins) || 0);
  if (city) s.lastCity = city;
  await db.query('UPDATE user_data SET stats = $2, updated_at = now() WHERE user_id = $1', [
    uid, JSON.stringify(s),
  ]);
  return { ok: true, stats: s };
}

// Record a finished solo run's time; keeps only each player's best per city.
async function recordScore(uid, username, city, mins) {
  city = String(city || '').slice(0, 40);
  mins = Math.round(Number(mins));
  if (!city || !Number.isFinite(mins) || mins < 0 || mins > 100000) return { ok: false };
  await db.query(
    `INSERT INTO leaderboard (user_id, city, username, mins, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id, city) DO UPDATE
       SET mins = LEAST(leaderboard.mins, EXCLUDED.mins),
           username = EXCLUDED.username,
           updated_at = now()`,
    [uid, city, username, mins]
  );
  return { ok: true };
}

// Public: the fastest times for a city (lowest minutes first).
async function topScores(city, limit = 20) {
  const res = await db.query(
    `SELECT username, mins, updated_at FROM leaderboard
     WHERE city = $1 ORDER BY mins ASC, updated_at ASC LIMIT $2`,
    [String(city || '').slice(0, 40), Math.min(50, Math.max(1, limit | 0))]
  );
  return res.rows.map((r) => ({ username: r.username, mins: r.mins }));
}

// ---- Player-made maps ---------------------------------------------------
async function saveMap(uid, name, def, id) {
  name = String(name || 'Custom Map').slice(0, 40);
  const json = JSON.stringify(def || {});
  if (json.length > 400000) return { error: 'That map is too large to save' };
  if (id) {
    const res = await db.query(
      `UPDATE maps SET name = $1, def = $2::jsonb, updated_at = now()
       WHERE id = $3 AND owner_id = $4 RETURNING id`,
      [name, json, id, uid]
    );
    if (!res.rowCount) return { error: 'Map not found' };
    return { ok: true, id: res.rows[0].id };
  }
  const cnt = await db.query('SELECT count(*)::int AS n FROM maps WHERE owner_id = $1', [uid]);
  if (cnt.rows[0].n >= 50) return { error: 'You have hit the 50-map limit — delete one first' };
  const ins = await db.query(
    'INSERT INTO maps (owner_id, name, def) VALUES ($1, $2, $3::jsonb) RETURNING id',
    [uid, name, json]
  );
  return { ok: true, id: ins.rows[0].id };
}

async function listMyMaps(uid) {
  const res = await db.query(
    'SELECT id, name, def, is_public, updated_at FROM maps WHERE owner_id = $1 ORDER BY updated_at DESC',
    [uid]
  );
  return res.rows.map((r) => ({ id: r.id, name: r.name, def: r.def, isPublic: r.is_public }));
}

async function deleteMap(uid, id) {
  const res = await db.query('DELETE FROM maps WHERE id = $1 AND owner_id = $2', [id, uid]);
  return { ok: !!res.rowCount };
}

module.exports = {
  sign, verifyToken, register, login, getData, saveData, recordGame,
  recordScore, topScores, saveMap, listMyMaps, deleteMap,
};
