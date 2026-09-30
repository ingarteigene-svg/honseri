// Einingstestar for Web Push: kryptering (RFC 8291) og VAPID-signatur (RFC 8292).
// Krypteringa blir kontrollert med ein uavhengig referanseimplementasjon (http_ece),
// og signaturen med Node sin eigen kryptomodul.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodeCrypto from 'node:crypto';
import ece from 'http_ece';
import { encryptPayload, vapidHeader, getVapid, b64url, fromB64url } from '../src/push.js';

// «Telefonen»: nøkkelpar og auth-hemmelegheit slik nettlesaren lagar dei
function phone() {
  const ecdh = nodeCrypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = nodeCrypto.randomBytes(16);
  return { ecdh, p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url'), authBuf: auth };
}

function decrypt(body, p) {
  return ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: p.ecdh, authSecret: p.auth }).toString('utf8');
}

test('kryptert varsel kan dekrypterast av telefonen (referanseimplementasjon)', async () => {
  const p = phone();
  const msg = JSON.stringify({ title: 'Hønseri 🥚', body: 'Яйця сьогодні ще не зареєстровані.' });
  const body = await encryptPayload(p.p256dh, p.auth, msg);
  assert.equal(decrypt(body, p), msg);
});

test('kvar sending blir kryptert ulikt (nytt salt og ny nøkkel)', async () => {
  const p = phone();
  const a = await encryptPayload(p.p256dh, p.auth, 'x');
  const b = await encryptPayload(p.p256dh, p.auth, 'x');
  assert.notDeepEqual(Buffer.from(a.slice(0, 16)), Buffer.from(b.slice(0, 16)));
  assert.equal(decrypt(a, p), 'x');
  assert.equal(decrypt(b, p), 'x');
});

test('hovudet i meldinga følgjer aes128gcm-formatet', async () => {
  const p = phone();
  const body = await encryptPayload(p.p256dh, p.auth, 'hei');
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
  assert.equal(rs, 4096);
  assert.equal(body[20], 65); // lengd på avsendarnøkkel
  assert.equal(body[21], 4);  // ukomprimert P-256-punkt
  assert.equal(body.length, 16 + 4 + 1 + 65 + 'hei'.length + 1 + 16);
});

test('feil telefonnøkkel blir avvist', async () => {
  const p = phone();
  await assert.rejects(() => encryptPayload('AAAA', p.auth, 'x'), /p256dh/);
  await assert.rejects(() => encryptPayload(p.p256dh, 'AAAA', 'x'), /auth/);
});

// Enkel etterlikning av D1 for getVapid
function fakeDb() {
  const store = new Map();
  return {
    prepare(sql) {
      let args = [];
      const stmt = {
        bind(...a) { args = a; return stmt; },
        async first() { return store.has('vapid') ? { value: store.get('vapid') } : null; },
        async run() { if (/INSERT OR IGNORE/.test(sql) && !store.has('vapid')) store.set('vapid', args[0]); return { meta: {} }; },
      };
      return stmt;
    },
  };
}

test('VAPID-nøkkel blir laga éin gong og gjenbrukt', async () => {
  const db = fakeDb();
  const a = await getVapid(db);
  const b = await getVapid(db);
  assert.equal(a.publicKey, b.publicKey);
  assert.equal(fromB64url(a.publicKey).length, 65);
});

test('VAPID-token har rett mottakar, avsendar og gyldig ES256-signatur', async () => {
  const vapid = await getVapid(fakeDb());
  const endpoint = 'https://web.push.apple.com/QGuQyavXutnMH-abc';
  const h = await vapidHeader(endpoint, vapid, 'https://honseri.klokkargarden.workers.dev');
  const m = h.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
  assert.ok(m, h);
  const [, head, payload, sig, k] = m;
  assert.equal(k, vapid.publicKey);
  assert.deepEqual(JSON.parse(Buffer.from(head, 'base64url')), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(Buffer.from(payload, 'base64url'));
  assert.equal(claims.aud, 'https://web.push.apple.com');
  assert.equal(claims.sub, 'https://honseri.klokkargarden.workers.dev');
  const left = claims.exp - Math.floor(Date.now() / 1000);
  assert.ok(left > 11 * 3600 && left <= 12 * 3600, `exp om ${left} s`);

  const raw = fromB64url(vapid.publicKey);
  const pub = nodeCrypto.createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: b64url(raw.slice(1, 33)), y: b64url(raw.slice(33, 65)) },
    format: 'jwk',
  });
  const ok = nodeCrypto.verify('sha256', Buffer.from(`${head}.${payload}`), { key: pub, dsaEncoding: 'ieee-p1363' },
    Buffer.from(sig, 'base64url'));
  assert.ok(ok, 'signaturen skal vere gyldig');
});
