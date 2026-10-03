// Enhetstester for verifisering av Cloudflare Access-token (JWT).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticate } from '../src/auth.js';

const TEAM = 'klokkargarden.cloudflareaccess.com';
const AUD = 'aud-tag-123';

const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify'],
);
const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'k1' };
const other = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify'],
);

globalThis.fetch = async (url) => {
  assert.equal(url, `https://${TEAM}/cdn-cgi/access/certs`);
  return new Response(JSON.stringify({ keys: [jwk] }));
};

const b64u = (buf) => Buffer.from(buf).toString('base64url');
async function sign(payload, key = privateKey, kid = 'k1') {
  const head = b64u(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const body = b64u(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64u(sig)}`;
}
const now = Math.floor(Date.now() / 1000);
const good = { aud: [AUD], email: 'Anne@Gard.no', exp: now + 600, iss: `https://${TEAM}` };
const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
const req = (token, url = 'https://gardsbutikk-admin.example.workers.dev/api/me') =>
  new Request(url, { headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {} });

test('gyldig token gir e-post (små bokstaver)', async () => {
  assert.equal(await authenticate(req(await sign(good)), env), 'anne@gard.no');
});

test('token fra cookie godtas', async () => {
  const t = await sign(good);
  const r = new Request('https://x.workers.dev/api/me', { headers: { Cookie: `a=b; CF_Authorization=${t}` } });
  assert.equal(await authenticate(r, env), 'anne@gard.no');
});

test('avviser manglende, utløpt, feil aud, feil utsteder og falsk signatur', async () => {
  assert.equal(await authenticate(req(null), env), null);
  assert.equal(await authenticate(req(await sign({ ...good, exp: now - 10 })), env), null);
  assert.equal(await authenticate(req(await sign({ ...good, aud: ['annen'] })), env), null);
  assert.equal(await authenticate(req(await sign({ ...good, iss: 'https://ond.cloudflareaccess.com' })), env), null);
  assert.equal(await authenticate(req(await sign(good, other.privateKey)), env), null);
  assert.equal(await authenticate(req('tull.tull.tull'), env), null);
});

test('DEV_USER virker bare på localhost', async () => {
  const devEnv = { ...env, DEV_USER: 'dev@x.no' };
  assert.equal(await authenticate(req(null, 'http://localhost:8787/api/me'), devEnv), 'dev@x.no');
  assert.equal(await authenticate(req(null), devEnv), null);
});

test('mangler Access-oppsett: alt avvises (fail closed)', async () => {
  const token = await sign(good);
  await assert.rejects(() => authenticate(req(token), {}), /ikke konfigurert/);
});

test('avvisning gir forståeleg grunn (feil aud viser begge taggane forkorta)', async () => {
  const { authenticateWithReason } = await import('../src/auth.js');
  const r = await authenticateWithReason(req(await sign({ ...good, aud: ['annenapp-123456'] })), env);
  assert.equal(r.user, null);
  assert.match(r.reason, /aud/);
  assert.match(r.reason, /annenap/);
  assert.match(r.reason, /aud-tag-/);
  const none = await authenticateWithReason(req(null), env);
  assert.match(none.reason, /Ingen innloggingsbillett/);
});
