require('dotenv').config();
const { listActiveUsers, addDelivery, getDeliveredMsgIds } = require('./db');
const { BONUS, applyTone, pickUndelivered } = require('./content');

const BONUS_PROBABILITY = Number(process.env.BONUS_PROBABILITY || 0.2);
const COOLDOWN_DAYS = 1;

function shouldSend() {
  return Math.random() <= BONUS_PROBABILITY;
}

async function sendBonus(bot) {
  const users = listActiveUsers();

  for (const u of users) {
    if (!u.subscribed) continue;
    if (!shouldSend()) continue;

    const deliveredLastDay = getDeliveredMsgIds(u.user_id, 'bonus', COOLDOWN_DAYS);
    if (deliveredLastDay.size > 0) continue;

    const deliveredLong = getDeliveredMsgIds(u.user_id, 'bonus', 120);
    const picked = pickUndelivered(BONUS, deliveredLong);
    const text = applyTone(picked.text, u.tone);

    try {
      await bot.telegram.sendMessage(u.user_id, text);
      addDelivery(u.user_id, 'bonus', picked.id);
    } catch (e) {
      console.log('BONUS send failed', u.user_id, e.message);
    }
  }
}

module.exports = { sendBonus };
