require('dotenv').config();
const { listActiveUsers, addDelivery, getDeliveredMsgIds } = require('./db');
const { MORNING, applyTone, pickUndelivered } = require('./content');

async function sendMorning(bot) {
  const users = listActiveUsers();

  for (const u of users) {
    const ms = Date.now() - (u.trial_start || Date.now());
    const inTrial = ms <= 3 * 24 * 60 * 60 * 1000;

    const canReceive = u.subscribed || inTrial || u.free_mode === 'morning';
    if (!canReceive) continue;

    const delivered = getDeliveredMsgIds(u.user_id, 'morning', 120);
    const picked = pickUndelivered(MORNING, delivered);
    const text = applyTone(picked.text, u.tone);

    try {
      await bot.telegram.sendMessage(u.user_id, text);
      addDelivery(u.user_id, 'morning', picked.id);
    } catch (e) {
      console.log('MORNING send failed', u.user_id, e.message);
    }
  }
}

module.exports = { sendMorning };
