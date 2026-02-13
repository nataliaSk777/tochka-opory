require('dotenv').config();
const https = require('https');
const crypto = require('crypto');

function mustEnv(name) {
  const v = process.env[name];
  if (v === undefined || v === null || String(v).trim() === '') {
    throw new Error(`${name} is missing`);
  }
  return String(v).trim();
}

function parseRubAmount(raw) {
  // принимает "490", "490 ₽", "490.00", "490,00" -> 490 (Number)
  const s = String(raw ?? '').trim();

  // оставляем цифры, точку и запятую; запятую считаем десятичным разделителем
  const cleaned = s
    .replace(/[^\d.,]/g, '')
    .replace(',', '.');

  // если внезапно получилось "490.00.1" — берём первую валидную часть
  const match = cleaned.match(/^\d+(\.\d{1,2})?/);
  const num = match ? Number(match[0]) : NaN;

  if (!Number.isFinite(num) || num <= 0) {
    throw new Error('PRICE_RUB must be a positive number');
  }

  // YooKassa ждёт строку с 2 знаками, но нам удобно хранить Number
  return Math.round(num * 100) / 100;
}

function ykRequest(method, path, bodyObj, extraHeaders = {}) {
  const shopId = mustEnv('YOOKASSA_SHOP_ID');
  const secretKey = mustEnv('YOOKASSA_SECRET_KEY');

  const body = bodyObj ? JSON.stringify(bodyObj) : '';
  const auth = Buffer.from(`${shopId}:${secretKey}`).toString('base64');

  const headers = {
    'Authorization': `Basic ${auth}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...extraHeaders
  };

  if (body) headers['Content-Length'] = Buffer.byteLength(body);

  const options = {
    hostname: 'api.yookassa.ru',
    port: 443,
    path,
    method,
    headers
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
          return;
        }

        const err = new Error(
          `YooKassa API error ${res.statusCode}: ${
            (parsed && (parsed.description || parsed.message)) ? (parsed.description || parsed.message) : data
          }`
        );
        err.status = res.statusCode;
        err.data = parsed;
        reject(err);
      });
    });

    req.on('error', (e) => {
      const err = new Error(`YooKassa request error: ${e.message}`);
      err.cause = e;
      reject(err);
    });

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
  const amount = parseRubAmount(process.env.PRICE_RUB || '490');
  const idempotenceKey = makeIdempotenceKey(userId);

  const payload = {
    amount: {
      value: amount.toFixed(2),
      currency: 'RUB'
    },
    confirmation: {
      type: 'redirect',
      return_url: String(returnUrl || '').trim()
    },
    capture: true,
    description: 'Подписка «Точка опоры» на 1 месяц',
    metadata: {
      user_id: String(userId)
    }
  };

  const r = await ykRequest('POST', '/v3/payments', payload, { 'Idempotence-Key': idempotenceKey });
  return r.data;
}

async function getPayment(paymentId) {
  const r = await ykRequest('GET', `/v3/payments/${encodeURIComponent(paymentId)}`, null);
  return r.data;
}

function isPaid(payment) {
  if (!payment) return false;
  return payment.status === 'succeeded';
}

module.exports = {
  createSubscriptionPayment,
  getPayment,
  isPaid
};
