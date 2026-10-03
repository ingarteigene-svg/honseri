// Integrasjonstester mot en lokal Worker med egen, tom D1-database.
// En falsk Vipps-tjeneste på 127.0.0.1 spiller ePayment-API-et, slik at hele
// betalingsflyten (opprett → godkjent → capture → lager) testes uten ekte penger.
// Kjør: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8790 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const persist = mkdtempSync(join(tmpdir(), 'gardsbutikk-test-'));
const wrangler = join(root, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' };
let proc;

// --- Falsk Vipps ------------------------------------------------------------
const payments = new Map();
const calls = [];
const fake = { failCreate: false, wrongAmount: false };
let vippsServer;
let VIPPS;

function vippsHandler(req, res) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    const url = new URL(req.url, 'http://x');
    calls.push({ method: req.method, path: url.pathname, headers: req.headers, body });

    if (req.headers['ocp-apim-subscription-key'] !== 'test-sub' || req.headers['merchant-serial-number'] !== '123456') {
      return send(401, { title: 'Feil nøkkel' });
    }
    if (url.pathname === '/accesstoken/get') {
      if (req.headers.client_id !== 'test-id' || req.headers.client_secret !== 'test-secret') return send(401, { error: 'invalid_client' });
      return send(200, { token_type: 'Bearer', expires_in: '3599', access_token: 'tok-1' });
    }
    if (req.headers.authorization !== 'Bearer tok-1') return send(401, { title: 'Unauthorized' });

    if (url.pathname === '/epayment/v1/payments' && req.method === 'POST') {
      if (fake.failCreate) return send(500, { title: 'Intern feil' });
      assert.ok(req.headers['idempotency-key']);
      payments.set(body.reference, { ...body, state: 'CREATED', captured: 0, refunded: 0 });
      return send(201, { redirectUrl: `https://fake-vipps.example/landing/${body.reference}`, reference: body.reference });
    }
    const m = url.pathname.match(/^\/epayment\/v1\/payments\/([^/]+)(?:\/(capture|refund))?$/);
    const p = m && payments.get(m[1]);
    if (!p) return send(404, { title: 'Not found' });
    const nok = (v) => ({ currency: 'NOK', value: v });
    const view = () => ({
      reference: p.reference, state: p.state, pspReference: `psp-${p.reference.slice(-6)}`,
      amount: nok(fake.wrongAmount ? p.amount.value + 100 : p.amount.value),
      aggregate: { authorizedAmount: nok(p.state === 'AUTHORIZED' ? p.amount.value : 0), capturedAmount: nok(p.captured),
        refundedAmount: nok(p.refunded), cancelledAmount: nok(0) },
    });
    if (!m[2] && req.method === 'GET') return send(200, view());
    if (m[2] === 'capture') {
      if (p.state !== 'AUTHORIZED') return send(400, { title: 'Ikke godkjent' });
      p.captured += body.modificationAmount.value;
      return send(200, view());
    }
    if (m[2] === 'refund') {
      if (body.modificationAmount.value > p.captured - p.refunded) return send(400, { title: 'For mye' });
      p.refunded += body.modificationAmount.value;
      return send(200, view());
    }
    return send(404, { title: 'Ukjent' });
  });
}

// --- Hjelpere ---------------------------------------------------------------

async function call(method, path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'X-Dev-User': 'ingar@gard.no', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
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
    throw new Error(`${e.stdout}${e.stderr}`);
  }
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
}
async function sql(command) {
  try { return sqlRaw(command); } finally { await waitReady(); }
}

async function waitReady() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/api/butikk`);
      if (r.ok) return;
    } catch { /* venter */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Worker svarer ikke');
}

before(async () => {
  vippsServer = http.createServer(vippsHandler);
  await new Promise((r) => vippsServer.listen(0, '127.0.0.1', r));
  VIPPS = `http://127.0.0.1:${vippsServer.address().port}`;

  execFileSync(wrangler, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist], { cwd: root, stdio: 'ignore', env });
  const vars = {
    DEV_USER: 'test@gard.no', ROLE: 'begge', RATE_LIMIT: '1000', VIPPS_API_URL: VIPPS, VIPPS_ENV: 'test',
    VIPPS_CLIENT_ID: 'test-id', VIPPS_CLIENT_SECRET: 'test-secret', VIPPS_SUBSCRIPTION_KEY: 'test-sub', VIPPS_MSN: '123456',
  };
  proc = spawn(wrangler, ['dev', '--local', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', persist,
    ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`]),
    '--test-scheduled', '--show-interactive-dev-session=false'], { cwd: root, stdio: 'ignore', env });
  await waitReady();
});

after(() => {
  proc?.kill();
  vippsServer?.close();
  rmSync(persist, { recursive: true, force: true });
});

let P = {}; // produkt-id etter navn
const stock = async () => Object.fromEntries((await call('GET', '/api/admin/varer')).data.varer.map((v) => [v.navn, v.lager]));
const order = (linjer, metode = 'kontant') => call('POST', '/api/butikk/ordrer', { metode, linjer });
const receipt = (ref) => call('GET', `/api/butikk/ordrer/${ref}`);
const approve = (ref) => { payments.get(ref).state = 'AUTHORIZED'; };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Butikken ---------------------------------------------------------------

test('butikken viser de fire varene med riktige priser, og Vipps er klart', async () => {
  const r = await call('GET', '/api/butikk', null, { 'X-Dev-User': '' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.produkter.map((p) => [p.navn, p.pris]), [
    ['Vanlig eggbrett', 10000], ['XL eggbrett', 12000], ['Klink', 4000], ['Kartong 10 pk', 4000],
  ]);
  assert.ok(r.data.produkter.every((p) => p.status === null), 'lager ikke registrert ennå');
  assert.equal(r.data.vipps, true);
  assert.equal(r.data.vippsTest, true);
  assert.equal(r.data.butikk.butikknavn, 'Klokkargarden gårdsbutikk');
  P = Object.fromEntries(r.data.produkter.map((p) => [p.navn, p.id]));
});

test('lager: påfyll og telling (differansen blir svinn)', async () => {
  for (const id of Object.values(P)) {
    assert.equal((await call('POST', '/api/admin/lager', { produkt: id, type: 'påfyll', antall: 10 })).status, 200);
  }
  const t = await call('POST', '/api/admin/lager', { produkt: P.Klink, type: 'telling', antall: 8, kommentar: 'to knust' });
  assert.equal(t.data.vare.lager, 8);
  assert.equal((await call('POST', '/api/admin/lager', { produkt: P.Klink, type: 'påfyll', antall: 0 })).status, 400);
  assert.equal((await call('POST', '/api/admin/lager', { produkt: P.Klink, type: 'tull', antall: 1 })).status, 400);
  const shop = await call('GET', '/api/butikk');
  assert.equal(shop.data.produkter.find((p) => p.id === P.Klink).status, 'ja');
  const moves = await call('GET', `/api/admin/lager/${P.Klink}`);
  assert.deepEqual(moves.data.bevegelser.map((m) => [m.type, m.delta]), [['telling', -2], ['påfyll', 10]]);
});

test('kontant: ordren blir betalt med en gang, med MVA, og lageret trekkes', async () => {
  const r = await order([{ produkt: P['Vanlig eggbrett'], antall: 1 }, { produkt: P.Klink, antall: 2 }]);
  assert.equal(r.status, 201);
  assert.equal(r.data.status, 'betalt');
  assert.match(r.data.ref, /^gb-[0-9a-f]{32}$/);
  assert.equal(r.data.ordre.sum, 18000);
  assert.equal(r.data.ordre.mva, 2348);
  assert.deepEqual(r.data.ordre.linjer.map((l) => [l.navn, l.antall, l.pris]), [['Vanlig eggbrett', 1, 10000], ['Klink', 2, 4000]]);
  const s = await stock();
  assert.equal(s['Vanlig eggbrett'], 9);
  assert.equal(s.Klink, 6);
  const k = await receipt(r.data.ref);
  assert.equal(k.data.ordre.status, 'betalt');
  assert.equal(k.data.butikk.butikknavn, 'Klokkargarden gårdsbutikk');
});

test('validering: ukjent vare, feil betalingsmåte, tom kurv og ugyldig kvittering', async () => {
  assert.equal((await order([{ produkt: 999, antall: 1 }])).status, 409);
  assert.equal((await order([{ produkt: P.Klink, antall: 1 }], 'kort')).status, 400);
  assert.equal((await order([])).status, 400);
  assert.equal((await order([{ produkt: P.Klink, antall: 51 }])).status, 400);
  assert.equal((await receipt('gb-finnesikke')).status, 400);
  assert.equal((await receipt(`gb-${'0'.repeat(32)}`)).status, 404);
});

test('Vipps: opprett → godkjent i appen → beløpet trekkes, ordren blir betalt og lageret trekkes én gang', async () => {
  const before = await stock();
  const r = await order([{ produkt: P['XL eggbrett'], antall: 2 }], 'vipps');
  assert.equal(r.status, 201);
  assert.equal(r.data.status, 'venter');
  assert.equal(r.data.redirectUrl, `https://fake-vipps.example/landing/${r.data.ref}`);
  const p = payments.get(r.data.ref);
  assert.deepEqual(p.amount, { currency: 'NOK', value: 24000 });
  assert.equal(p.userFlow, 'WEB_REDIRECT');
  assert.match(p.returnUrl, new RegExp(`/kvittering\\?ref=${r.data.ref}$`));
  assert.match(p.paymentDescription, /Klokkargarden gårdsbutikk – ordre \d+/);

  // Kunden har ikke godkjent ennå: fortsatt venter, lageret urørt
  assert.equal((await receipt(r.data.ref)).data.ordre.status, 'venter');
  assert.equal((await stock())['XL eggbrett'], before['XL eggbrett']);

  approve(r.data.ref);
  await pause(2100); // sjekk mot Vipps maks hvert 2. sekund per ordre
  const k = await receipt(r.data.ref);
  assert.equal(k.data.ordre.status, 'betalt');
  assert.equal(p.captured, 24000);
  assert.equal((await stock())['XL eggbrett'], before['XL eggbrett'] - 2);

  // Gjentatt sjekk gir ikke dobbelt lagertrekk eller ny capture
  await pause(2100);
  await receipt(r.data.ref);
  await call('POST', `/api/admin/ordrer/${r.data.ref}/sjekk`, {});
  assert.equal((await stock())['XL eggbrett'], before['XL eggbrett'] - 2);
  assert.equal(calls.filter((c) => c.path.endsWith(`${r.data.ref}/capture`)).length, 1);
});

test('Vipps: avbrutt i appen → ordren blir avbrutt, lageret urørt', async () => {
  const before = await stock();
  const r = await order([{ produkt: P['Kartong 10 pk'], antall: 1 }], 'vipps');
  payments.get(r.data.ref).state = 'ABORTED';
  const k = await receipt(r.data.ref);
  assert.equal(k.data.ordre.status, 'avbrutt');
  assert.deepEqual(await stock(), before);
});

test('Vipps: kunden kommer ikke tilbake – cron fullfører betalingen', async () => {
  const r = await order([{ produkt: P['Kartong 10 pk'], antall: 3 }], 'vipps');
  approve(r.data.ref);
  await fetch(`${BASE}/cdn-cgi/handler/scheduled?cron=*/2+*+*+*+*`);
  let status;
  for (let i = 0; i < 40 && status !== 'betalt'; i++) {
    await pause(250);
    status = (await sql(`SELECT status FROM orders WHERE ref = '${r.data.ref}'`))[0].status;
  }
  assert.equal(status, 'betalt');
  assert.equal(payments.get(r.data.ref).captured, 12000);
});

test('Vipps: beløpsavvik hos Vipps gir ingen betaling', async () => {
  const r = await order([{ produkt: P.Klink, antall: 1 }], 'vipps');
  approve(r.data.ref);
  fake.wrongAmount = true;
  try {
    await call('POST', `/api/admin/ordrer/${r.data.ref}/sjekk`, {});
  } finally {
    fake.wrongAmount = false;
  }
  const row = (await sql(`SELECT status, vipps_state FROM orders WHERE ref = '${r.data.ref}'`))[0];
  assert.deepEqual([row.status, row.vipps_state], ['venter', 'BELØPSAVVIK']);
  assert.equal(payments.get(r.data.ref).captured, 0);
});

test('Vipps nede: kunden får beskjed, og ordren blir avbrutt', async () => {
  fake.failCreate = true;
  try {
    const r = await order([{ produkt: P.Klink, antall: 1 }], 'vipps');
    assert.equal(r.status, 502);
    assert.match(r.data.error, /betal kontant/);
  } finally {
    fake.failCreate = false;
  }
  const last = (await sql("SELECT status, vipps_state FROM orders ORDER BY id DESC LIMIT 1"))[0];
  assert.deepEqual([last.status, last.vipps_state], ['avbrutt', 'FEIL']);
});

// --- Admin ------------------------------------------------------------------

test('kassaoppgjør: forventet beløp er kontantsalg siden forrige telling', async () => {
  const k0 = await call('GET', '/api/admin/kasse');
  assert.equal(k0.data.forventet, 18000);
  const k1 = await call('POST', '/api/admin/kasse', { telt: '170', kommentar: 'manglet en tier' });
  assert.equal(k1.status, 201);
  assert.deepEqual([k1.data.tellinger[0].telt, k1.data.tellinger[0].forventet, k1.data.tellinger[0].differanse], [17000, 18000, -1000]);
  assert.equal(k1.data.forventet, 0);
  await order([{ produkt: P['Kartong 10 pk'], antall: 1 }]);
  assert.equal((await call('GET', '/api/admin/kasse')).data.forventet, 4000);
});

test('annullering: kontant og Vipps (med tilbakebetaling) – varene går tilbake på lager', async () => {
  const before = await stock();
  const c = await order([{ produkt: P.Klink, antall: 1 }]);
  assert.equal((await call('POST', `/api/admin/ordrer/${c.data.ref}/annuller`, {})).status, 400, 'grunn kreves');
  const a = await call('POST', `/api/admin/ordrer/${c.data.ref}/annuller`, { grunn: 'Feiltrykk' });
  assert.equal(a.data.ordre.status, 'annullert');
  assert.equal(a.data.ordre.annullertAv, 'ingar@gard.no');
  assert.equal((await stock()).Klink, before.Klink);

  const v = await order([{ produkt: P['Vanlig eggbrett'], antall: 1 }], 'vipps');
  approve(v.data.ref);
  await call('POST', `/api/admin/ordrer/${v.data.ref}/sjekk`, {});
  const av = await call('POST', `/api/admin/ordrer/${v.data.ref}/annuller`, { grunn: 'Kunden fikk ikke egg' });
  assert.equal(av.data.ordre.status, 'annullert');
  assert.equal(payments.get(v.data.ref).refunded, 10000);
  assert.equal((await stock())['Vanlig eggbrett'], before['Vanlig eggbrett']);

  // Gjentatt annullering er ufarlig; en ventende ordre kan ikke annulleres
  assert.equal((await call('POST', `/api/admin/ordrer/${v.data.ref}/annuller`, { grunn: 'x' })).status, 200);
  assert.equal(payments.get(v.data.ref).refunded, 10000);
  const w = await order([{ produkt: P.Klink, antall: 1 }], 'vipps');
  assert.equal((await call('POST', `/api/admin/ordrer/${w.data.ref}/annuller`, { grunn: 'x' })).status, 409);
});

test('varer: prisendring gjelder nye handler, gamle kvitteringer står fast; inaktive skjules', async () => {
  const old = await order([{ produkt: P['Kartong 10 pk'], antall: 1 }]);
  const r = await call('POST', '/api/admin/varer', { id: P['Kartong 10 pk'], navn: 'Kartong 10 pk', pris: '45,50', beskrivelse: '10 egg' });
  assert.equal(r.status, 200);
  assert.equal(r.data.vare.pris, 4550);
  const neu = await order([{ produkt: P['Kartong 10 pk'], antall: 2 }]);
  assert.equal(neu.data.ordre.sum, 9100);
  assert.equal((await receipt(old.data.ref)).data.ordre.sum, 4000);

  const added = await call('POST', '/api/admin/varer', { navn: 'Høsteegg', pris: 60, emoji: '🍂', aktiv: false });
  assert.equal(added.status, 200);
  assert.ok(!(await call('GET', '/api/butikk')).data.produkter.some((p) => p.navn === 'Høsteegg'));
  assert.equal((await order([{ produkt: added.data.vare.id, antall: 1 }])).status, 409);
  assert.equal((await call('POST', '/api/admin/varer', { navn: '', pris: 10 })).status, 400);
  assert.equal((await call('POST', '/api/admin/varer', { navn: 'X', pris: 0 })).status, 400);
  const log = await sql("SELECT action FROM audit_log WHERE entity = 'vare' ORDER BY id");
  assert.deepEqual(log.map((l) => l.action), ['endret', 'opprettet']);
});

test('oversikt: omsetning per betalingsmåte og vare, og Excel-grunnlag', async () => {
  const o = await call('GET', '/api/admin/oversikt');
  assert.equal(o.status, 200);
  const t = o.data.totalt;
  assert.equal(t.omsetning, t.vipps + t.kontant);
  assert.equal(t.vipps, 24000 + 12000); // annullert Vipps-ordre telles ikke
  assert.ok(t.antallKontant >= 4);
  const klink = o.data.produkter.find((p) => p.navn === 'Klink');
  assert.equal(klink.svinn, 2);
  assert.equal(klink.solgt, 2);
  assert.ok(o.data.venter >= 1);
  const list = await call('GET', '/api/admin/ordrer');
  assert.ok(list.data.ordrer.length >= 10);
  assert.ok(list.data.ordrer.every((x) => Array.isArray(x.linjer) && x.linjer.length));
  assert.equal((await call('GET', '/api/admin/oversikt?fra=2026-13-01')).status, 400);
});

test('innstillinger og Vipps-test', async () => {
  const r = await call('POST', '/api/admin/innstillinger', { orgnr: 'NO 999 888 777 MVA', melding: 'Påfyll hver dag kl. 16' });
  assert.deepEqual(r.data.endret.sort(), ['melding', 'orgnr']);
  assert.equal((await call('GET', '/api/butikk')).data.butikk.melding, 'Påfyll hver dag kl. 16');
  assert.equal((await call('POST', '/api/admin/innstillinger', { butikknavn: '' })).status, 400);
  assert.equal((await call('POST', '/api/admin/innstillinger', { butikk_url: 'http://usikker' })).status, 400);
  const s = await call('GET', '/api/admin/innstillinger');
  assert.deepEqual(s.data.vipps, { konfigurert: true, miljo: 'test', msn: '123456' });
  assert.equal((await call('POST', '/api/admin/vipps/test', {})).data.ok, true);
});

// --- Vern ---------------------------------------------------------------------

test('ingenting kan slettes eller skrives om, og ulovlige statusendringer stoppes', async () => {
  await assert.rejects(() => sql('DELETE FROM orders'), /SLETTING_IKKE_TILLATT/);
  await assert.rejects(() => sql('DELETE FROM products'), /SLETTING_IKKE_TILLATT/);
  await assert.rejects(() => sql('DELETE FROM stock_moves'), /SLETTING_IKKE_TILLATT/);
  await assert.rejects(() => sql('UPDATE stock_moves SET delta = 100'), /KAN_IKKE_ENDRES/);
  await assert.rejects(() => sql('UPDATE order_lines SET antall = 1'), /KAN_IKKE_ENDRES/);
  await assert.rejects(() => sql('UPDATE orders SET sum_ore = 1'), /ORDRE_LAAST/);
  await assert.rejects(() => sql("UPDATE orders SET status = 'betalt' WHERE status = 'avbrutt'"), /ULOVLIG_STATUSENDRING/);
  await assert.rejects(() => sql('DELETE FROM cash_counts'), /SLETTING_IKKE_TILLATT/);
});

test('vern: skriving fra annet opphav og uten JSON avvises', async () => {
  const cross = await call('POST', '/api/butikk/ordrer', { metode: 'kontant', linjer: [{ produkt: P.Klink, antall: 1 }] },
    { Origin: 'https://ond.example' });
  assert.equal(cross.status, 403);
  const res = await fetch(`${BASE}/api/butikk/ordrer`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(res.status, 415);
});

test('sidene serveres: butikk, kvittering og admin', async () => {
  const shop = await fetch(`${BASE}/`);
  assert.match(await shop.text(), /Betal med <b>Vipps<\/b>/);
  const k = await fetch(`${BASE}/kvittering?ref=gb-x`);
  assert.equal(k.status, 200);
  assert.match(await k.text(), /Betal med <b>Vipps<\/b>/);
  const admin = await fetch(`${BASE}/admin/`);
  assert.equal(admin.status, 200);
  assert.match(await admin.text(), /Gårdsbutikk – admin/);
});
