// Vipps MobilePay ePayment API (betaling) – uten eksterne bibliotek.
//
// Flyt: opprett betaling (WEB_REDIRECT) → kunden godkjenner i Vipps-appen →
// vi henter status og trekker (capture) beløpet med en gang, fordi kunden tar
// varene med seg. Kortdata eller kundeopplysninger kommer aldri innom Workeren.
//
// Nøklene ligger som hemmeligheter i Workeren (se README):
//   VIPPS_CLIENT_ID, VIPPS_CLIENT_SECRET, VIPPS_SUBSCRIPTION_KEY, VIPPS_MSN
//   VIPPS_ENV = test | prod   (test = Vipps' testmiljø med MT-appen)

const BASE = { test: 'https://apitest.vipps.no', prod: 'https://api.vipps.no' };
const SYSTEM = { name: 'klokkargarden-gardsbutikk', version: '1.0' };

export class VippsError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Vipps-oppsettet, eller null når nøklene ikke er lagt inn ennå. */
export function config(env) {
  const c = {
    clientId: (env.VIPPS_CLIENT_ID || '').trim(),
    clientSecret: (env.VIPPS_CLIENT_SECRET || '').trim(),
    subKey: (env.VIPPS_SUBSCRIPTION_KEY || '').trim(),
    msn: (env.VIPPS_MSN || '').trim(),
  };
  if (!c.clientId || !c.clientSecret || !c.subKey || !c.msn) return null;
  c.env = env.VIPPS_ENV === 'prod' ? 'prod' : 'test';
  // VIPPS_API_URL brukes bare av de automatiske testene (falsk Vipps på 127.0.0.1).
  c.base = (env.VIPPS_API_URL || BASE[c.env]).replace(/\/$/, '');
  return c;
}

let tokenCache = { key: '', token: '', exp: 0 };

function baseHeaders(c) {
  return {
    'Ocp-Apim-Subscription-Key': c.subKey,
    'Merchant-Serial-Number': c.msn,
    'Vipps-System-Name': SYSTEM.name,
    'Vipps-System-Version': SYSTEM.version,
    'Vipps-System-Plugin-Name': SYSTEM.name,
    'Vipps-System-Plugin-Version': SYSTEM.version,
  };
}

async function errorText(res) {
  try {
    const b = await res.json();
    return b.detail || b.title || b.error_description || b.error || JSON.stringify(b).slice(0, 200);
  } catch {
    return `HTTP ${res.status}`;
  }
}

export async function accessToken(c, { refresh = false } = {}) {
  const key = `${c.base}|${c.clientId}|${c.msn}`;
  if (!refresh && tokenCache.key === key && tokenCache.exp > Date.now()) return tokenCache.token;
  const res = await fetch(`${c.base}/accesstoken/get`, {
    method: 'POST',
    headers: { ...baseHeaders(c), client_id: c.clientId, client_secret: c.clientSecret },
  });
  if (!res.ok) throw new VippsError(res.status, `Vipps godtok ikke nøklene (${res.status}): ${await errorText(res)}`);
  const b = await res.json();
  const seconds = Number(b.expires_in) || 3600;
  tokenCache = { key, token: b.access_token, exp: Date.now() + Math.max(60, seconds - 120) * 1000 };
  return tokenCache.token;
}

async function api(c, method, path, body, idempotencyKey) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken(c, { refresh: attempt > 0 });
    const headers = { ...baseHeaders(c), Authorization: `Bearer ${token}` };
    if (body) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const res = await fetch(`${c.base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401 && attempt === 0) continue; // utløpt token: hent nytt og prøv én gang til
    if (!res.ok) throw new VippsError(res.status, `Vipps svarte ${res.status}: ${await errorText(res)}`);
    return res.status === 204 ? {} : res.json();
  }
  throw new VippsError(401, 'Vipps avviste tilgangen.');
}

const nok = (ore) => ({ currency: 'NOK', value: ore });

/** Oppretter betalingen. Returnerer { redirectUrl, reference }. */
export function createPayment(c, { reference, amountOre, description, returnUrl }) {
  return api(c, 'POST', '/epayment/v1/payments', {
    amount: nok(amountOre),
    paymentMethod: { type: 'WALLET' },
    reference,
    userFlow: 'WEB_REDIRECT',
    returnUrl,
    paymentDescription: description.slice(0, 100),
  }, `create-${reference}`);
}

export function getPayment(c, reference) {
  return api(c, 'GET', `/epayment/v1/payments/${encodeURIComponent(reference)}`);
}

export function capturePayment(c, reference, amountOre) {
  return api(c, 'POST', `/epayment/v1/payments/${encodeURIComponent(reference)}/capture`,
    { modificationAmount: nok(amountOre) }, `capture-${reference}`);
}

export function refundPayment(c, reference, amountOre) {
  return api(c, 'POST', `/epayment/v1/payments/${encodeURIComponent(reference)}/refund`,
    { modificationAmount: nok(amountOre) }, `refund-${reference}`);
}
