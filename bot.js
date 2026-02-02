require('dotenv').config();
const { Telegraf, session } = require('telegraf');

const {
  upsertUser,
  getUser,
  setTone,
  setSubscribed,
  setFreeMode,
  incHeavyEvenings
} = require('./db');

const {
  mainMenu,
  startMenu,
  toneMenu,
  paywallMenu
} = require('./ui');

const {
  enterSupportMoment,
  handleSupportMomentAction,
  handleSupportMomentText
} = require('./supportMoment');

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());
import { startInternalCron } from './internalCron.js';
function normalize(s) {
  return (s || '').trim().toLowerCase();
}

async function ensureUser(ctx) {
  upsertUser({ user_id: ctx.from.id, first_name: ctx.from.first_name });
  return getUser(ctx.from.id);
}

function startText() {
  return [
    'Я — «Точка опоры».',
    'Я буду писать тебе утром и вечером.',
    'Без советов. Без давления.',
    'Просто рядом, чтобы стало чуть легче.',
    '',
    'Можно писать коротко: «тяжело», «пусто», «не вывожу», «утро», «вечер».',
    'И можно нажать «Поддержка в моменте», если нужно прямо сейчас.'
  ].join('\n');
}

function howText() {
  return [
    'Два сообщения в день: утро и вечер.',
    'Тон — мягкий или чуть бодрее.',
    'Без оценок и “плана действий”.',
    '',
    '«Поддержка в моменте» — когда нужно прямо сейчас.',
    'Это не терапия и не диагностика.',
    'Это бережное присутствие и простая опора.'
  ].join('\n');
}

function subText(user) {
  const price = process.env.PRICE_TEXT || '4–7 € в месяц';
  const mode = user.subscribed ? '✅ Подписка активна.' : '🔒 Подписка не активна.';
  return [
    mode,
    '',
    'Подписка даёт:',
    '• утро + вечер',
    '• выбранный тон',
    '• иногда “неожиданное рядом”',
    '',
    `Цена: ${price} — как кофе, но теплее.`,
    '',
    'Если тебе хоть иногда становилось чуть легче — я могу быть рядом дальше.'
  ].join('\n');
}

bot.start(async (ctx) => {
  await ensureUser(ctx);
  await ctx.reply(startText(), startMenu);
  await ctx.reply('Меню рядом 👇', mainMenu);
});

bot.action('TRY_3DAYS', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (_) {}
  await ensureUser(ctx);
  await ctx.reply(
    'Ок.\n3 дня я буду рядом утром и вечером.\nБез давления.\nЕсли нужно прямо сейчас — нажми «Поддержка в моменте».',
    mainMenu
  );
});

bot.action('HOW_IT_WORKS', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (_) {}
  await ensureUser(ctx);
  await ctx.reply(howText(), mainMenu);
});

bot.action('PICK_TONE', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (_) {}
  await ensureUser(ctx);
  await ctx.reply('Как тебе лучше?', toneMenu);
});

bot.action(/TONE_(soft|brave|neutral)/, async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (_) {}
  const tone = ctx.match[1];
  const user = await ensureUser(ctx);
  setTone(user.user_id, tone);
  const map = { soft: '🌿 Очень мягко', brave: '🔥 Чуть бодрее', neutral: '🫧 Нейтрально' };
  await ctx.reply(`Принято. Тон: ${map[tone]}.`, mainMenu);
});

bot.hears('🌿 Тон', async (ctx) => {
  await ensureUser(ctx);
  await ctx.reply('Как тебе лучше?', toneMenu);
});

bot.hears('ℹ️ Как это работает', async (ctx) => {
  await ensureUser(ctx);
  await ctx.reply(howText(), mainMenu);
});

bot.hears('🔒 Подписка', async (ctx) => {
  const user = await ensureUser(ctx);
  await ctx.reply(subText(user), paywallMenu);
});

bot.action('SUBSCRIBE_YES', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (_) {}
  const user = await ensureUser(ctx);
  setSubscribed(user.user_id, true);
  await ctx.reply('Готово.\nЯ буду рядом утром и вечером.\nИ иногда — просто напомню, что ты не один.', mainMenu);
});

bot.action('SUBSCRIBE_NO', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (_) {}
  const user = await ensureUser(ctx);
  setSubscribed(user.user_id, false);
  setFreeMode(user.user_id, 'morning');
  await ctx.reply(
    'Поняла.\nЯ останусь в бесплатном режиме: только утро.\nЕсли захочешь вернуть полный ритуал — жми «Подписка».',
    mainMenu
  );
});

// 🧷 Поддержка в моменте — вход
bot.hears('🧷 Поддержка в моменте', async (ctx) => {
  const user = await ensureUser(ctx);
  await enterSupportMoment(ctx, user.tone || 'soft');
});

// опциональная команда
bot.command('support', async (ctx) => {
  const user = await ensureUser(ctx);
  await enterSupportMoment(ctx, user.tone || 'soft');
});

// callback-обработчик сценария (раньше общего)
bot.on('callback_query', async (ctx, next) => {
  const handled = await handleSupportMomentAction(ctx);
  if (handled) return;
  return next();
});

// текст внутри шага label (если человек пишет слово)
bot.on('text', async (ctx, next) => {
  const handled = await handleSupportMomentText(ctx);
  if (handled) return;
  return next();
});

// общий fallback на текст
bot.on('text', async (ctx) => {
  const user = await ensureUser(ctx);
  const t = normalize(ctx.message.text);

  const fast = ['тяжело', 'пусто', 'не вывожу', 'плохо', 'устала', 'страшно', 'тревожно', 'одиноко', 'больно'];
  const morning = ['утро', '🌅 утро'];
  const evening = ['вечер', '🌙 вечер'];

  if (fast.includes(t)) {
    if (t === 'тяжело' || t === 'плохо' || t === 'устала') incHeavyEvenings(user.user_id);
    await ctx.reply('Вижу.\nЕсли нужно прямо сейчас — нажми «Поддержка в моменте».\nЯ рядом.', mainMenu);
    return;
  }

  if (morning.includes(t)) {
    await ctx.reply('Приняла.\nУтро будет мягким и коротким.\nЯ рядом.', mainMenu);
    return;
  }

  if (evening.includes(t)) {
    await ctx.reply('Приняла.\nВечером можно будет отпустить день.\nЯ рядом.', mainMenu);
    return;
  }

  await ctx.reply('Я здесь.\nЕсли нужно прямо сейчас — «Поддержка в моменте».\nИли просто молчим рядом.', mainMenu);
});

bot.launch().then(() => console.log('Bot started'));
startInternalCron(bot);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
