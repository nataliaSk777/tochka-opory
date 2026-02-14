require('dotenv').config();
const { Telegraf, session, Markup } = require('telegraf');

const {
  upsertUser,
  getUser,
  setTone,
  setSubscribed,
  setFreeMode,
  incHeavyEvenings,
  startTrial,
  addDelivery,
  getDeliveredMsgIds
} = require('./db');

const {
  MORNING,
  EVENING,
  applyTone,
  pickUndelivered
} = require('./content');

const {
  mainMenu,
  startMenu,
  toneMenu,
  paywallMenu,
  channelLinkMenu
} = require('./ui');

const {
  enterSupportMoment,
  handleSupportMomentAction,
  handleSupportMomentText
} = require('./supportMoment');

const { startInternalCron } = require('./internalCron');
const { startServer } = require('./server');
const { createSubscriptionPayment, isValidEmail } = require('./yookassa');

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is missing');

// ✅ Безопасная диагностика ENV (не печатает секрет)
console.log('ENV CHECK:', {
  BOT_TOKEN: process.env.BOT_TOKEN ? 'OK' : 'MISSING',
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL ? String(process.env.PUBLIC_BASE_URL).trim() : 'MISSING',
  PRICE_RUB: process.env.PRICE_RUB ? String(process.env.PRICE_RUB).trim() : 'DEFAULT(490)',
  YOOKASSA_SHOP_ID: process.env.YOOKASSA_SHOP_ID ? 'OK' : 'MISSING',
  YOOKASSA_SECRET_KEY: process.env.YOOKASSA_SECRET_KEY
    ? `OK(len=${String(process.env.YOOKASSA_SECRET_KEY).trim().length})`
    : 'MISSING',
  INTERNAL_CRON: process.env.INTERNAL_CRON ? String(process.env.INTERNAL_CRON).trim() : '0'
});

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

bot.catch((err) => {
  console.error('Telegraf error:', err);
});

function normalize(s) {
  return (s || '').trim().toLowerCase();
}

async function ensureUser(ctx) {
  upsertUser({ user_id: ctx.from.id, first_name: ctx.from.first_name });
  return getUser(ctx.from.id);
}

/* ============================================================================
   🧭 Guided flow: "Провести через момент" (2 минуты)
============================================================================ */

function ensureSession(ctx) {
  if (!ctx.session) ctx.session = {};
  if (!ctx.session.guided) ctx.session.guided = { active: false, step: 0, paused: false, tmp: {} };
  return ctx.session.guided;
}
function ensurePaySession(ctx) {
  if (!ctx.session) ctx.session = {};
  if (!ctx.session.pay) ctx.session.pay = { awaitingEmail: false, email: '' };
  return ctx.session.pay;
}

function resetGuided(ctx) {
  if (!ctx.session) ctx.session = {};
  ctx.session.guided = { active: false, step: 0, paused: false, tmp: {} };
}

function guidedKeyboard(buttons) {
  return Markup.inlineKeyboard(buttons.map(b => Markup.button.callback(b.text, b.data)), { columns: 2 });
}

async function enterGuidedMoment(ctx) {
  const g = ensureSession(ctx);
  g.active = true;
  g.step = 0;
  g.paused = false;
  g.tmp = {};

  await ctx.reply(
    ['Я рядом.', 'Сделаем маленькую опору за 2 минуты.', '', 'Готова начать?'].join('\n'),
    guidedKeyboard([
      { text: '✅ Начать', data: 'GM_START' },
      { text: '⏸ Не сейчас', data: 'GM_CANCEL' }
    ])
  );
}

async function guidedSendStep(ctx) {
  const g = ensureSession(ctx);

  if (g.paused) {
    await ctx.reply(
      'Пауза. Я рядом.\nХочешь продолжить или закончить?',
      guidedKeyboard([
        { text: '▶️ Продолжить', data: 'GM_RESUME' },
        { text: '⛔️ Закончить', data: 'GM_END' }
      ])
    );
    return;
  }

  if (g.step === 1) {
    await ctx.reply(
      ['Шаг 1/5.', 'Поставь стопы на пол.', 'Почувствуй опору под ногами.', 'Просто отметь: «я стою» или «я сижу».'].join('\n'),
      guidedKeyboard([
        { text: '➡️ Дальше', data: 'GM_NEXT' },
        { text: '⏸ Пауза', data: 'GM_PAUSE' }
      ])
    );
    return;
  }

  if (g.step === 2) {
    await ctx.reply(
      ['Шаг 2/5.', 'Сделай один медленный выдох…', 'Ещё один.', 'Не глубоко — просто чуть медленнее, чем обычно.'].join('\n'),
      guidedKeyboard([
        { text: '➡️ Дальше', data: 'GM_NEXT' },
        { text: '⏸ Пауза', data: 'GM_PAUSE' }
      ])
    );
    return;
  }

  if (g.step === 3) {
    await ctx.reply(
      ['Шаг 3/5.', 'Одним словом: что сейчас внутри?', '', 'Можно коротко: «грусть», «тревога», «усталость», «пусто».'].join('\n'),
      guidedKeyboard([
        { text: '⏸ Пауза', data: 'GM_PAUSE' },
        { text: '⛔️ Закончить', data: 'GM_END' }
      ])
    );
    return;
  }

  if (g.step === 4) {
    const label = (g.tmp && g.tmp.label) ? String(g.tmp.label).trim() : '';
    const lead = label ? `Спасибо. Я слышу: «${label}».` : 'Спасибо. Я слышу тебя.';
    await ctx.reply(
      ['Шаг 4/5.', lead, '', 'Опора на этот момент такая:', '«Мне не нужно решать всё.', 'Мне нужно прожить вот это».', '', 'Можно повторить про себя один раз.'].join('\n'),
      guidedKeyboard([
        { text: '➡️ Дальше', data: 'GM_NEXT' },
        { text: '⏸ Пауза', data: 'GM_PAUSE' }
      ])
    );
    return;
  }

  if (g.step === 5) {
    await ctx.reply(
      ['Шаг 5/5.', 'Что стало на 1% легче?', '', 'Выбери вариант — любой ок.'].join('\n'),
      guidedKeyboard([
        { text: '🫶 В теле', data: 'GM_EASE_BODY' },
        { text: '🧠 В голове', data: 'GM_EASE_HEAD' },
        { text: '🌫 Никак', data: 'GM_EASE_NONE' }
      ])
    );
    return;
  }

  await ctx.reply(
    ['Я рядом.', 'Хочешь ещё одну короткую опору — или закончить?'].join('\n'),
    guidedKeyboard([
      { text: '🔁 Ещё', data: 'GM_MORE' },
      { text: '✅ Закончить', data: 'GM_END' }
    ])
  );
}

async function guidedNext(ctx) {
  const g = ensureSession(ctx);
  if (!g.active) return;

  if (g.step === 0) { g.step = 1; await guidedSendStep(ctx); return; }
  if (g.step === 1) { g.step = 2; await guidedSendStep(ctx); return; }
  if (g.step === 2) { g.step = 3; await guidedSendStep(ctx); return; }

  if (g.step === 3) {
    await ctx.reply('Можно одним словом. Я подожду.', guidedKeyboard([
      { text: '⏸ Пауза', data: 'GM_PAUSE' },
      { text: '⛔️ Закончить', data: 'GM_END' }
    ]));
    return;
  }

  if (g.step === 4) { g.step = 5; await guidedSendStep(ctx); return; }
  if (g.step === 5) { g.step = 6; await guidedSendStep(ctx); return; }

  g.step = 0;
  g.tmp = {};
  await guidedSendStep(ctx);
}

async function guidedPause(ctx) {
  const g = ensureSession(ctx);
  if (!g.active) return;
  g.paused = true;
  await guidedSendStep(ctx);
}

async function guidedResume(ctx) {
  const g = ensureSession(ctx);
  if (!g.active) return;
  g.paused = false;
  await guidedSendStep(ctx);
}

async function guidedEnd(ctx) {
  const g = ensureSession(ctx);
  if (!g.active) return;
  resetGuided(ctx);
  await ctx.reply('Хорошо. Я рядом.\nЕсли снова накроет — можно вернуться в любой момент.', mainMenu);
}

async function guidedMore(ctx) {
  const g = ensureSession(ctx);
  if (!g.active) return;
  g.paused = false;
  g.step = 1;
  g.tmp = {};
  await guidedSendStep(ctx);
}

async function guidedHandleText(ctx) {
  const g = ensureSession(ctx);
  if (!g.active) return false;
  if (g.paused) return true;

  if (g.step === 3) {
    const label = String(ctx.message.text || '').trim();
    g.tmp = g.tmp || {};
    g.tmp.label = label.slice(0, 60);
    g.step = 4;
    await guidedSendStep(ctx);
    return true;
  }

  await ctx.reply('Я рядом. Можно нажать «Дальше» или «Пауза».', guidedKeyboard([
    { text: '➡️ Дальше', data: 'GM_NEXT' },
    { text: '⏸ Пауза', data: 'GM_PAUSE' },
    { text: '⛔️ Закончить', data: 'GM_END' }
  ]));
  return true;
}

/* ============================================================================
   Тексты
============================================================================ */

function startText() {
  return [
    'Я — «Точка опоры».',
    'Я буду писать тебе утром и вечером.',
    'Без советов. Без давления.',
    'Просто рядом, чтобы стало чуть легче.',
    '',
    'Если прямо сейчас шатает — нажми «🧭 Пройти момент (2 минуты)».',
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
  const price = `${Number(process.env.PRICE_RUB || '490')} ₽ в месяц`;
  const mode = user.subscribed ? '✅ Подписка активна.' : '🔒 Подписка не активна.';
  return [
    mode,
    '',
    'Подписка даёт:',
    '• утро + вечер',
    '• выбранный тон',
    '• иногда “неожиданное рядом”',
    '',
    `Цена: ${price}.`,
    '',
    'Если тебе хоть иногда становилось чуть легче — я могу быть рядом дальше.'
  ].join('\n');
}

/* ============================================================================
   Start / menus
============================================================================ */

bot.start(async (ctx) => {
  await ensureUser(ctx);
  resetGuided(ctx);
  await ctx.reply(startText(), startMenu);
  await ctx.reply('Меню рядом 👇', mainMenu);
});

bot.action('TRY_3DAYS', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (_) {}
  const user = await ensureUser(ctx);
  startTrial(user.user_id);

  await ctx.reply(
    'Ок.\n3 дня я буду рядом утром и вечером.\nБез давления.\nЕсли нужно прямо сейчас — нажми «Поддержка в моменте».\nА если нужно шаг за шагом — /moment.',
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

// ✅ Тут — автомат: создаём платёж ЮKassa и отдаём ссылку
bot.action('SUBSCRIBE_YES', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (_) {}
  const user = await ensureUser(ctx);

  // ✅ Нормализуем PUBLIC_BASE_URL: добавим https:// если забыли
  let base = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!base) {
    await ctx.reply(
      'Похоже, не настроен PUBLIC_BASE_URL.\nНужно сгенерировать публичный домен в Railway и вставить его.',
      mainMenu
    );
    return;
  }
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;

  const pay = ensurePaySession(ctx);

  // ✅ 54-ФЗ: нужен email для чека
  if (!pay.email || !isValidEmail(pay.email)) {
    pay.awaitingEmail = true;
    pay.email = '';
    await ctx.reply(
      'Чтобы оформить подписку, мне нужен email для чека.\n\nНапиши email одним сообщением (например: name@gmail.com).',
      mainMenu
    );
    return;
  }

  const returnUrl = `${base}/paid`;

  try {
    const payment = await createSubscriptionPayment({
      userId: user.user_id,
      returnUrl,
      customerEmail: pay.email
    });

    const confirmUrl =
      payment && payment.confirmation && payment.confirmation.confirmation_url
        ? String(payment.confirmation.confirmation_url)
        : '';

    if (!confirmUrl) {
      console.log('No confirmation_url in payment', payment);
      await ctx.reply('Не получилось создать ссылку на оплату. Попробуй ещё раз чуть позже.', mainMenu);
      return;
    }

    await ctx.reply(
      [
        `Ок. Вот ссылка на оплату подписки (${Number(process.env.PRICE_RUB || '490')} ₽/мес):`,
        confirmUrl,
        '',
        'После оплаты я включу утро + вечер автоматически ✅'
      ].join('\n'),
      mainMenu
    );
  } catch (e) {
    console.log('Create payment failed', {
      message: e?.message,
      status: e?.status,
      data: e?.data
    });

    const hint =
      e?.status === 401 ? '401: ключи YooKassa не приняты (YOOKASSA_SHOP_ID/YOOKASSA_SECRET_KEY).' :
      e?.status === 400 ? `400: ошибка параметров платежа. ${e?.data?.parameter ? `Параметр: ${e.data.parameter}.` : ''}` :
      'Техническая ошибка при создании платежа.';

    await ctx.reply(`Не получилось создать платёж.\n${hint}`, mainMenu);
  }
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

/* ============================================================================
   🧭 Guided flow entry points
============================================================================ */

bot.command('moment', async (ctx) => {
  await ensureUser(ctx);
  await enterGuidedMoment(ctx);
});

bot.hears(/пройти момент|шаг за шагом|проведи меня|проведи через момент/i, async (ctx) => {
  await ensureUser(ctx);
  await enterGuidedMoment(ctx);
});

bot.hears('🧭 Пройти момент (2 минуты)', async (ctx) => {
  await ensureUser(ctx);
  await enterGuidedMoment(ctx);
});

/* ============================================================================
   🧷 SupportMoment
============================================================================ */

bot.hears('🧷 Поддержка в моменте', async (ctx) => {
  const user = await ensureUser(ctx);
  await enterSupportMoment(ctx, user.tone || 'soft');
});

bot.command('support', async (ctx) => {
  const user = await ensureUser(ctx);
  await enterSupportMoment(ctx, user.tone || 'soft');
});

/* ============================================================================
   Manual morning/evening
============================================================================ */

bot.hears('🌅 Утро', async (ctx) => {
  const user = await ensureUser(ctx);
  const delivered = getDeliveredMsgIds(user.user_id, 'morning', 120);
  const picked = pickUndelivered(MORNING, delivered);
  const text = applyTone(picked.text, user.tone);

  try {
    await ctx.reply(text, mainMenu);
    addDelivery(user.user_id, 'morning', picked.id);
  } catch (e) {
    console.log('Manual MORNING failed', user.user_id, e.message);
    await ctx.reply('Я рядом.\nСейчас что-то не отправилось.\nПопробуй ещё раз.', mainMenu);
  }
});

bot.hears('🌙 Вечер', async (ctx) => {
  const user = await ensureUser(ctx);
  const delivered = getDeliveredMsgIds(user.user_id, 'evening', 120);
  const picked = pickUndelivered(EVENING, delivered);
  const text = applyTone(picked.text, user.tone);

  try {
    await ctx.reply(text, mainMenu);
    addDelivery(user.user_id, 'evening', picked.id);
  } catch (e) {
    console.log('Manual EVENING failed', user.user_id, e.message);
    await ctx.reply('Я рядом.\nСейчас что-то не отправилось.\nПопробуй ещё раз.', mainMenu);
  }
});

/* ============================================================================
   callback_query routing:
============================================================================ */

bot.on('callback_query', async (ctx, next) => {
  const data = ctx.callbackQuery && ctx.callbackQuery.data ? String(ctx.callbackQuery.data) : '';

  if (data.startsWith('GM_')) {
    try { await ctx.answerCbQuery(); } catch (_) {}

    if (data === 'GM_START') {
      const g = ensureSession(ctx);
      g.active = true;
      g.paused = false;
      g.step = 1;
      g.tmp = {};
      await guidedSendStep(ctx);
      return;
    }

    if (data === 'GM_NEXT') { await guidedNext(ctx); return; }
    if (data === 'GM_PAUSE') { await guidedPause(ctx); return; }
    if (data === 'GM_RESUME') { await guidedResume(ctx); return; }
    if (data === 'GM_MORE') { await guidedMore(ctx); return; }
    if (data === 'GM_CANCEL' || data === 'GM_END') { await guidedEnd(ctx); return; }

    if (data === 'GM_EASE_BODY' || data === 'GM_EASE_HEAD' || data === 'GM_EASE_NONE') {
      const tail =
        data === 'GM_EASE_BODY' ? 'Хорошо. Пусть тело запомнит это чуть-чуть.' :
        data === 'GM_EASE_HEAD' ? 'Хорошо. Пусть в голове станет на полтона тише.' :
        'Это тоже нормально. Ты всё равно сделала маленький шаг.';
      await ctx.reply([tail, '', 'Хочешь ещё одну короткую опору — или закончить?'].join('\n'),
        guidedKeyboard([
          { text: '🔁 Ещё', data: 'GM_MORE' },
          { text: '✅ Закончить', data: 'GM_END' }
        ])
      );
      return;
    }

    return;
  }

  const handled = await handleSupportMomentAction(ctx);
  if (handled) return;

  return next();
});

/* ============================================================================
   text routing
============================================================================ */

bot.on('text', async (ctx, next) => {
  await ensureUser(ctx);
  const handled = await guidedHandleText(ctx);
  if (handled) return;
  return next();
});

bot.on('text', async (ctx, next) => {
  const handled = await handleSupportMomentText(ctx);
  if (handled) return;
  return next();
});

bot.on('text', async (ctx, next) => {
  const pay = ensurePaySession(ctx);

  if (pay.awaitingEmail) {
    const email = String(ctx.message.text || '').trim();

    if (!isValidEmail(email)) {
      await ctx.reply('Похоже, это не email. Напиши, пожалуйста, в формате name@example.com', mainMenu);
      return;
    }

    pay.email = email;
    pay.awaitingEmail = false;

    await ctx.reply('Принято ✅\nТеперь нажми «Оформить подписку» ещё раз — я создам платёж.', mainMenu);
    return;
  }

  return next();
});

bot.on('text', async (ctx) => {
  const user = await ensureUser(ctx);
  const t = normalize(ctx.message.text);

  const fast = ['тяжело', 'пусто', 'не вывожу', 'плохо', 'устала', 'страшно', 'тревожно', 'одиноко', 'больно'];
  const morning = ['утро', '🌅 утро'];
  const evening = ['вечер', '🌙 вечер'];

  if (t === 'пройти' || t === 'момент' || t === 'проведи') {
    await enterGuidedMoment(ctx);
    return;
  }

  if (fast.includes(t)) {
    if (t === 'тяжело' || t === 'плохо' || t === 'устала') incHeavyEvenings(user.user_id);
    await ctx.reply('Вижу.\nЕсли нужно прямо сейчас — нажми «Поддержка в моменте».\nЕсли хочется шаг за шагом — /moment.\nЯ рядом.', mainMenu);
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

  await ctx.reply('Я здесь.\nЕсли нужно прямо сейчас — «Поддержка в моменте».\nЕсли нужно шаг за шагом — /moment.\nИли просто молчим рядом.', mainMenu);
});

bot.launch()
  .then(() => console.log('Bot started'))
  .catch((e) => {
    console.error('Bot launch failed:', e);
    process.exit(1);
  });

// internal cron
if (process.env.INTERNAL_CRON === '1') {
  startInternalCron(bot);
}

// ✅ Запускаем HTTP сервер ВСЕГДА (он нужен для webhook и для домена Railway)
startServer(bot);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
