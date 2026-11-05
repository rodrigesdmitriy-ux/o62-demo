// клиент API брони
const API_BASE = window.B62_API_BASE || '/api/v1';
// Статический config.json на случай недоступного API
const CONFIG_STATIC = window.B62_CONFIG_STATIC || '/config.json';

// Таймаут GET-запросов, после него включается фолбэк
const TIMEOUT_MS = 4000;

async function request(path, options) {
  const opts = Object.assign({}, options);
  if (!opts.signal && typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
    const ms = opts.method && opts.method !== 'GET' ? 20000 : TIMEOUT_MS;
    opts.signal = AbortSignal.timeout(ms);
  }
  const res = await fetch(API_BASE + path, opts);
  if (!res.ok) {
    const err = new Error('B62 API ' + path + ': HTTP ' + res.status);
    err.status = res.status;
    err.body = await res.json().catch(() => null);
    throw err;
  }
  return res.json();
}

// GET {API_BASE}/config
export async function getConfig() {
  try {
    return await request('/config');
  } catch (e) {
    // API недоступен: читаем статический config.json
    console.warn('[b62] /api/v1/config недоступен, читаю /config.json:', e.message);
    const res = await fetch(CONFIG_STATIC);
    if (!res.ok) throw new Error('B62: не загрузить config.json (HTTP ' + res.status + ')');
    return res.json();
  }
}

// GET {API_BASE}/availability?date=YYYY-MM-DD
// при ошибке все столы свободны
export async function getAvailability(businessDate) {
  try {
    return await request('/availability?date=' + encodeURIComponent(businessDate));
  } catch (e) {
    console.warn('[b62] availability недоступен, отдаю fallback:', e.message);
    return {
      source: 'fallback',
      businessDate: businessDate,
      generatedAt: new Date().toISOString(),
      tables: {} // пусто = все столы свободны
    };
  }
}

// POST {API_BASE}/bookings с заголовком Idempotency-Key
export async function createBooking(payload, idemKey) {
  return request('/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idemKey },
    body: JSON.stringify(payload)
  });
}
