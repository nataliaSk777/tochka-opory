const { supportMomentEntryMenu, supportMomentLabelMenu, mainMenu } = require('./ui');

const LOCK_MS = 900;

function now() { return Date.now(); }

function ensureSession(ctx) {
  if (!ctx.session) ctx.session = {};
  if (!ctx.session.locks) ctx.session.locks = {};
  if (!ctx.session.supportMoment) ctx.session.supportMoment = { step: 'idle', label: null, tone: 'soft' };
}

function acquireLock(ctx, key, ms = LOCK_MS) {
  ensureSession(ctx);
  const t = now();
  const until = ctx.session.locks[key] || 0;
  if (until > t) return false;
  ctx.session.locks[key] = t + ms;
  return true;
}

function resetSupportMoment(ctx) {
  ensureSession(ctx);
  ctx.session.supportMoment = { step: 'idle', label: null, tone: ctx.session.supportMoment?.tone || 'soft' };
}

function textEntry() {
  return [
    'Я здесь.',
    'Сейчас можно без объяснений.',
    '',
    'Хочешь сделать это состояние на 5% мягче?'
  ].join('\n');
}

function textStay() {
  return [
    'Хорошо.',
    'Мы просто здесь.',
    'Ничего не нужно делать.',
    '',
    'Я рядом.'
  ].join('\n');
}

function textAskLabel() {
  return [
    'Одним словом — как это сейчас?',
    '',
    'Можно выбрать кнопку. Можно пропустить.'
  ].join('\n');
}

function textClose() {
  return [
    'Микросдвиг сделан.',
    'Этого достаточно.',
    '',
    'Дальше можно жить шагом.'
  ].join('\n');
}

function normalizeLabel(s) {
  return (s || '').toString().trim().toLowerCase();
}

function normalizeTone(t) {
  const x = (t || '').toString().trim().toLowerCase();
  if (x === 'brave' || x === 'soft' || x === 'neutral') return x;
  return 'soft';
}

const MICRO_ACTIONS_2 = {
  'усталость': {
    A: 'Ок. Сделаем на 5% мягче — усталость.\n\n60 секунд:\n1) Опусти плечи на миллиметр.\n2) Пусть живот станет мягче.\n3) Один длинный выдох.\n\nЯ рядом.',
    B: 'Ок. Чуть облегчим — усталость.\n\n60 секунд:\n1) Выпрями спину на 2 сантиметра.\n2) Разожми пальцы. Дай рукам потеплеть.\n3) Выдох длиннее вдоха.\n\nЯ с тобой.',
    N: 'Ок. Сделаем на 5% мягче — усталость.\n\n60 секунд:\n1) Плечи вниз на миллиметр.\n2) Ладони расслабь.\n3) Один длинный выдох.\n\nЯ здесь.'
  },
  'тревога': {
    A: 'Ок. Сделаем на 5% мягче — тревога.\n\n60 секунд:\n1) Найди глазами 3 предмета вокруг.\n2) Почувствуй опору под стопами.\n3) Один длинный выдох.\n\nЯ рядом.',
    B: 'Ок. Чуть облегчим — тревога.\n\n60 секунд:\n1) Назови про себя 3 цвета вокруг.\n2) Упрись стопами в пол на секунду.\n3) Длинный выдох через рот.\n\nЯ с тобой.',
    N: 'Ок. Сделаем на 5% мягче — тревога.\n\n60 секунд:\n1) 3 предмета глазами.\n2) Ступни на полу.\n3) Один длинный выдох.\n\nЯ здесь.'
  },
  'перегруз': {
    A: 'Ок. Сделаем на 5% мягче — перегруз.\n\n60 секунд:\n1) Скажи себе: “сейчас — только один шаг”.\n2) Разожми ладони.\n3) Выдох длиннее вдоха.\n\nЯ рядом.',
    B: 'Ок. Чуть облегчим — перегруз.\n\n60 секунд:\n1) Выбери одно: “сейчас — только это”.\n2) Плечи назад и вниз на мгновение.\n3) Два выдоха подряд, не спеша.\n\nЯ с тобой.',
    N: 'Ок. Сделаем на 5% мягче — перегруз.\n\n60 секунд:\n1) “Сейчас — один шаг”.\n2) Ладони разожми.\n3) Один длинный выдох.\n\nЯ здесь.'
  },
  'пусто': {
    A: 'Ок. Сделаем на 5% мягче — пусто.\n\n60 секунд:\n1) Почувствуй опору сзади (стул/стена/подушка).\n2) Ладонь на грудь или живот.\n3) Один длинный выдох.\n\nЯ рядом.',
    B: 'Ок. Чуть облегчим — пусто.\n\n60 секунд:\n1) Спина на опоре. Заметь контакт.\n2) Ладонь на грудь или живот.\n3) Выдох длиннее вдоха.\n\nЯ с тобой.',
    N: 'Ок. Сделаем на 5% мягче — пусто.\n\n60 секунд:\n1) Опора сзади.\n2) Ладонь на грудь/живот.\n3) Один длинный выдох.\n\nЯ здесь.'
  },
  'злость': {
    A: 'Ок. Сделаем на 5% мягче — злость.\n\n60 секунд:\n1) Сожми кулаки на 3 секунды — и отпусти.\n2) Отпусти челюсть.\n3) Выдох через рот, чуть длиннее.\n\nЯ рядом.',
    B: 'Ок. Чуть облегчим — злость.\n\n60 секунд:\n1) Напряги руки на 2 секунды — отпусти.\n2) Плечи вниз.\n3) Два длинных выдоха.\n\nЯ с тобой.',
    N: 'Ок. Сделаем на 5% мягче — злость.\n\n60 секунд:\n1) Кулаки на 3 секунды — отпусти.\n2) Челюсть мягче.\n3) Один длинный выдох.\n\nЯ здесь.'
  },
  'боль': {
    A: 'Ок. Сделаем на 5% мягче — боль.\n\n60 секунд:\n1) Найди в теле место, где НЕ болит.\n2) Побудь вниманием там пару вдохов.\n3) Один длинный выдох.\n\nЯ рядом.',
    B: 'Ок. Чуть облегчим — боль.\n\n60 секунд:\n1) Найди место, где спокойнее.\n2) Перенеси внимание туда.\n3) Выдох длиннее вдоха.\n\nЯ с тобой.',
    N: 'Ок. Сделаем на 5% мягче — боль.\n\n60 секунд:\n1) Найди место без боли.\n2) Внимание туда.\n3) Один длинный выдох.\n\nЯ здесь.'
  }
};

const LABEL_ALIASES = {
  'устала': 'усталость',
  'плохо': 'усталость',
  'страшно': 'тревога',
  'тревожно': 'тревога',
  'одиноко': 'пусто',
  'пустота': 'пусто',
  'напряжение': 'перегруз'
};

function defaultMicroAction(label, tone) {
  const t = normalizeTone(tone);
  const head = label ? `Ок. Сделаем на 5% мягче — ${label}.` : 'Ок. Сделаем на 5% мягче.';
  const tail = t === 'brave' ? 'Я с тобой.' : (t === 'neutral' ? 'Я здесь.' : 'Я рядом.');
  return [
    head,
    '',
    '60 секунд:',
    '1) Почувствуй опору под стопами.',
    '2) Отпусти челюсть и плечи.',
    '3) Один длинный выдох.',
    '',
    tail
  ].join('\n');
}

function textMicroAction(label, tone) {
  const t = normalizeTone(tone);
  const raw = normalizeLabel(label);
  const key = LABEL_ALIASES[raw] || raw;

  const pack = MICRO_ACTIONS_2[key];
  if (!pack) return defaultMicroAction(raw || null, t);

  if (t === 'brave') return pack.B;
  if (t === 'neutral') return pack.N;
  return pack.A;
}

async function enterSupportMoment(ctx, tone = 'soft') {
  ensureSession(ctx);
  resetSupportMoment(ctx);
  ctx.session.supportMoment.step = 'entry';
  ctx.session.supportMoment.tone = normalizeTone(tone);
  await ctx.reply(textEntry(), supportMomentEntryMenu);
}

async function handleSupportMomentAction(ctx) {
  ensureSession(ctx);
  const data = (ctx.callbackQuery && ctx.callbackQuery.data) ? ctx.callbackQuery.data : '';
  if (!data.startsWith('SM_')) return false;

  if (!acquireLock(ctx, `cb:${data}`, LOCK_MS)) {
    try { await ctx.answerCbQuery(); } catch (_) {}
    return true;
  }

  try { await ctx.answerCbQuery(); } catch (_) {}

  if (data === 'SM_CANCEL') {
    resetSupportMoment(ctx);
    await ctx.reply('Ок. Я рядом. Если понадобится — нажми «Поддержка в моменте».', mainMenu);
    return true;
  }

  if (data === 'SM_STAY') {
    resetSupportMoment(ctx);
    await ctx.reply(textStay(), mainMenu);
    return true;
  }

  if (data === 'SM_SOFTEN') {
    ctx.session.supportMoment.step = 'label';
    await ctx.reply(textAskLabel(), supportMomentLabelMenu);
    return true;
  }

  if (data === 'SM_SKIP') {
    const tone = ctx.session.supportMoment.tone || 'soft';
    resetSupportMoment(ctx);
    await ctx.reply(textMicroAction(null, tone));
    await ctx.reply(textClose(), mainMenu);
    return true;
  }

  if (data.startsWith('SM_LBL_')) {
    const label = data.replace('SM_LBL_', '');
    const tone = ctx.session.supportMoment.tone || 'soft';
    resetSupportMoment(ctx);
    await ctx.reply(textMicroAction(label, tone));
    await ctx.reply(textClose(), mainMenu);
    return true;
  }

  return true;
}

async function handleSupportMomentText(ctx) {
  ensureSession(ctx);
  const step = ctx.session.supportMoment.step;
  if (step !== 'label') return false;

  const raw = (ctx.message && ctx.message.text) ? ctx.message.text : '';
  const label = raw.trim().slice(0, 28) || null;
  const tone = ctx.session.supportMoment.tone || 'soft';

  resetSupportMoment(ctx);
  await ctx.reply(textMicroAction(label, tone));
  await ctx.reply(textClose(), mainMenu);
  return true;
}

module.exports = {
  enterSupportMoment,
  handleSupportMomentAction,
  handleSupportMomentText
};
