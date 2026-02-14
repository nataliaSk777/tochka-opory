const Database = require('better-sqlite3');

const db = new Database(process.env.DB_PATH || './data.sqlite');
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  user_id INTEGER PRIMARY KEY,
  first_name TEXT,
  tone TEXT DEFAULT 'soft',
  trial_start INTEGER,
  subscribed INTEGER DEFAULT 0,
  free_mode TEXT DEFAULT 'morning',
  heavy_evenings INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  slot TEXT NOT NULL,
  msg_id TEXT NOT NULL,
  delivered_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deliveries_user_slot ON deliveries(user_id, slot, delivered_at);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  yk_payment_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  amount_value TEXT NOT NULL,
  amount_currency TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_status_created ON payments(user_id, status, created_at);
`);

function now() { return Date.now(); }
function daysToMs(days) { return Number(days) * 24 * 60 * 60 * 1000; }

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

function startTrial(user_id) {
  db.prepare('UPDATE users SET trial_start=?, updated_at=? WHERE user_id=?')
    .run(now(), now(), user_id);
}

function addDelivery(user_id, slot, msg_id) {
  db.prepare(`
    INSERT INTO deliveries (user_id, slot, msg_id, delivered_at)
    VALUES (?, ?, ?, ?)
  `).run(user_id, slot, msg_id, now());
}

function getDeliveredMsgIds(user_id, slot, limitDays = 60) {
  const since = now() - daysToMs(limitDays);
  const rows = db.prepare(`
    SELECT msg_id FROM deliveries
    WHERE user_id=? AND slot=? AND delivered_at>=?
  `).all(user_id, slot, since);
  return new Set(rows.map(r => r.msg_id));
}

function listActiveUsers() {
  return db.prepare('SELECT * FROM users').all();
}

/* =========================
   Payments helpers
========================= */

// ✅ Важно: принимаем created_at (время платежа от YooKassa), чтобы считать “до …”
function upsertPayment({
  user_id,
  yk_payment_id,
  status,
  amount_value,
  amount_currency,
  created_at
}) {
  const ts = now();
  const createdAt = Number.isFinite(Number(created_at)) ? Number(created_at) : ts;

  const row = db.prepare('SELECT id FROM payments WHERE yk_payment_id=?').get(yk_payment_id);
  if (row) {
    db.prepare(`
      UPDATE payments
      SET user_id=?, status=?, amount_value=?, amount_currency=?, updated_at=?
      WHERE yk_payment_id=?
    `).run(user_id, status, amount_value, amount_currency, ts, yk_payment_id);
  } else {
    db.prepare(`
      INSERT INTO payments (user_id, yk_payment_id, status, amount_value, amount_currency, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(user_id, yk_payment_id, status, amount_value, amount_currency, createdAt, ts);
  }
}

function getPaymentByYkId(yk_payment_id) {
  return db.prepare('SELECT * FROM payments WHERE yk_payment_id=?').get(yk_payment_id);
}

// ✅ Последний успешный платеж пользователя
function getLastSucceededPayment(user_id) {
  return db.prepare(`
    SELECT * FROM payments
    WHERE user_id=? AND status='succeeded'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(user_id);
}

// ✅ До какого времени активна подписка (ms). null если нет
function getSubscriptionUntilMs(user_id, periodDays = 30) {
  const p = getLastSucceededPayment(user_id);
  if (!p) return null;
  const start = Number(p.created_at);
  if (!Number.isFinite(start) || start <= 0) return null;
  return start + daysToMs(periodDays);
}

// ✅ Активна ли подписка сейчас
function isSubscriptionActive(user_id, periodDays = 30) {
  const until = getSubscriptionUntilMs(user_id, periodDays);
  if (!until) return false;
  return now() < until;
}

module.exports = {
  db,
  upsertUser,
  getUser,
  setTone,
  setSubscribed,
  setFreeMode,
  incHeavyEvenings,
  startTrial,
  addDelivery,
  getDeliveredMsgIds,
  listActiveUsers,
  upsertPayment,
  getPaymentByYkId,
  getLastSucceededPayment,
  getSubscriptionUntilMs,
  isSubscriptionActive
};
