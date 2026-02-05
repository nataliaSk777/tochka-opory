const { Markup } = require('telegraf');

// Главное меню (минимализм)
const mainMenu = Markup.keyboard([
  ['🌅 Утро', '🌙 Вечер'],
  ['🧭 Пройти момент (2 минуты)', '🧷 Поддержка в моменте'],
  ['🔒 Подписка', '🌿 Тон'],
  ['ℹ️ Как это работает']
]).resize();

// Стартовые inline-кнопки
const startMenu = Markup.inlineKeyboard([
  [Markup.button.callback('Попробовать 3 дня', 'TRY_3DAYS')],
  [Markup.button.callback('Выбрать тон', 'PICK_TONE')],
  [Markup.button.callback('Как это работает', 'HOW_IT_WORKS')]
]);

// Тон
const toneMenu = Markup.inlineKeyboard([
  [Markup.button.callback('🌿 Очень мягко', 'TONE_soft')],
  [Markup.button.callback('🔥 Чуть бодрее', 'TONE_brave')],
  [Markup.button.callback('🫧 Нейтрально', 'TONE_neutral')]
]);

// Подписка
const paywallMenu = Markup.inlineKeyboard([
  [Markup.button.callback('Оформить подписку', 'SUBSCRIBE_YES')],
  [Markup.button.callback('Остаться без подписки', 'SUBSCRIBE_NO')]
]);

// 🧷 Поддержка в моменте — вход
const supportMomentEntryMenu = Markup.inlineKeyboard([
  [Markup.button.callback('Сделать на 5% мягче', 'SM_SOFTEN')],
  [Markup.button.callback('Просто побудь рядом', 'SM_STAY')],
  [Markup.button.callback('Отмена', 'SM_CANCEL')]
]);

// 🧷 Поддержка в моменте — ярлык
const supportMomentLabelMenu = Markup.inlineKeyboard([
  [Markup.button.callback('Усталость', 'SM_LBL_усталость'), Markup.button.callback('Тревога', 'SM_LBL_тревога')],
  [Markup.button.callback('Пусто', 'SM_LBL_пусто'), Markup.button.callback('Перегруз', 'SM_LBL_перегруз')],
  [Markup.button.callback('Злость', 'SM_LBL_злость'), Markup.button.callback('Боль', 'SM_LBL_боль')],
  [Markup.button.callback('Другое', 'SM_LBL_другое')],
  [Markup.button.callback('Пропустить', 'SM_SKIP')],
  [Markup.button.callback('Отмена', 'SM_CANCEL')]
]);

module.exports = {
  mainMenu,
  startMenu,
  toneMenu,
  paywallMenu,
  supportMomentEntryMenu,
  supportMomentLabelMenu
};
