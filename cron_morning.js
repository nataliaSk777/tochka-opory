require('dotenv').config();
const { listActiveUsers, addDelivery, getDeliveredMsgIds } = require('./db');
const { MORNING, applyTone, pickUndelivered } = require('./content');

const TRIAL_MS = 3 * 24 * 60 * 60 * 1000;

async function sendMorning(bot) {
  const users = listActiveUsers();
  console.log('[cron] morning users:', users.length);

  if (!Array.isArray(MORNING) || MORNING.length === 0) {
    console.log('[cron] morning: MORNING is empty -> nothing to send');
    return;
  }

  let eligible = 0;
  let sent = 0;

  for (const u of users) {
    try {
      const trialStart = Number(u.trial_start || 0);
      const inTrial = trialStart > 0 && (Date.now() - trialStart) <= TRIAL_MS;

      const freeMode = (u.free_mode || '').toString();
      const subscribed = !!u.subscribed;

      const canReceive = subscribed || inTrial || freeMode === 'morning';
      if (!canReceive) continue;

      eligible++;

      const delivered = getDeliveredMsgIds(u.user_id, 'morning', 120);

      const picked = pickUndelivered(MORNING, delivered);
      if (!picked || !picked.id || !picked.text) {
        console.log('[cron] morning: pickUndelivered returned empty for user', u.user_id);
        continue;
      }

      const text = applyTone(picked.text, u.tone);

      await bot.telegram.sendMessage(u.user_id, text);
      addDelivery(u.user_id, 'morning', picked.id);
      sent++;
    } catch (e) {
      console.log('[cron] MORNING send failed', u && u.user_id ? u.user_id : 'unknown', e && e.message ? e.message : e);
    }
  }

  console.log('[cron] morning eligible:', eligible, 'sent:', sent);
}

module.exports = { sendMorning };
