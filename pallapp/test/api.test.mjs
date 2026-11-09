// Integrasjonstester mot en lokal Worker med egen, tom D1-database.
// Kjør: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8790 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const persist = mkdtempSync(join(tmpdir(), 'pall-test-'));
const wrangler = join(root, 'node_modules', '.bin', 'wrangler');
let proc;

function today() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' }).format(new Date());
}
function daysAgo(n) {
  const d = new Date(`${today()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

async function call(method, path, body, user = 'anne@gard.no') {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'X-Dev-User': user, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

function sql(command) {
  try {
    return execFileSync(wrangler, ['d1', 'execute', 'DB', '--local', '--persist-to', persist, '--json', '--command', command], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    throw new Error(`${e.stdout}${e.stderr}`);
  }
}

// `wrangler d1 execute` mot samme lokale database kan få dev-serveren til å laste
// databasen på nytt; vent til den svarer igjen før neste API-kall.
async function waitReady() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/api/me`, { headers: { 'X-Dev-User': 'x@y.no' } });
      if (r.ok) return;
    } catch { /* venter */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Worker svarer ikke');
}

before(async () => {
  execFileSync(wrangler, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist], { cwd: root, stdio: 'ignore' });
  proc = spawn(wrangler, ['dev', '--local', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', persist,
    '--var', 'DEV_USER:test@gard.no', '--show-interactive-dev-session=false'], { cwd: root, stdio: 'ignore' });
  await waitReady();
});

after(() => {
  proc?.kill();
  rmSync(persist, { recursive: true, force: true });
});

const newPallet = (no, extra = {}, user) =>
  call('POST', '/api/pallets', { pallet_no: no, lay_from: daysAgo(1), trays: 60, ...extra }, user);

test('ny pall lagres med pakkedato og bruker, og til-dato = fra-dato som standard', async () => {
  const r = await newPallet('100');
  assert.equal(r.status, 201);
  const p = r.data.pallet;
  assert.equal(p.pallet_no, '100');
  assert.equal(p.lay_to, p.lay_from);
  assert.equal(p.packed_date, today());
  assert.equal(p.created_by, 'anne@gard.no');
  assert.equal(p.status, 'lager');
  assert.equal(p.eggs, 1800);
});

test('validering: brett må være positivt heltall, fra ≤ til, ikke fremtid', async () => {
  for (const trays of [0, -3, 1.5, 'abc', null]) {
    const r = await newPallet(`V${String(trays)}`.replace(/[^A-Z0-9]/gi, 'X'), { trays });
    assert.equal(r.status, 400, `brett=${trays}`);
  }
  let r = await newPallet('V2', { lay_from: daysAgo(1), lay_to: daysAgo(3) });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /senere/);
  r = await newPallet('V3', { lay_from: daysAgo(-2) });
  assert.equal(r.status, 400);
  r = await newPallet('   ');
  assert.equal(r.status, 400);
  // Ingenting av dette ble lagret
  const s = await call('GET', '/api/pallets?no=V');
  assert.equal(s.data.pallets.length, 0);
});

test('pallnummer er unikt, også med ledende nuller og mellomrom', async () => {
  assert.equal((await newPallet('200')).status, 201);
  const dup = await newPallet('200');
  assert.equal(dup.status, 409);
  assert.match(dup.data.error, /allerede registrert/);
  assert.equal((await newPallet('0200')).status, 409);
  assert.equal((await newPallet(' 2 00 ')).status, 409);
});

test('samtidig lagring av samme pallnummer: nøyaktig én lykkes', async () => {
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) => newPallet('300', {}, `bruker${i}@gard.no`)),
  );
  const ok = results.filter((r) => r.status === 201);
  const conflict = results.filter((r) => r.status === 409);
  assert.equal(ok.length, 1);
  assert.equal(conflict.length, 19);
  const s = await call('GET', '/api/pallets?no=300');
  assert.equal(s.data.pallets.filter((p) => p.pallet_no === '300').length, 1);
});

let storeA, storeB;
test('butikker: opprett med valgfri kontaktinfo, navn er unikt', async () => {
  let r = await call('POST', '/api/stores', { name: 'Rema 1000 Hareid', phone: '70 00 00 00' });
  assert.equal(r.status, 201);
  storeA = r.data.store;
  r = await call('POST', '/api/stores', { name: 'Joker Brandal' });
  assert.equal(r.status, 201);
  storeB = r.data.store;
  r = await call('POST', '/api/stores', { name: 'rema 1000 hareid' });
  assert.equal(r.status, 409);
  r = await call('POST', '/api/stores', { name: 'X', email: 'ikke-epost' });
  assert.equal(r.status, 400);
});

const idOf = async (no) => (await call('GET', `/api/pallets?no=${no}`)).data.pallets.find((p) => p.pallet_no === no).id;

test('levering knytter alle valgte paller til samme butikk og ordre', async () => {
  await newPallet('401');
  await newPallet('402', { trays: 55 });
  const ids = [await idOf('401'), await idOf('402')];
  const r = await call('POST', '/api/deliveries', {
    pallet_ids: ids, store_id: storeA.id, order_ref: 'F-1001', delivery_date: today(),
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.pallets.length, 2);
  const s = await call('GET', '/api/pallets?order=F-1001');
  assert.equal(s.data.pallets.length, 2);
  for (const p of s.data.pallets) {
    assert.equal(p.status, 'levert');
    assert.equal(p.store_name, 'Rema 1000 Hareid');
  }
  // Leverte paller vises ikke lenger som på lager
  const stock = await call('GET', '/api/pallets?status=lager');
  assert.ok(!stock.data.pallets.some((p) => ['401', '402'].includes(p.pallet_no)));
});

test('en levert pall kan ikke leveres på nytt, og feil lagrer ingenting', async () => {
  await newPallet('403');
  const ids = [await idOf('401'), await idOf('403')];
  const r = await call('POST', '/api/deliveries', {
    pallet_ids: ids, store_id: storeB.id, order_ref: 'F-2002', delivery_date: today(),
  });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /401/);
  // 403 er fortsatt på lager, 401 er fortsatt hos Rema
  const p403 = (await call('GET', '/api/pallets?no=403')).data.pallets[0];
  assert.equal(p403.status, 'lager');
  const p401 = (await call('GET', '/api/pallets?no=401')).data.pallets[0];
  assert.equal(p401.order_ref, 'F-1001');
  assert.equal((await call('GET', '/api/pallets?order=F-2002')).data.pallets.length, 0);
});

test('samtidige leveringer av samme pall: nøyaktig én lykkes', async () => {
  await newPallet('500');
  const id = await idOf('500');
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      call('POST', '/api/deliveries', {
        pallet_ids: [id], store_id: i % 2 ? storeA.id : storeB.id, order_ref: `SAMTIDIG-${i}`, delivery_date: today(),
      }, `bruker${i}@gard.no`)),
  );
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal(results.filter((r) => r.status === 409).length, 9);
  // Bare én levering har fått pallen, og ingen tomme leveringer henger igjen
  const rows = JSON.parse(sql("SELECT count(*) AS n FROM deliveries WHERE order_ref LIKE 'SAMTIDIG-%'"))[0].results[0].n;
  assert.equal(rows, 1);
});

test('databasen stopper dobbel levering selv ved direkte SQL', async () => {
  const id = await idOf('401');
  assert.throws(
    () => sql(`UPDATE pallets SET delivery_id = (SELECT id FROM deliveries WHERE order_ref LIKE 'SAMTIDIG-%') WHERE id = ${id}`),
    /ALLEREDE_LEVERT/,
  );
  await waitReady();
});

test('datosøk finner alle paller der verpeperioden overlapper søkeperioden', async () => {
  // Egen serie med kjente perioder
  const d = (n) => daysAgo(40 - n); // dag 1..20 i en fast periode
  await newPallet('D1', { lay_from: d(1), lay_to: d(5) });
  await newPallet('D2', { lay_from: d(6), lay_to: d(10) });
  await newPallet('D3', { lay_from: d(3), lay_to: d(3) });
  await newPallet('D4', { lay_from: d(1), lay_to: d(20) });
  const q = async (from, to) => {
    const p = new URLSearchParams({ no: 'D' });
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    const r = await call('GET', `/api/pallets?${p}`);
    assert.equal(r.status, 200);
    return r.data.pallets.map((x) => x.pallet_no).filter((n) => /^D\d$/.test(n)).sort();
  };
  assert.deepEqual(await q(d(5), d(6)), ['D1', 'D2', 'D4']); // treffer slutten av D1 og starten av D2
  assert.deepEqual(await q(d(3), null), ['D1', 'D3', 'D4']); // én dato = én dag
  assert.deepEqual(await q(null, d(3)), ['D1', 'D3', 'D4']);
  assert.deepEqual(await q(d(4), d(4)), ['D1', 'D4']);
  assert.deepEqual(await q(d(11), d(12)), ['D4']); // søk inni en lang periode
  assert.deepEqual(await q(d(0), d(21)), ['D1', 'D2', 'D3', 'D4']); // søk som omslutter alt
  assert.deepEqual(await q(d(21), d(25)), []);
  assert.equal((await call('GET', `/api/pallets?from=${d(5)}&to=${d(1)}`)).status, 400);
});

test('søk på butikk og ordrenummer', async () => {
  const byStore = await call('GET', `/api/pallets?store=${storeA.id}`);
  assert.ok(byStore.data.pallets.every((p) => p.store_id === storeA.id));
  assert.ok(byStore.data.pallets.some((p) => p.pallet_no === '401'));
  const byOrder = await call('GET', '/api/pallets?order=1001');
  assert.deepEqual(byOrder.data.pallets.map((p) => p.pallet_no).sort(), ['401', '402']);
});

test('rettelser krever årsak og bevarer tidligere verdier i historikken', async () => {
  await newPallet('600', { trays: 60 });
  const id = await idOf('600');
  let r = await call('PUT', `/api/pallets/${id}`, { lay_from: daysAgo(2), lay_to: daysAgo(1), trays: 58 });
  assert.equal(r.status, 400); // mangler årsak
  r = await call('PUT', `/api/pallets/${id}`, { lay_from: daysAgo(2), lay_to: daysAgo(1), trays: 58, reason: 'Telte feil' }, 'per@gard.no');
  assert.equal(r.status, 200);
  assert.equal(r.data.pallet.trays, 58);
  assert.equal(r.data.pallet.pallet_no, '600');

  const detail = await call('GET', `/api/pallets/${id}`);
  const log = detail.data.history;
  assert.equal(log[0].action, 'opprettet');
  assert.equal(log[0].user, 'anne@gard.no');
  const fix = log.find((a) => a.action === 'rettet');
  assert.equal(fix.user, 'per@gard.no');
  assert.equal(fix.reason, 'Telte feil');
  assert.equal(JSON.parse(fix.old_values).trays, 60);
  assert.equal(JSON.parse(fix.new_values).trays, 58);

  // Verpedato kan ikke rettes til etter pakkedato
  r = await call('PUT', `/api/pallets/${id}`, { lay_from: daysAgo(-1), trays: 58, reason: 'x' });
  assert.equal(r.status, 400);
});

test('pall som fjernes fra feil levering beholder leveringshistorikken og kan leveres riktig', async () => {
  const id = await idOf('402');
  let r = await call('POST', `/api/pallets/${id}/undeliver`, { reason: 'Feil pall valgt' });
  assert.equal(r.status, 200);
  assert.equal(r.data.pallet.status, 'lager');
  r = await call('POST', '/api/deliveries', { pallet_ids: [id], store_id: storeB.id, order_ref: 'F-3003', delivery_date: today() });
  assert.equal(r.status, 201);
  const detail = (await call('GET', `/api/pallets/${id}`)).data;
  const deliveryChanges = detail.history.filter((a) => a.entity === 'pall' && a.old_values &&
    JSON.parse(a.old_values).delivery_id !== JSON.parse(a.new_values).delivery_id);
  assert.equal(deliveryChanges.length, 3); // levert → fjernet → levert på nytt
  const refs = detail.deliveries.map((d) => d.order_ref).sort();
  assert.deepEqual(refs, ['F-1001', 'F-3003']);
});

test('rett levering (ordrenummer) logges med gammel og ny verdi', async () => {
  const p = (await call('GET', '/api/pallets?order=F-3003')).data.pallets[0];
  const r = await call('PUT', `/api/deliveries/${p.delivery_id}`, { store_id: storeB.id, order_ref: 'F-3004', delivery_date: today(), reason: 'Skrivefeil' });
  assert.equal(r.status, 200);
  const detail = (await call('GET', `/api/pallets/${p.id}`)).data;
  const e = detail.history.find((a) => a.entity === 'levering' && a.action === 'rettet');
  assert.equal(JSON.parse(e.old_values).order_ref, 'F-3003');
  assert.equal(JSON.parse(e.new_values).order_ref, 'F-3004');
});

test('annullering: pall slettes ikke, nummer forblir reservert, levert pall kan ikke annulleres', async () => {
  await newPallet('700');
  const id = await idOf('700');
  let r = await call('POST', `/api/pallets/${id}/void`, { reason: 'Feil nummer, skulle vært 701' });
  assert.equal(r.status, 200);
  assert.equal(r.data.pallet.status, 'annullert');
  assert.equal((await newPallet('700')).status, 409);
  r = await call('POST', '/api/deliveries', { pallet_ids: [id], store_id: storeA.id, order_ref: 'X', delivery_date: today() });
  assert.equal(r.status, 409);
  const delivered = await idOf('401');
  r = await call('POST', `/api/pallets/${delivered}/void`, { reason: 'test' });
  assert.equal(r.status, 409);
});

test('sletting er blokkert i databasen', async () => {
  assert.throws(() => sql('DELETE FROM pallets'), /SLETTING_IKKE_TILLATT/);
  assert.throws(() => sql('DELETE FROM audit_log'), /SLETTING_IKKE_TILLATT/);
  assert.throws(() => sql("UPDATE audit_log SET user = 'x'"), /LOGG_KAN_IKKE_ENDRES/);
  assert.throws(() => sql("UPDATE pallets SET pallet_no = 'NY' WHERE pallet_no = '100'"), /PALLNUMMER_LAAST/);
  await waitReady();
});

test('tilbakekalling: merk berørte, sperr lager, se butikker, varsle, CSV', async () => {
  await newPallet('800', { lay_from: daysAgo(30), lay_to: daysAgo(29) });
  await newPallet('801', { lay_from: daysAgo(29) });
  await newPallet('802', { lay_from: daysAgo(29), trays: 40 });
  await newPallet('803', { lay_from: daysAgo(28) });
  const [i800, i801, i802, i803] = [await idOf('800'), await idOf('801'), await idOf('802'), await idOf('803')];
  await call('POST', '/api/deliveries', { pallet_ids: [i800, i801], store_id: storeA.id, order_ref: 'R-1', delivery_date: daysAgo(27) });
  await call('POST', '/api/deliveries', { pallet_ids: [i802], store_id: storeB.id, order_ref: 'R-2', delivery_date: daysAgo(26) });

  // Søk på verpedato og merk treffene som berørt
  // (D4 fra datotesten har en lang periode som også overlapper – den skal med i treffet)
  const all = (await call('GET', `/api/pallets?from=${daysAgo(29)}&to=${daysAgo(29)}`)).data.pallets;
  assert.ok(all.some((p) => p.pallet_no === 'D4'));
  const hits = all.filter((p) => p.pallet_no.startsWith('8'));
  const hitNos = hits.map((p) => p.pallet_no).sort();
  assert.deepEqual(hitNos, ['800', '801', '802']);
  let r = await call('POST', '/api/recalls', { pallet_ids: [...hits.map((p) => p.id), i803], title: 'Test salmonella' });
  assert.equal(r.status, 201);
  const rid = r.data.recall_id;

  let o = (await call('GET', `/api/recalls/${rid}`)).data;
  assert.equal(o.summary.pallets, 4);
  assert.equal(o.summary.delivered, 3);
  assert.equal(o.summary.in_stock_unblocked, 1);
  const a = o.stores.find((s) => s.name === 'Rema 1000 Hareid');
  assert.equal(a.pallets, 2);
  assert.equal(a.trays, 120);
  assert.equal(a.deliveries[0].order_ref, 'R-1');
  assert.equal(a.deliveries[0].delivery_date, daysAgo(27));
  const b = o.stores.find((s) => s.name === 'Joker Brandal');
  assert.equal(b.trays, 40);

  // Sperr: bare pallen på lager blir sperret; leveringsstatus på leverte endres ikke
  r = await call('POST', `/api/recalls/${rid}/block`, {});
  assert.equal(r.data.blocked, 1);
  o = (await call('GET', `/api/recalls/${rid}`)).data;
  const p803 = o.pallets.find((p) => p.pallet_no === '803');
  assert.equal(p803.blocked, true);
  assert.equal(p803.status, 'lager');
  assert.ok(o.pallets.filter((p) => p.pallet_no !== '803').every((p) => p.status === 'levert' && !p.blocked));

  // Sperret pall kan ikke leveres
  r = await call('POST', '/api/deliveries', { pallet_ids: [i803], store_id: storeA.id, order_ref: 'R-3', delivery_date: today() });
  assert.equal(r.status, 409);

  // Butikk varslet (og rettet) – begge deler logges
  r = await call('POST', `/api/recalls/${rid}/notices`, { store_id: storeA.id, notified_date: today(), note: 'Ringte butikksjef' });
  assert.equal(r.status, 201);
  r = await call('POST', `/api/recalls/${rid}/notices`, { store_id: storeA.id, notified_date: today(), note: 'Ringte butikksjef, varer fjernet' }, 'per@gard.no');
  assert.equal(r.status, 201);
  assert.equal(r.data.notice.updated_by, 'per@gard.no');
  const log = JSON.parse(sql(`SELECT action, old_values FROM audit_log WHERE entity = 'varsel' ORDER BY id`))[0].results;
  assert.equal(log.length, 2);
  assert.match(log[1].old_values, /Ringte butikksjef"/);

  // Legg til i eksisterende tilbakekalling (ingen duplikater)
  r = await call('POST', '/api/recalls', { pallet_ids: [i800], recall_id: rid });
  assert.equal(r.status, 201);
  assert.equal((await call('GET', `/api/recalls/${rid}`)).data.summary.pallets, 4);

  // CSV
  const res = await fetch(`${BASE}/api/recalls/${rid}/csv`, { headers: { 'X-Dev-User': 'anne@gard.no' } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]); // BOM, så Excel leser æøå riktig
  const csv = new TextDecoder().decode(bytes);
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 5);
  assert.match(csv, /800;.*Levert;Nei;Rema 1000 Hareid;.*R-1;Ja;.*varer fjernet/);
  assert.match(csv, /803;.*På lager;Ja;/);

  // Opphev sperre krever årsak og logges
  assert.equal((await call('POST', `/api/pallets/${i803}/unblock`, {})).status, 400);
  r = await call('POST', `/api/pallets/${i803}/unblock`, { reason: 'Analyse negativ' });
  assert.equal(r.status, 200);
  assert.equal(r.data.pallet.blocked, false);
});

test('eksport til Excel (CSV) av alle paller og av søketreff', async () => {
  const res = await fetch(`${BASE}/api/pallets.csv`, { headers: { 'X-Dev-User': 'anne@gard.no' } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(res.headers.get('content-disposition'), /paller-\d{4}-\d{2}-\d{2}\.csv/);
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const csv = new TextDecoder().decode(bytes);
  const all = (await call('GET', '/api/pallets?limit=1000')).data.pallets;
  assert.equal(csv.trim().split('\r\n').length, all.length + 1);
  assert.match(csv, /\n401;.*Levert;Nei;;Rema 1000 Hareid;F-1001;/);
  assert.match(csv, /\n803;.*På lager;Nei;Test salmonella;/);
  // «Sist endret» i norsk tid (dd.mm.åååå tt:mm), ikke UTC
  const p803 = all.find((p) => p.pallet_no === '803');
  const t = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(p803.updated_at));
  const expected = `${t.slice(8, 10)}.${t.slice(5, 7)}.${t.slice(0, 4)} ${t.slice(11, 16)}`;
  assert.ok(csv.split('\r\n').find((l) => l.startsWith('803;')).includes(`;${expected};`));

  const filtered = await (await fetch(`${BASE}/api/pallets.csv?order=F-1001`, { headers: { 'X-Dev-User': 'a@b.no' } })).text();
  assert.equal(filtered.trim().split('\r\n').length, 2); // overskrift + pall 401 (402 er flyttet til annen ordre)
});

test('neste pallnummer: høyeste tallnummer + 1, hopper over reserverte numre', async () => {
  // Egen tallserie høyt over de andre testene
  await newPallet('90010');
  await newPallet('90012'); // registrert i «feil» rekkefølge
  await newPallet('90011');
  let r = await call('GET', '/api/next-pallet-no');
  assert.equal(r.status, 200);
  assert.equal(r.data.next, '90013');
  // Annullert pall teller ikke som høyeste, men nummeret er reservert og hoppes over
  await newPallet('90013');
  await call('POST', `/api/pallets/${await idOf('90013')}/void`, { reason: 'Feil nummer' });
  r = await call('GET', '/api/next-pallet-no');
  assert.equal(r.data.next, '90014');
  // Forslaget kan faktisk registreres
  assert.equal((await newPallet(r.data.next)).status, 201);
  assert.equal((await call('GET', '/api/next-pallet-no')).data.next, '90015');
});

test('leveringsrute: flere butikker lagres samlet med felles dato', async () => {
  for (const no of ['91001', '91002', '91003', '91004']) await newPallet(no);
  const [a, b, c, d] = [await idOf('91001'), await idOf('91002'), await idOf('91003'), await idOf('91004')];
  const date = daysAgo(-1); // i morgen
  const r = await call('POST', '/api/deliveries/batch', {
    delivery_date: date,
    deliveries: [
      { store_id: storeA.id, order_ref: 'RUTE-1', pallet_ids: [a, b] },
      { store_id: storeB.id, order_ref: 'RUTE-2', pallet_ids: [c] },
    ],
  }, 'per@gard.no');
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.deliveries.length, 2);
  assert.deepEqual(r.data.deliveries[0].pallets.map((p) => p.pallet_no), ['91001', '91002']);
  assert.equal(r.data.deliveries[1].delivery.store_name, 'Joker Brandal');
  const p3 = (await call('GET', '/api/pallets?no=91003')).data.pallets[0];
  assert.equal(p3.status, 'levert');
  assert.equal(p3.order_ref, 'RUTE-2');
  assert.equal(p3.delivery_date, date);
  // Hver levering er logget med bruker
  const hist = (await call('GET', `/api/pallets/${c}`)).data.history;
  assert.ok(hist.some((h) => h.action === 'levert' && h.user === 'per@gard.no'));
  // 91004 var ikke med og står fortsatt på lager
  assert.equal((await call('GET', '/api/pallets?no=91004')).data.pallets[0].status, 'lager');
  assert.ok(d);
});

test('leveringsrute: én feil stopper hele ruten (alt eller ingenting)', async () => {
  for (const no of ['92001', '92002']) await newPallet(no);
  const [a, b] = [await idOf('92001'), await idOf('92002')];
  const levert = await idOf('91001');
  const batch = (deliveries) => call('POST', '/api/deliveries/batch', { delivery_date: today(), deliveries });

  // Én linje inneholder en pall som allerede er levert
  let r = await batch([
    { store_id: storeA.id, order_ref: 'FEIL-1', pallet_ids: [a] },
    { store_id: storeB.id, order_ref: 'FEIL-2', pallet_ids: [b, levert] },
  ]);
  assert.equal(r.status, 409);
  assert.match(r.data.error, /91001/);
  // Samme pall i to linjer
  r = await batch([
    { store_id: storeA.id, order_ref: 'FEIL-3', pallet_ids: [a] },
    { store_id: storeB.id, order_ref: 'FEIL-4', pallet_ids: [a, b] },
  ]);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /flere leveringer/);
  // Manglende ordrenummer, ukjent butikk, tom rute
  assert.equal((await batch([{ store_id: storeA.id, order_ref: ' ', pallet_ids: [a] }])).status, 400);
  assert.equal((await batch([{ store_id: 999999, order_ref: 'X', pallet_ids: [a] }])).status, 400);
  assert.equal((await batch([])).status, 400);

  // Ingenting ble lagret
  for (const no of ['92001', '92002']) {
    assert.equal((await call('GET', `/api/pallets?no=${no}`)).data.pallets[0].status, 'lager');
  }
  const n = JSON.parse(sql("SELECT count(*) AS n FROM deliveries WHERE order_ref LIKE 'FEIL-%'"))[0].results[0].n;
  await waitReady();
  assert.equal(n, 0);
});

test('samtidige ruter med samme pall: nøyaktig én lykkes', async () => {
  for (const no of ['93001', '93002', '93003']) await newPallet(no);
  const [a, b, c] = [await idOf('93001'), await idOf('93002'), await idOf('93003')];
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) =>
    call('POST', '/api/deliveries/batch', {
      delivery_date: today(),
      deliveries: [
        { store_id: storeA.id, order_ref: `KAPP-${i}-A`, pallet_ids: [i % 2 ? a : b] },
        { store_id: storeB.id, order_ref: `KAPP-${i}-B`, pallet_ids: [c] },
      ],
    }, `bruker${i}@gard.no`)));
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal(results.filter((r) => r.status === 409).length, 5);
  const n = JSON.parse(sql("SELECT count(*) AS n FROM deliveries WHERE order_ref LIKE 'KAPP-%'"))[0].results[0].n;
  await waitReady();
  assert.equal(n, 2); // bare vinnerens to leveringer finnes
});

test('en levering med over 100 paller lagres (deles opp mot databasens parametergrense)', async () => {
  const nos = Array.from({ length: 120 }, (_, i) => String(94000 + i));
  for (const no of nos) assert.equal((await newPallet(no, { trays: 1 })).status, 201);
  const all = (await call('GET', '/api/pallets?no=94&limit=1000')).data.pallets.filter((p) => nos.includes(p.pallet_no));
  assert.equal(all.length, 120);
  const r = await call('POST', '/api/deliveries', {
    pallet_ids: all.map((p) => p.id), store_id: storeA.id, order_ref: 'STOR-1', delivery_date: today(),
  });
  assert.equal(r.status, 201, JSON.stringify(r.data).slice(0, 300));
  assert.equal(r.data.pallets.length, 120);
  // …og kan merkes som berørt samlet
  const rc = await call('POST', '/api/recalls', { pallet_ids: all.map((p) => p.id), title: 'Stor test' });
  assert.equal(rc.status, 201, JSON.stringify(rc.data).slice(0, 300));
  assert.equal((await call('GET', `/api/recalls/${rc.data.recall_id}`)).data.summary.pallets, 120);
});

test('søk på leveringsdato og status', async () => {
  const nos = async (q) => {
    const r = await call('GET', `/api/pallets?${q}&limit=1000`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data.pallets.map((p) => p.pallet_no);
  };
  // Leveringsdato: ruten over ble levert «i morgen»
  const tomorrow = daysAgo(-1);
  assert.deepEqual((await nos(`dfrom=${tomorrow}`)).sort(), ['91001', '91002', '91003']);
  assert.deepEqual((await nos(`dto=${tomorrow}`)).sort(), ['91001', '91002', '91003']);
  assert.deepEqual((await nos(`dfrom=${tomorrow}&dto=${tomorrow}&store=${storeB.id}`)), ['91003']);
  // Intervall som dekker 26–27 dager siden (fra tilbakekallingstesten)
  assert.deepEqual((await nos(`dfrom=${daysAgo(27)}&dto=${daysAgo(26)}`)).sort(), ['800', '801', '802']);
  assert.equal((await call('GET', `/api/pallets?dfrom=${today()}&dto=${daysAgo(3)}`)).status, 400);
  // Paller som ikke er levert, er aldri med i et søk på leveringsdato
  assert.ok(!(await nos(`dfrom=${daysAgo(400)}&dto=${daysAgo(-400)}`)).includes('91004'));

  // Status
  const lager = await nos('status=lager');
  assert.ok(lager.includes('91004') && lager.includes('92001'));
  assert.ok(!lager.includes('91001') && !lager.includes('700') && !lager.includes('90013'));
  const levert = await nos('status=levert');
  assert.ok(levert.includes('91001') && !levert.includes('91004'));
  const annullert = await nos('status=annullert');
  assert.ok(annullert.includes('700') && annullert.includes('90013') && !annullert.includes('91004'));

  // Sperret: vises under «på lager» og «sperret», men ikke som leverbar
  const rc = await call('POST', '/api/recalls', { pallet_ids: [await idOf('91004')], title: 'Sperretest' });
  await call('POST', `/api/recalls/${rc.data.recall_id}/block`, {});
  assert.ok((await nos('status=sperret')).includes('91004'));
  assert.ok((await nos('status=lager')).includes('91004'));
  assert.ok(!(await nos('status=leverbar')).includes('91004'));
  assert.equal((await call('GET', '/api/pallets?status=tull')).status, 400);

  // Eksporten følger de samme filtrene
  const csv = await (await fetch(`${BASE}/api/pallets.csv?dfrom=${tomorrow}&status=levert`, { headers: { 'X-Dev-User': 'a@b.no' } })).text();
  assert.equal(csv.trim().split('\r\n').length, 4);
});

test('skriveoperasjoner uten JSON avvises', async () => {
  const res = await fetch(`${BASE}/api/pallets`, { method: 'POST', headers: { 'X-Dev-User': 'a@b.no', 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(res.status, 415);
  const res2 = await fetch(`${BASE}/api/pallets`, {
    method: 'POST', headers: { 'X-Dev-User': 'a@b.no', 'Content-Type': 'application/json', Origin: 'https://ond.example' }, body: '{}',
  });
  assert.equal(res2.status, 403);
});
