// Integrasjonstestar mot ein lokal Worker med eigen, tom D1-database.
// Ei falsk push-teneste på 127.0.0.1 tek imot varsla, og dei blir dekrypterte
// med referanseimplementasjonen http_ece, slik ein telefon ville gjort.
// Køyr: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import nodeCrypto from 'node:crypto';
import ece from 'http_ece';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8890 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const persist = mkdtempSync(join(tmpdir(), 'honseri-test-'));
const wrangler = join(root, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' };
let proc;

function today() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' }).format(new Date());
}
function daysAgo(n) {
  const d = new Date(`${today()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
/** Tidspunkt (ms) i dag kl. hh:00 norsk tid. */
function osloTodayAt(hh) {
  for (let utc = 0; utc < 24; utc++) {
    const t = Date.parse(`${today()}T${String(utc).padStart(2, '0')}:00:00Z`);
    const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', hourCycle: 'h23' }).format(t));
    if (h === hh) return t;
  }
  throw new Error('fann ikkje tidspunkt');
}

async function call(method, path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'X-Dev-User': 'inese@gard.no', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

function sqlRaw(command) {
  let out;
  try {
    out = execFileSync(wrangler, ['d1', 'execute', 'DB', '--local', '--persist-to', persist, '--json', '--command', command], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env,
    });
  } catch (e) {
    throw new Error(`${e.stdout}${e.stderr}`); // feilmeldinga frå databasen står i stdout
  }
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
}
// `wrangler d1 execute` mot same lokale database kan få dev-tenaren til å laste
// databasen på nytt; vent til han svarar igjen før neste API-kall.
async function sql(command) {
  try { return sqlRaw(command); } finally { await waitReady(); }
}

async function waitReady() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/api/me`, { headers: { 'X-Dev-User': 'x@y.no' } });
      if (r.ok) return;
    } catch { /* ventar */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Worker svarar ikkje');
}

// --- Falsk push-teneste ---------------------------------------------------
const received = [];
let pushServer;
let PUSH;
const phones = {};
function phone(name) {
  const ecdh = nodeCrypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = nodeCrypto.randomBytes(16).toString('base64url');
  phones[name] = { ecdh, auth };
  return { endpoint: `${PUSH}/push/${name}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth } };
}
function open(msg) {
  const p = phones[msg.path.split('/').pop()];
  return JSON.parse(ece.decrypt(msg.body, { version: 'aes128gcm', privateKey: p.ecdh, authSecret: p.auth }).toString('utf8'));
}
async function waitForPush(n, ms = 8000) {
  const t0 = Date.now();
  while (received.length < n && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 100));
  return received.length;
}

before(async () => {
  pushServer = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      res.statusCode = req.url.endsWith('/gone') ? 410 : 201;
      res.end();
    });
  });
  await new Promise((r) => pushServer.listen(0, '127.0.0.1', r));
  PUSH = `http://127.0.0.1:${pushServer.address().port}`;

  execFileSync(wrangler, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist], { cwd: root, stdio: 'ignore', env });
  proc = spawn(wrangler, ['dev', '--local', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', persist,
    '--var', 'DEV_USER:test@gard.no', '--test-scheduled', '--show-interactive-dev-session=false'], { cwd: root, stdio: 'ignore', env });
  await waitReady();
});

after(() => {
  proc?.kill();
  pushServer?.close();
  rmSync(persist, { recursive: true, force: true });
});

const entry = (id, extra = {}) => ({ id, navn: 'Inese', dato: daysAgo(1), egg: 900, ...extra });
const auditFor = async (uid) => sql(
  `SELECT a.action, a.user FROM audit_log a JOIN entries e ON e.id = a.entity_id WHERE e.uid = '${uid}' ORDER BY a.id`,
);

// --- Registreringar ----------------------------------------------------------

test('ny registrering blir lagra med alle felt, desimalkomma og brukar', async () => {
  const r = await call('POST', '/api/entries', entry('a1', {
    store: 2, vanlige: '3', pall200: 4, for: '48,5', vann: 1200.25, timer: '7,5', dode: 1, kommentar: '  Fint vêr  ',
  }));
  assert.equal(r.status, 201);
  const e = r.data.entry;
  assert.equal(e.id, 'a1');
  assert.equal(e.egg, 900);
  assert.equal(e.vanlige, 3);
  assert.equal(e.for, 48.5);
  assert.equal(e.timer, 7.5);
  assert.equal(e.kommentar, 'Fint vêr');
  assert.equal(e.createdBy, 'inese@gard.no');
  const list = await call('GET', '/api/entries');
  assert.equal(list.data.entries.length, 1);
});

test('validering: tom, ikkje heiltal, fram i tid, for mange timar og ugyldig id blir avvist', async () => {
  assert.match((await call('POST', '/api/entries', { id: 'b1', dato: daysAgo(1) })).data.error, /minst eitt felt/);
  assert.match((await call('POST', '/api/entries', entry('b2', { egg: 10.5 }))).data.error, /heilt tal/);
  assert.match((await call('POST', '/api/entries', entry('b3', { dato: daysAgo(-1) }))).data.error, /fram i tid/);
  assert.match((await call('POST', '/api/entries', entry('b4', { timer: 25 }))).data.error, /utanfor/);
  assert.match((await call('POST', '/api/entries', entry('b 5'))).data.error, /id/);
  assert.match((await call('POST', '/api/entries', entry('b6', { egg: -1 }))).data.error, /utanfor/);
  assert.equal((await call('GET', '/api/entries')).data.entries.length, 1);
});

test('redigering blir logga, men gjentatt identisk sending gir ingen ny loggrad', async () => {
  await call('POST', '/api/entries', entry('c1'));
  const r = await call('POST', '/api/entries', entry('c1', { egg: 930 }), { 'X-Dev-User': 'lars@gard.no' });
  assert.equal(r.status, 200);
  assert.equal(r.data.entry.egg, 930);
  assert.equal(r.data.entry.updatedBy, 'lars@gard.no');
  await call('POST', '/api/entries', entry('c1', { egg: 930 }));
  await call('POST', '/api/entries', entry('c1', { egg: 930 }));
  const log = await auditFor('c1');
  assert.deepEqual(log.map((a) => a.action), ['oppretta', 'endra']);
  assert.equal(log[1].user, 'lars@gard.no');
});

test('sletting er mjuk og kan angrast, og hard sletting er blokkert', async () => {
  await call('POST', '/api/entries', entry('d1'));
  assert.equal((await call('POST', '/api/entries/d1/delete', {})).status, 200);
  assert.ok(!(await call('GET', '/api/entries')).data.entries.some((e) => e.id === 'd1'));
  assert.equal((await call('POST', '/api/entries/d1/delete', {})).status, 200, 'gjentatt sletting er ok');
  assert.equal((await call('POST', '/api/entries/d1/restore', {})).status, 200);
  assert.ok((await call('GET', '/api/entries')).data.entries.some((e) => e.id === 'd1'));
  assert.equal((await call('POST', '/api/entries/finst-ikkje/delete', {})).status, 404);
  assert.deepEqual((await auditFor('d1')).map((a) => a.action), ['oppretta', 'sletta', 'gjenoppretta']);
  await assert.rejects(() => sql("DELETE FROM entries WHERE uid = 'd1'"), /SLETTING_IKKE_TILLATT/);
  await assert.rejects(() => sql('DELETE FROM audit_log'), /SLETTING_IKKE_TILLATT/);
});

test('ei sletta registrering som blir lagra på nytt, kjem tilbake', async () => {
  await call('POST', '/api/entries', entry('e1'));
  await call('POST', '/api/entries/e1/delete', {});
  await call('POST', '/api/entries', entry('e1', { egg: 950 }));
  const e = (await call('GET', '/api/entries')).data.entries.find((x) => x.id === 'e1');
  assert.equal(e.egg, 950);
});

test('import: nye blir lagra, dupliktat og ugyldige blir hoppa over, og det tåler ny innlesing', async () => {
  const list = [entry('imp-1'), entry('imp-2', { navn: 'Vasyl', egg: 0, pall200: 3 }), entry('imp-3', { egg: 0 }), entry('a1')];
  const r = await call('POST', '/api/import', { entries: list });
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.imported, r.data.skipped, r.data.invalid], [2, 1, 1]);
  const again = await call('POST', '/api/import', { entries: list });
  assert.deepEqual([again.data.imported, again.data.skipped], [0, 3]);
  assert.equal((await auditFor('imp-2'))[0].action, 'importert');
});

test('vern: skriving frå anna opphav og utan JSON blir avvist', async () => {
  const cross = await call('POST', '/api/entries', entry('f1'), { Origin: 'https://ond.example' });
  assert.equal(cross.status, 403);
  const res = await fetch(`${BASE}/api/entries`, { method: 'POST', headers: { 'X-Dev-User': 'x@y.no', 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(res.status, 415);
});

test('statiske filer blir serverte gjennom Workeren', async () => {
  const sw = await fetch(`${BASE}/sw.js`);
  assert.equal(sw.status, 200);
  assert.match(await sw.text(), /honseri-cf-v/);
  const icon = await fetch(`${BASE}/icons/icon-192.png`);
  assert.equal(icon.status, 200);
  assert.match(icon.headers.get('content-type') || '', /image\/png/);
});

test('ukjende stiar viser appen', async () => {
  const res = await fetch(`${BASE}/noko/tull`, { headers: { 'X-Dev-User': 'x@y.no' } });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Hønseri/);
});

// --- Push ----------------------------------------------------------------------

test('push: nøkkel, abonnement og testvarsel som telefonen kan dekryptere', async () => {
  const key = await call('GET', '/api/push/key');
  assert.match(key.data.publicKey, /^[A-Za-z0-9_-]{87}$/);
  const sub = phone('inese');
  assert.equal((await call('POST', '/api/push/subscribe', { subscription: sub, lang: 'lv', navn: 'Inese' })).status, 201);
  received.length = 0;
  assert.equal((await call('POST', '/api/push/test', { endpoint: sub.endpoint })).status, 200);
  assert.equal(await waitForPush(1), 1);
  const msg = received[0];
  assert.equal(msg.headers['content-encoding'], 'aes128gcm');
  assert.match(msg.headers.authorization, /^vapid t=.+, k=/);
  assert.equal(msg.headers.ttl, '43200');
  assert.equal(open(msg).body, 'Paziņojumi šajā tālrunī darbojas.');
});

test('push: ugyldig abonnement blir avvist', async () => {
  const r = await call('POST', '/api/push/subscribe', { subscription: { endpoint: 'http://ond.example/x', keys: { p256dh: 'a', auth: 'b' } } });
  assert.equal(r.status, 400);
});

test('påminning kl. 17: berre når egg manglar, éin gong per dag, på språket til telefonen', async () => {
  const sub = phone('vasyl');
  await call('POST', '/api/push/subscribe', { subscription: sub, lang: 'uk', navn: 'Vasyl' });
  const gone = phone('gone');
  await call('POST', '/api/push/subscribe', { subscription: gone, lang: 'no' });
  const trigger = (hh) => fetch(`${BASE}/cdn-cgi/handler/scheduled?cron=0+15+*+*+*&time=${osloTodayAt(hh)}`);

  // Egg registrert i dag → ingen påminning
  await call('POST', '/api/entries', { id: 'idag', navn: 'Inese', dato: today(), egg: 800 });
  received.length = 0;
  await trigger(17);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(received.length, 0, 'ingen varsel når egg er registrert');

  // Ikkje kl. 17 → ingen påminning
  await call('POST', '/api/entries/idag/delete', {});
  await trigger(16);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(received.length, 0, 'ingen varsel utanom kl. 17');

  // Egg manglar kl. 17 → varsel til alle abonnement
  await trigger(17);
  assert.ok((await waitForPush(3)) >= 3, `fekk ${received.length} varsel`);
  const toVasyl = received.find((m) => m.path.endsWith('/vasyl'));
  assert.equal(open(toVasyl).body, 'Яйця сьогодні ще не зареєстровані.');
  const toInese = received.find((m) => m.path.endsWith('/inese'));
  assert.equal(open(toInese).body, 'Olas šodien vēl nav reģistrētas.');

  // Utgått abonnement (410) blir fjerna
  assert.equal((await sql("SELECT count(*) AS n FROM push_subscriptions WHERE endpoint LIKE '%/gone'"))[0].n, 0);

  // Same dag igjen → ikkje dobbelt
  const n = received.length;
  await trigger(17);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(received.length, n, 'maks éi påminning per dag');
});

test('avmelding fjernar abonnementet', async () => {
  const sub = phone('lars');
  await call('POST', '/api/push/subscribe', { subscription: sub });
  await call('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint });
  assert.equal((await call('POST', '/api/push/test', { endpoint: sub.endpoint })).status, 404);
});
