require('dotenv').config();
const { Telegraf } = require('telegraf');
const { listActiveUsers, addDelivery, getDeliveredMsgIds } = require('./db');
const { MORNING, EVENING, applyTone, pickUndelivered } = require('./content');

const bot = new Telegraf(process.env.BOT_TOKEN);

function canReceive(user, slot) {
  if (user.subscribed) return true;

  const ms = Date.now() - (user.trial_start || Date.now());
  const inTrial = ms <= 3 * 24 * 60 * 60 * 1000;
  if (inTrial) return true;

  return user.free_mode === slot;
}

async function sendSlot(slot) {
  const users = listActiveUsers();

  for (const u of users) {
    if (!canReceive(u, slot)) continue;

    const delivered = getDeliveredMsgIds(u.user_id, slot, 120);
    const list = slot === 'morning' ? MORNING : EVENING;

    const picked = pickUndelivered(list, delivered);
    const text = applyTone(picked.text, u.tone);

    try {
      await bot.telegram.sendMessage(u.user_id, text);
      addDelivery(u.user_id, slot, picked.id);
    } catch (e) {
      console.log('Send failed', u.user_id, e.message);
    }
  }
}

const slot = process.argv[2];
if (!slot || !['morning', 'evening'].includes(slot)) {
  console.log('Usage: node cron_runner.js morning|evening');
  process.exit(1);
}

sendSlot(slot)
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
