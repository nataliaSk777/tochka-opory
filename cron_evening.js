require('dotenv').config();
const { listActiveUsers, addDelivery, getDeliveredMsgIds } = require('./db');
const { EVENING, applyTone, pickUndelivered } = require('./content');

const TRIAL_MS = 3 * 24 * 60 * 60 * 1000;

async function sendEvening(bot) {
  const users = listActiveUsers();
  console.log('[cron] evening users:', users.length);

  let eligible = 0;
  let sent = 0;

  for (const u of users) {
    const inTrial = !!u.trial_start && (Date.now() - u.trial_start) <= TRIAL_MS;

    const canReceive = !!u.subscribed || inTrial || u.free_mode === 'evening';
    if (!canReceive) continue;

    eligible++;

    const delivered = getDeliveredMsgIds(u.user_id, 'evening', 120);
    const picked = pickUndelivered(EVENING, delivered);
    const text = applyTone(picked.text, u.tone);

    try {
      await bot.telegram.sendMessage(u.user_id, text);
      addDelivery(u.user_id, 'evening', picked.id);
      sent++;
    } catch (e) {
      console.log('EVENING send failed', u.user_id, e.message);
    }
  }

  console.log('[cron] evening eligible:', eligible, 'sent:', sent);
}

module.exports = { sendEvening };
