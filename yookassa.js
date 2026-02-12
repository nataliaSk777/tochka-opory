const https = require('https');
const crypto = require('crypto');

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is missing`);
  return v;
}

function ykRequest(method, path, bodyObj) {
  const shopId = mustEnv('YOOKASSA_SHOP_ID');
  const secretKey = mustEnv('YOOKASSA_SECRET_KEY');

  const body = bodyObj ? JSON.stringify(bodyObj) : '';
  const auth = Buffer.from(`${shopId}:${secretKey}`).toString('base64');

  const options = {
    hostname: 'api.yookassa.ru',
    port: 443,
    path,
    method,
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch (_) {}
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, data: parsed });
        } else {
          const msg = parsed && parsed.description ? parsed.description : data;
          reject(new Error(`YooKassa API error ${res.statusCode}: ${msg}`));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function makeIdempotenceKey(userId) {
  return crypto.createHash('sha256')
    .update(`${userId}:${Date.now()}:${Math.random()}`)
    .digest('hex');
}

async function createSubscriptionPayment({ userId, returnUrl }) {
  const amount = Number(process.env.PRICE_RUB || '490');
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('PRICE_RUB must be a positive number');

  const idempotenceKey = makeIdempotenceKey(userId);

  const payload = {
    amount: {
      value: amount.toFixed(2),
      currency: 'RUB'
    },
    confirmation: {
      type: 'redirect',
      return_url: returnUrl
    },
    capture: true,
    description: 'Подписка «Точка опоры» на 1 месяц',
    metadata: {
      user_id: String(userId)
    }
  };

  // idempotence-key у ЮKassa передаётся заголовком, но через голый https.request удобнее встроить в path нельзя.
  // Поэтому делаем отдельную реализацию с заголовком:
  return createPaymentWithIdempotence(payload, idempotenceKey);
}

function createPaymentWithIdempotence(payload, idempotenceKey) {
  const shopId = mustEnv('YOOKASSA_SHOP_ID');
  const secretKey = mustEnv('YOOKASSA_SECRET_KEY');
  const body = JSON.stringify(payload);
  const auth = Buffer.from(`${shopId}:${secretKey}`).toString('base64');

  const options = {
    hostname: 'api.yookassa.ru',
    port: 443,
    path: '/v3/payments',
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
      'Idempotence-Key': idempotenceKey,
      'Content-Length': Buffer.byteLength(body)
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch (_) {}
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(parsed);
        } else {
          const msg = parsed && parsed.description ? parsed.description : data;
          reject(new Error(`YooKassa API error ${res.statusCode}: ${msg}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function getPayment(paymentId) {
  const r = await ykRequest('GET', `/v3/payments/${encodeURIComponent(paymentId)}`, null);
  return r.data;
}

// Истина, если платёж точно оплачен и захвачен
function isPaid(payment) {
  if (!payment) return false;
  // у ЮKassa: status = succeeded при успешной оплате, paid=true
  if (payment.status === 'succeeded') return true;
  if (payment.paid === true && payment.status === 'succeeded') return true;
  return false;
}

module.exports = {
  createSubscriptionPayment,
  getPayment,
  isPaid
};
