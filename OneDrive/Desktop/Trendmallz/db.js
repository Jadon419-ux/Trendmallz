'use strict';

// Database access. Uses Postgres via DATABASE_URL (Railway); without it, falls
// back to an embedded Postgres (PGlite, dev dependency) stored in ./.data so the
// app runs locally with no setup.

const path    = require('path');
const session = require('express-session');

let _db = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,
  salt              TEXT NOT NULL,
  fname             TEXT NOT NULL,
  lname             TEXT NOT NULL,
  role              TEXT NOT NULL DEFAULT 'customer',
  brand_name        TEXT NOT NULL DEFAULT '',
  country_code      TEXT NOT NULL DEFAULT 'NG',
  referral_code     TEXT NOT NULL,
  wallet            INTEGER NOT NULL DEFAULT 0,
  referral_earnings INTEGER NOT NULL DEFAULT 0,
  referral_count    INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  sid    TEXT PRIMARY KEY,
  sess   JSONB NOT NULL,
  expire TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expire_idx ON sessions (expire);

CREATE TABLE IF NOT EXISTS orders (
  id             TEXT PRIMARY KEY,
  reference      TEXT NOT NULL UNIQUE,
  user_id        TEXT NOT NULL REFERENCES users (id),
  items          JSONB NOT NULL,
  subtotal       INTEGER NOT NULL,
  discount       INTEGER NOT NULL DEFAULT 0,
  delivery       INTEGER NOT NULL DEFAULT 0,
  total          INTEGER NOT NULL,
  commission     INTEGER NOT NULL DEFAULT 0,
  coupon         TEXT,
  shipping       JSONB NOT NULL,
  status         TEXT NOT NULL DEFAULT 'Awaiting Payment',
  payment_status TEXT NOT NULL DEFAULT 'pending',
  paid_amount    INTEGER,
  paid_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders (user_id);
`;

async function init() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    _db = { query: (text, params) => pool.query(text, params), kind: 'postgres' };
  } else {
    // Railway's disk is wiped on every deploy, so never fall back to local storage there
    if (process.env.RAILWAY_ENVIRONMENT) throw new Error('DATABASE_URL must be set on Railway (${{Postgres.DATABASE_URL}})');
    let PGlite;
    try { ({ PGlite } = require('@electric-sql/pglite')); }
    catch (_x) { throw new Error('DATABASE_URL is not set (and the local PGlite fallback is not installed)'); }
    const dir = process.env.PGLITE_DIR || path.join(__dirname, '.data', 'pglite');
    const lite = new PGlite(dir);
    _db = { query: (text, params) => lite.query(text, params), kind: 'pglite (' + dir + ')' };
  }
  for (const stmt of SCHEMA.split(';').map(s => s.trim()).filter(Boolean)) await _db.query(stmt);
  return _db.kind;
}

async function query(text, params = []) {
  const res = await _db.query(text, params);
  return res.rows;
}

async function one(text, params = []) {
  return (await query(text, params))[0] || null;
}

// ── Session store ─────────────────────────────────────────────────────────────
// Keeps express-session data in the sessions table so logins survive restarts
class PgSessionStore extends session.Store {
  constructor(ttlMs) {
    super();
    this.ttlMs = ttlMs;
    setInterval(() => { query('DELETE FROM sessions WHERE expire < now()').catch(() => {}); }, 3600 * 1000).unref();
  }
  _expiry(sess) {
    const exp = sess && sess.cookie && sess.cookie.expires;
    return exp ? new Date(exp) : new Date(Date.now() + this.ttlMs);
  }
  get(sid, cb) {
    one('SELECT sess FROM sessions WHERE sid = $1 AND expire > now()', [sid])
      .then(row => cb(null, row ? row.sess : null), cb);
  }
  set(sid, sess, cb) {
    query(
      'INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2, $3) ' +
      'ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire',
      [sid, JSON.stringify(sess), this._expiry(sess)]
    ).then(() => cb && cb(null), cb);
  }
  touch(sid, sess, cb) {
    query('UPDATE sessions SET expire = $2 WHERE sid = $1', [sid, this._expiry(sess)])
      .then(() => cb && cb(null), cb);
  }
  destroy(sid, cb) {
    query('DELETE FROM sessions WHERE sid = $1', [sid]).then(() => cb && cb(null), cb);
  }
}

module.exports = { init, query, one, PgSessionStore };
