const cron = require('node-cron');

const { sendMorning } = require('./cron_morning');
const { sendEvening } = require('./cron_evening');
const { sendBonus } = require('./cron_bonus');

function startInternalCron(bot) {
  const timezone = process.env.TZ || 'Europe/Vilnius';

  console.log('⏰ Internal cron is starting.');
  console.log('⏰ TZ =', timezone);
  console.log('⏰ Now =', new Date().toString());

  // 🌅 Утро — каждый день в 8:00
  cron.schedule(
    '0 8 * * *',
    async () => {
      console.log('🌅 Morning cron started');
      try {
        await sendMorning(bot);
        console.log('🌅 Morning cron finished');
      } catch (e) {
        console.error('🌅 Morning cron failed:', e);
      }
    },
    { timezone }
  );

  // 🌙 Вечер — каждый день в 21:00
  cron.schedule(
    '0 21 * * *',
    async () => {
      console.log('🌙 Evening cron started');
      try {
        await sendEvening(bot);
        console.log('🌙 Evening cron finished');
      } catch (e) {
        console.error('🌙 Evening cron failed:', e);
      }
    },
    { timezone }
  );

  // ✨ Бонус — каждый день в 13:00
  cron.schedule(
    '0 13 * * *',
    async () => {
      console.log('✨ Bonus cron started');
      try {
        await sendBonus(bot);
        console.log('✨ Bonus cron finished');
      } catch (e) {
        console.error('✨ Bonus cron failed:', e);
      }
    },
    { timezone }
  );

  console.log('✅ Internal cron is running');
}

module.exports = { startInternalCron };
