// Postgres access layer for accounts + saved player data.
//
// Everything here is OPTIONAL: if DATABASE_URL is not set, the server runs
// exactly as before with accounts disabled. Nothing else in the game depends
// on this module succeeding, so a missing/blank database can never break play.
const { Pool } = require('pg');

const url = process.env.DATABASE_URL || '';
let pool = null;
let ready = false;

if (url) {
  pool = new Pool({
    connectionString: url,
    // Neon (and most hosted Postgres) require SSL; the cert chain is theirs.
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  // A pool-level error handler keeps a dropped connection from crashing the
  // whole server (free-tier databases sleep and reconnect).
  pool.on('error', (e) => console.error('[db] pool error:', e.message));
}

// Create tables if they don't exist. Called once at startup.
async function init() {
  if (!pool) {
    console.log('[db] DATABASE_URL not set — accounts DISABLED (guest play only)');
    return false;
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id             SERIAL PRIMARY KEY,
        username       TEXT NOT NULL,
        username_lower TEXT UNIQUE NOT NULL,
        pass_hash      TEXT NOT NULL,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_data (
        user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        study_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
        prefs           JSONB NOT NULL DEFAULT '{}'::jsonb,
        stats           JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    // Career/story-mode progress (added later; additive + idempotent).
    await pool.query(`ALTER TABLE user_data ADD COLUMN IF NOT EXISTS career JSONB NOT NULL DEFAULT '{}'::jsonb;`);
    // Per-city best solo times (leaderboards). One row per player per city.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS leaderboard (
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        city       TEXT NOT NULL,
        username   TEXT NOT NULL,
        mins       INTEGER NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, city)
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS leaderboard_city_mins ON leaderboard (city, mins);`);
    ready = true;
    console.log('[db] accounts ENABLED — schema ready');
    return true;
  } catch (e) {
    console.error('[db] init failed — accounts DISABLED:', e.message);
    ready = false;
    return false;
  }
}

module.exports = {
  init,
  get enabled() { return !!pool && ready; },
  hasUrl: !!url,
  query: (...args) => pool.query(...args),
};
