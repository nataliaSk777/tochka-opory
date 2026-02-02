const cron = require('node-cron');

const { sendMorning } = require('./cron_morning');
const { sendEvening } = require('./cron_evening');
const { sendBonus } = require('./cron_bonus');

function startInternalCron(bot) {
  const timezone = process.env.TZ || 'Europe/Vilnius';

  // 🌅 Утро — каждый день в 8:00
  cron.schedule(
    '0 8 * * *',
    async () => {
      console.log('🌅 Morning cron started');
      await sendMorning(bot);
    },
    { timezone }
  );

  // 🌙 Вечер — каждый день в 21:00
  cron.schedule(
    '0 21 * * *',
    async () => {
      console.log('🌙 Evening cron started');
      await sendEvening(bot);
    },
    { timezone }
  );

  // ✨ Бонус — каждый день в 13:00
  cron.schedule(
    '0 13 * * *',
    async () => {
      console.log('✨ Bonus cron started');
      await sendBonus(bot);
    },
    { timezone }
  );

  console.log('⏰ Internal cron is running');
}

module.exports = { startInternalCron };
