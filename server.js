const express = require('express');

const { getPayment, isPaid } = require('./yookassa');
const { setSubscribed, upsertPayment } = require('./db');

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is missing`);
  return v;
}

function startServer(bot) {
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  app.get('/', (req, res) => {
    res.status(200).send('ok');
  });

  app.get('/health', (req, res) => {
    res.status(200).json({ ok: true, ts: Date.now() });
  });

  // Webhook from YooKassa
  app.post('/yookassa/webhook', async (req, res) => {
    try {
      const body = req.body || {};
      const event = String(body.event || '');
      const obj = body.object || {};
      const paymentId = String(obj.id || '');

      console.log('[YK] webhook event=', event, 'paymentId=', paymentId);

      if (!paymentId) {
        res.status(400).send('no payment id');
        return;
      }

      // Подтверждаем оплату НЕ по webhook-данным, а через API (самый надёжный способ)
      const payment = await getPayment(paymentId);

      const userIdRaw = payment && payment.metadata && payment.metadata.user_id ? String(payment.metadata.user_id) : '';
      const userId = Number(userIdRaw);

      if (!Number.isFinite(userId) || userId <= 0) {
        console.log('[YK] invalid user_id in metadata', userIdRaw);
        res.status(200).send('ok');
        return;
      }

      const amountValue = payment && payment.amount && payment.amount.value ? String(payment.amount.value) : '0.00';
      const amountCurrency = payment && payment.amount && payment.amount.currency ? String(payment.amount.currency) : 'RUB';
      const status = payment && payment.status ? String(payment.status) : 'unknown';

      upsertPayment({
        user_id: userId,
        yk_payment_id: paymentId,
        status,
        amount_value: amountValue,
        amount_currency: amountCurrency
      });

      if (isPaid(payment)) {
        setSubscribed(userId, true);

        // Пишем пользователю “подтверждение”
        try {
          await bot.telegram.sendMessage(
            userId,
            '✅ Оплата получена.\nПодписка активна: утро + вечер.\nЯ рядом.',
          );
        } catch (e) {
          console.log('[YK] notify user failed', userId, e.message);
        }
      }

      res.status(200).send('ok');
    } catch (e) {
      console.error('[YK] webhook error', e);
      // ЮKassa может повторять webhook — поэтому даже при ошибке чаще лучше 200,
      // но если хочешь ретраи от ЮKassa — ставь 500. Я ставлю 200, чтобы не зациклить.
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
