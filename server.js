const express = require('express');

const { getPayment, isPaid } = require('./yookassa');
const { setSubscribed, upsertPayment, getSubscriptionUntilMs } = require('./db');

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

  function formatUntilRu(ms) {
    try {
      const d = new Date(ms);
      return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (_) {
      return '';
    }
  }

  // Webhook from YooKassa
  app.post('/yookassa/webhook', async (req, res) => {
    try {
      const body = req.body || {};
      const event = String(body.event || '');
      const obj = body.object || {};
      const paymentId = String(obj.id || '');

      console.log('[YK] webhook event=', event, 'paymentId=', paymentId);

      if (!event.startsWith('payment.')) {
        res.status(200).send('ok');
        return;
      }

      if (!paymentId) {
        res.status(400).send('no payment id');
        return;
      }

      if (isSeen(paymentId)) {
        res.status(200).send('ok');
        return;
      }
      markSeen(paymentId);

      // подтверждаем оплату через API
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

      const createdAtMs =
        payment && payment.created_at
          ? Date.parse(String(payment.created_at))
          : Date.now();

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
        try { setSubscribed(userId, true); } catch (_) {}

        // ✅ “активна до …” (30 дней)
        const untilMs = getSubscriptionUntilMs(userId, 30);
        const untilStr = untilMs ? formatUntilRu(untilMs) : '';

        const text = untilStr
          ? `✅ Оплата получена.\nПодписка активна до ${untilStr}.\nУтро + вечер включены.\nЯ рядом.`
          : '✅ Оплата получена.\nПодписка активна: утро + вечер.\nЯ рядом.';

        try {
          await bot.telegram.sendMessage(userId, text);
        } catch (e) {
          console.log('[YK] notify user failed', userId, e?.message);
        }
      }

      res.status(200).send('ok');
    } catch (e) {
      console.error('[YK] webhook error', e?.message || e);
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
