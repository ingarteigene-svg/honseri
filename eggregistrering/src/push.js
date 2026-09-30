// Web Push utan eksterne bibliotek (RFC 8030, 8291 og 8292), berre WebCrypto.
//
//  * VAPID (RFC 8292): Workeren identifiserer seg overfor push-tenesta (Apple,
//    Google, Mozilla) med eit ES256-signert token. Nøkkelparet blir laga automatisk
//    første gong og lagra i tabellen settings, så det krevst ikkje noko oppsett.
//  * Kryptering (RFC 8291, aes128gcm): innhaldet i varselet blir kryptert til den
//    einskilde telefonen, slik at push-tenesta ikkje kan lese det.

const enc = new TextEncoder();

export function b64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s) {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** HKDF-SHA256 (extract + expand) med gitt lengd i byte. */
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/** Hentar VAPID-nøkkelparet, eller lagar det første gong. */
export async function getVapid(db) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'vapid'").first();
  if (row) return JSON.parse(row.value);
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const privateJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const publicKey = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)));
  // INSERT OR IGNORE: om to førespurnader lagar nøkkel samtidig, vinn den første.
  await db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('vapid', ?)")
    .bind(JSON.stringify({ privateJwk, publicKey })).run();
  const again = await db.prepare("SELECT value FROM settings WHERE key = 'vapid'").first();
  return JSON.parse(again.value);
}

/** Authorization-header for push-tenesta (VAPID, ES256). */
export async function vapidHeader(endpoint, vapid, subject, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64url(enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', vapid.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // WebCrypto gir signaturen som r||s (64 byte), som er akkurat formatet JWS ES256 krev.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${payload}`)));
  return `vapid t=${header}.${payload}.${b64url(sig)}, k=${vapid.publicKey}`;
}

/**
 * Krypterer innhaldet til éin telefon (RFC 8291, aes128gcm).
 * p256dh og auth kjem frå PushSubscription.keys i nettlesaren.
 */
export async function encryptPayload(p256dh, auth, payload, testOverride = {}) {
  const uaPublic = fromB64url(p256dh);
  const authSecret = fromB64url(auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('Ugyldig p256dh-nøkkel');
  if (authSecret.length !== 16) throw new Error('Ugyldig auth-nøkkel');

  const local = testOverride.localKeyPair ||
    await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));

  const ikm = await hkdf(authSecret, ecdhSecret, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = testOverride.salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const body = typeof payload === 'string' ? enc.encode(payload) : payload;
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // Éin enkelt post: innhald + skiljeteikn 0x02 (siste post), ingen utfylling.
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, concat(body, new Uint8Array([2]))));

  const rs = 4096;
  const header = concat(salt, new Uint8Array([(rs >>> 24) & 255, (rs >>> 16) & 255, (rs >>> 8) & 255, rs & 255]),
    new Uint8Array([asPublic.length]), asPublic);
  return concat(header, ciphertext);
}

/**
 * Sender eitt varsel. Returnerer HTTP-status frå push-tenesta.
 * 404/410 betyr at abonnementet er utgått og bør fjernast.
 */
export async function sendPush(sub, message, vapid, subject) {
  const body = await encryptPayload(sub.p256dh, sub.auth, JSON.stringify(message));
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(sub.endpoint, vapid, subject),
      TTL: '43200',
      Urgency: 'normal',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
    },
    body,
  });
  return res.status;
}
