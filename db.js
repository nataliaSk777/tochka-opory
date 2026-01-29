const Database = require('better-sqlite3');

const db = new Database(process.env.DB_PATH || './data.sqlite');
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  user_id INTEGER PRIMARY KEY,
  first_name TEXT,
  tone TEXT DEFAULT 'soft',          -- soft | brave | neutral
  trial_start INTEGER,               -- unix ms
  subscribed INTEGER DEFAULT 0,       -- 0/1
  free_mode TEXT DEFAULT 'morning',   -- morning | evening
  heavy_evenings INTEGER DEFAULT 0,   -- micro-memory
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  slot TEXT NOT NULL,                -- morning | evening | bonus
  msg_id TEXT NOT NULL,              -- identifier from library
  delivered_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deliveries_user_slot ON deliveries(user_id, slot, delivered_at);
`);

function now() { return Date.now(); }

function upsertUser({ user_id, first_name }) {
  const ts = now();
  const row = db.prepare('SELECT user_id FROM users WHERE user_id=?').get(user_id);
  if (row) {
    db.prepare('UPDATE users SET first_name=?, updated_at=? WHERE user_id=?')
      .run(first_name || null, ts, user_id);
  } else {
    db.prepare(`
      INSERT INTO users (user_id, first_name, created_at, updated_at, trial_start)
      VALUES (?, ?, ?, ?, ?)
    `).run(user_id, first_name || null, ts, ts, ts);
  }
}

function getUser(user_id) {
  return db.prepare('SELECT * FROM users WHERE user_id=?').get(user_id);
}

function setTone(user_id, tone) {
  db.prepare('UPDATE users SET tone=?, updated_at=? WHERE user_id=?')
    .run(tone, now(), user_id);
}

function setSubscribed(user_id, subscribed) {
  db.prepare('UPDATE users SET subscribed=?, updated_at=? WHERE user_id=?')
    .run(subscribed ? 1 : 0, now(), user_id);
}

function setFreeMode(user_id, free_mode) {
  db.prepare('UPDATE users SET free_mode=?, updated_at=? WHERE user_id=?')
    .run(free_mode, now(), user_id);
}

function incHeavyEvenings(user_id) {
  db.prepare('UPDATE users SET heavy_evenings=heavy_evenings+1, updated_at=? WHERE user_id=?')
    .run(now(), user_id);
}

function addDelivery(user_id, slot, msg_id) {
  db.prepare(`
    INSERT INTO deliveries (user_id, slot, msg_id, delivered_at)
    VALUES (?, ?, ?, ?)
  `).run(user_id, slot, msg_id, now());
}

function getDeliveredMsgIds(user_id, slot, limitDays = 60) {
  const since = now() - limitDays * 24 * 60 * 60 * 1000;
  const rows = db.prepare(`
    SELECT msg_id FROM deliveries
    WHERE user_id=? AND slot=? AND delivered_at>=?
  `).all(user_id, slot, since);
  return new Set(rows.map(r => r.msg_id));
}

function listActiveUsers() {
  return db.prepare('SELECT * FROM users').all();
}

module.exports = {
  db,
  upsertUser,
  getUser,
  setTone,
  setSubscribed,
  setFreeMode,
  incHeavyEvenings,
  addDelivery,
  getDeliveredMsgIds,
  listActiveUsers
};
