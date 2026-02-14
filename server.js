const express = require('express');

const { getPayment, isPaid } = require('./yookassa');
const { setSubscribed, upsertPayment } = require('./db');

function startServer(bot) {
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  app.get('/', (req, res) => {
    res.status(200).send('ok');
  });

  app.get('/health', (req, res) => {
    res.status(200).json({ ok: true, ts: Date.now() });
  });

  // ✅ Анти-дубликат: YooKassa может присылать webhook повторно
  const seen = new Map(); // paymentId -> ts
  const SEEN_TTL_MS = 10 * 60 * 1000;

  function markSeen(id) {
    const now = Date.now();
    seen.set(id, now);
    // чистим старое
    for (const [k, ts] of seen.entries()) {
      if (now - ts > SEEN_TTL_MS) seen.delete(k);
    }
  }

  function isSeen(id) {
    const ts = seen.get(id);
    if (!ts) return false;
    if (Date.now() - ts > SEEN_TTL_MS) {
      seen.delete(id);
      return false;
    }
    return true;
  }

  // Webhook from YooKassa
  app.post('/yookassa/webhook', async (req, res) => {
    try {
      const body = req.body || {};
      const event = String(body.event || '');
      const obj = body.object || {};
      const paymentId = String(obj.id || '');

      console.log('[YK] webhook event=', event, 'paymentId=', paymentId);

      // ✅ Обрабатываем только payment.* (остальное игнорируем)
      if (!event.startsWith('payment.')) {
        res.status(200).send('ok');
        return;
      }

      if (!paymentId) {
        res.status(400).send('no payment id');
        return;
      }

      // ✅ Быстрая защита от повторов
      if (isSeen(paymentId)) {
        res.status(200).send('ok');
        return;
      }
      markSeen(paymentId);

      // ✅ Подтверждаем оплату НЕ по webhook-данным, а через API
      const payment = await getPayment(paymentId);

      const userIdRaw = payment?.metadata?.user_id ? String(payment.metadata.user_id) : '';
      const userId = Number(userIdRaw);

      if (!Number.isFinite(userId) || userId <= 0) {
        console.log('[YK] invalid user_id in metadata', userIdRaw);
        res.status(200).send('ok');
        return;
      }

      const amountValue = payment?.amount?.value ? String(payment.amount.value) : '0.00';
      const amountCurrency = payment?.amount?.currency ? String(payment.amount.currency) : 'RUB';
      const status = payment?.status ? String(payment.status) : 'unknown';

      // ✅ Время платежа (для варианта А — подписка “active by succeeded in last 30 days”)
      const createdAtMs =
        payment && payment.created_at
          ? Date.parse(String(payment.created_at))
          : Date.now();

      // ✅ сохраняем/обновляем платеж в БД
      try {
        upsertPayment({
          user_id: userId,
          yk_payment_id: paymentId,
          status,
          amount_value: amountValue,
          amount_currency: amountCurrency,
          created_at: Number.isFinite(createdAtMs) ? createdAtMs : Date.now()
        });
      } catch (e) {
        console.log('[YK] upsertPayment failed', paymentId, e?.message);
      }

      if (isPaid(payment)) {
        // можно оставить: флаг удобен, но UI теперь должен смотреть по payments (вариант А)
        try {
          setSubscribed(userId, true);
        } catch (e) {
          console.log('[YK] setSubscribed failed', userId, e?.message);
        }

        // Пишем пользователю подтверждение
        try {
          await bot.telegram.sendMessage(
            userId,
            '✅ Оплата получена.\nПодписка активна: утро + вечер.\nЯ рядом.'
          );
        } catch (e) {
          console.log('[YK] notify user failed', userId, e?.message);
        }
      }

      res.status(200).send('ok');
    } catch (e) {
      console.error('[YK] webhook error', e?.message || e);
      // ✅ 200, чтобы YooKassa не устроила шторм повторов
      res.status(200).send('ok');
    }
  });

  const port = Number(process.env.PORT || '8080');
  app.listen(port, () => {
    console.log(`🌐 HTTP server listening on ${port}`);
    console.log(`🌐 Webhook path: /yookassa/webhook`);
  });

  return app;
}

module.exports = { startServer };
