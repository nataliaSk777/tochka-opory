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

if (!process.env.BOT_TOKEN) {
  throw new Error('BOT_TOKEN is missing');
}

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

// Ловим любые необработанные ошибки Telegraf (очень важно для стабильности)
bot.catch((err, ctx) => {
  console.error('Telegraf error:', err);
  try {
    if (ctx && ctx.chat && ctx.chat.id) {
      // не спамим пользователю деталями, только логируем
    }
  } catch (_) {}
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
   Это отдельный режим, НЕ ломает supportMoment.js
============================================================================ */

function ensureSession(ctx) {
  if (!ctx.session) ctx.session = {};
  if (!ctx.session.guided) ctx.session.guided = { active: false, step: 0, paused: false, tmp: {} };
  return ctx.session.guided;
}

function resetGuided(ctx) {
  if (!ctx.session) ctx.session = {};
  ctx.session.guided = { active: false, step: 0, paused: false, tmp: {} };
}

function isGuidedActive(ctx) {
  const g = ensureSession(ctx);
  return !!g.active;
}

function guidedKeyboard(buttons) {
  // buttons: [{text, data}]
  return Markup.inlineKeyboard(buttons.map(b => Markup.button.callback(b.text, b.data)), { columns: 2 });
}

async function enterGuidedMoment(ctx) {
  const g = ensureSession(ctx);
  g.active = true;
  g.step = 0;
  g.paused = false;
  g.tmp = {};

  await ctx.reply(
    [
      'Я рядом.',
      'Сделаем маленькую опору за 2 минуты.',
      '',
      'Готова начать?'
    ].join('\n'),
    guidedKeyboard([
      { text: '✅ Начать', data: 'GM_START' },
      { text: '⏸ Не сейчас', data: 'GM_CANCEL' }
    ])
  );
}

async function guidedSendStep(ctx) {
  const g = ensureSession(ctx);

  // Если на паузе — показываем только резюм/стоп
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
      [
        'Шаг 1/5.',
        'Поставь стопы на пол.',
        'Почувствуй опору под ногами.',
        'Просто отметь: «я стою» или «я сижу».'
      ].join('\n'),
      guidedKeyboard([
        { text: '➡️ Дальше', data: 'GM_NEXT' },
        { text: '⏸ Пауза', data: 'GM_PAUSE' }
      ])
    );
    return;
  }

  if (g.step === 2) {
    await ctx.reply(
      [
        'Шаг 2/5.',
        'Сделай один медленный выдох…',
        'Ещё один.',
        'Не глубоко — просто чуть медленнее, чем обычно.'
      ].join('\n'),
      guidedKeyboard([
        { text: '➡️ Дальше', data: 'GM_NEXT' },
        { text: '⏸ Пауза', data: 'GM_PAUSE' }
      ])
    );
    return;
  }

  if (g.step === 3) {
    await ctx.reply(
      [
        'Шаг 3/5.',
        'Одним словом: что сейчас внутри?',
        '',
        'Можно коротко: «грусть», «тревога», «усталость», «пусто».'
      ].join('\n'),
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
      [
        'Шаг 4/5.',
        lead,
        '',
        'Опора на этот момент такая:',
        '«Мне не нужно решать всё.',
        'Мне нужно прожить вот это».',
        '',
        'Можно повторить про себя один раз.'
      ].join('\n'),
      guidedKeyboard([
        { text: '➡️ Дальше', data: 'GM_NEXT' },
        { text: '⏸ Пауза', data: 'GM_PAUSE' }
      ])
    );
    return;
  }

  if (g.step === 5) {
    await ctx.reply(
      [
        'Шаг 5/5.',
        'Что стало на 1% легче?',
        '',
        'Выбери вариант — любой ок.'
      ].join('\n'),
      guidedKeyboard([
        { text: '🫶 В теле', data: 'GM_EASE_BODY' },
        { text: '🧠 В голове', data: 'GM_EASE_HEAD' },
        { text: '🌫 Никак', data: 'GM_EASE_NONE' }
      ])
    );
    return;
  }

  // Финал
  await ctx.reply(
    [
      'Я рядом.',
      'Хочешь ещё одну короткую опору — или закончить?'
    ].join('\n'),
    guidedKeyboard([
      { text: '🔁 Ещё', data: 'GM_MORE' },
      { text: '✅ Закончить', data: 'GM_END' }
    ])
  );
}

async function guidedNext(ctx) {
  const g = ensureSession(ctx);
  if (!g.active) return;

  // step 0 -> 1
  if (g.step === 0) {
    g.step = 1;
    await guidedSendStep(ctx);
    return;
  }

  // step 1 -> 2
  if (g.step === 1) {
    g.step = 2;
    await guidedSendStep(ctx);
    return;
  }

  // step 2 -> 3
  if (g.step === 2) {
    g.step = 3;
    await guidedSendStep(ctx);
    return;
  }

  // step 3 требует текста — Next не двигает
  if (g.step === 3) {
    await ctx.reply('Можно одним словом. Я подожду.', guidedKeyboard([
      { text: '⏸ Пауза', data: 'GM_PAUSE' },
      { text: '⛔️ Закончить', data: 'GM_END' }
    ]));
    return;
  }

  // step 4 -> 5
  if (g.step === 4) {
    g.step = 5;
    await guidedSendStep(ctx);
    return;
  }

  // step 5 -> финал (6)
  if (g.step === 5) {
    g.step = 6;
    await guidedSendStep(ctx);
    return;
  }

  // финал -> перезапуск
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
  if (g.paused) return true; // пока пауза — любые тексты не двигают

  // Единственное место, где текст нужен: step 3
  if (g.step === 3) {
    const label = String(ctx.message.text || '').trim();
    g.tmp = g.tmp || {};
    g.tmp.label = label.slice(0, 60);
    g.step = 4;
    await guidedSendStep(ctx);
    return true;
  }

  // Во всех прочих шагах — мягко возвращаем к кнопкам
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

function subText(user) {
  const price = process.env.PRICE_TEXT || '490 ₽ в месяц';
  const mode = user.subscribed ? '✅ Подписка активна.' : '🔒 Подписка не активна.';

  return [
    mode,
    '',
    'Подписка даёт:',
    '• утреннее сообщение',
    '• вечернее сообщение',
    '• выбранный тон',
    '• иногда «неожиданное рядом»',
    '',
    `Цена: ${price}.`,
    '',
    'Это цифровая услуга по подписке.',
    'Если тебе хоть иногда становилось чуть легче — я могу быть рядом дальше.'
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

/* ============================================================================
   🧭 Guided flow entry points
============================================================================ */

// Запуск пошагового режима командой
bot.command('moment', async (ctx) => {
  await ensureUser(ctx);
  await enterGuidedMoment(ctx);
});

// Запуск пошагового режима по тексту (на случай, если кнопки в меню ещё не добавлены)
bot.hears(/пройти момент|шаг за шагом|проведи меня|проведи через момент/i, async (ctx) => {
  await ensureUser(ctx);
  await enterGuidedMoment(ctx);
});

// Если захочешь — можно позже добавить такую кнопку в mainMenu и оно начнёт работать без правок здесь:
// bot.hears('🧭 Пройти момент', ...)
bot.hears('🧭 Пройти момент (2 минуты)', async (ctx) => {
  await ensureUser(ctx);
  await enterGuidedMoment(ctx);
});

/* ============================================================================
   🧷 SupportMoment — вход (оставляем как есть)
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

// ✅ КНОПКА: 🌅 Утро — выдаёт реальный текст из content.js
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

// ✅ КНОПКА: 🌙 Вечер — выдаёт реальный текст из content.js
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
   1) Guided flow callbacks
   2) SupportMoment callbacks
============================================================================ */

bot.on('callback_query', async (ctx, next) => {
  const data = ctx.callbackQuery && ctx.callbackQuery.data ? String(ctx.callbackQuery.data) : '';

  // 1) Guided flow handles first
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

    if (data === 'GM_NEXT') {
      await guidedNext(ctx);
      return;
    }

    if (data === 'GM_PAUSE') {
      await guidedPause(ctx);
      return;
    }

    if (data === 'GM_RESUME') {
      await guidedResume(ctx);
      return;
    }

    if (data === 'GM_MORE') {
      await guidedMore(ctx);
      return;
    }

    if (data === 'GM_CANCEL' || data === 'GM_END') {
      await guidedEnd(ctx);
      return;
    }

    if (data === 'GM_EASE_BODY' || data === 'GM_EASE_HEAD' || data === 'GM_EASE_NONE') {
      const g = ensureSession(ctx);
      if (g.active) {
        g.tmp = g.tmp || {};
        g.tmp.ease = data;
        g.step = 6;
      }
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

    // неизвестное GM — просто игнор
    return;
  }

  // 2) SupportMoment
  const handled = await handleSupportMomentAction(ctx);
  if (handled) return;

  return next();
});

/* ============================================================================
   text routing:
   1) Guided flow text
   2) SupportMoment text
   3) General fallback
============================================================================ */

// 1) Текст внутри guided-режима
bot.on('text', async (ctx, next) => {
  const user = await ensureUser(ctx); // сохраняем юзера стабильно
  void user;

  const handled = await guidedHandleText(ctx);
  if (handled) return;
  return next();
});

// 2) текст внутри supportMoment сценария
bot.on('text', async (ctx, next) => {
  const handled = await handleSupportMomentText(ctx);
  if (handled) return;
  return next();
});

// 3) общий fallback на текст
bot.on('text', async (ctx) => {
  const user = await ensureUser(ctx);
  const t = normalize(ctx.message.text);

  const fast = ['тяжело', 'пусто', 'не вывожу', 'плохо', 'устала', 'страшно', 'тревожно', 'одиноко', 'больно'];
  const morning = ['утро', '🌅 утро'];
  const evening = ['вечер', '🌙 вечер'];

  // Быстрый вход в guided по короткой команде
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

// ВАЖНО: чтобы не было двойных отправок,
// internal cron включаем только если ты явно этого хочешь.
if (process.env.INTERNAL_CRON === '1') {
  startInternalCron(bot);
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
