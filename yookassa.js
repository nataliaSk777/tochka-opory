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

function mustIntEnv(name) {
  const v = mustEnv(name);
  const n = Number(String(v).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return n;
}

function parseRubAmount(raw) {
  const s = String(raw ?? '').trim();
  const cleaned = s.replace(/[^\d.,]/g, '').replace(',', '.');
  const match = cleaned.match(/^\d+(\.\d{1,2})?/);
  const num = match ? Number(match[0]) : NaN;

  if (!Number.isFinite(num) || num <= 0) {
    throw new Error('PRICE_RUB must be a positive number');
  }
  return Math.round(num * 100) / 100;
}

function makeIdempotenceKey(userId) {
  return crypto.createHash('sha256')
    .update(`${userId}:${Date.now()}:${Math.random()}`)
    .digest('hex');
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

function normalizeEmail(s) {
  return String(s || '').trim().toLowerCase();
}

function isValidEmail(email) {
  const e = normalizeEmail(email);
  if (e.length < 6 || e.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

async function createSubscriptionPayment({ userId, returnUrl, customerEmail }) {
  const amount = parseRubAmount(process.env.PRICE_RUB || '490');
  const idempotenceKey = makeIdempotenceKey(userId);

  const email = normalizeEmail(customerEmail);
  if (!isValidEmail(email)) {
    const err = new Error('Customer email is required for receipt (54-FZ)');
    err.status = 400;
    err.data = { message: 'invalid_customer_email' };
    throw err;
  }

  // 54-ФЗ: эти поля ОБЯЗАТЕЛЬНЫ, если в магазине включены чеки.
  // TAX_SYSTEM_CODE: 1 ОСН, 2 УСН доход, 3 УСН доход-расход, 4 ЕНВД, 5 ЕСХН, 6 ПСН
  const taxSystemCode = mustIntEnv('TAX_SYSTEM_CODE');

  // VAT_CODE: 1 без НДС, 2 0%, 3 10%, 4 20%, 5 10/110, 6 20/120
  const vatCode = mustIntEnv('VAT_CODE');

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
    },
    receipt: {
      customer: {
        email
      },
      tax_system_code: taxSystemCode,
      items: [
        {
          description: 'Подписка «Точка опоры» (1 месяц)',
          quantity: '1.00',
          amount: {
            value: amount.toFixed(2),
            currency: 'RUB'
          },
          vat_code: vatCode,
          payment_subject: 'service',
          payment_mode: 'full_payment'
        }
      ]
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
  isPaid,
  isValidEmail
};
