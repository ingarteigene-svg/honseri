// Tester av lagringsflyten mot en simulert Excel (Microsoft Graph), inkludert
// samtidige brukere, nettverksfeil, låst fil og endringer direkte i arket.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockGraph } from './mock-graph.mjs';
import { Workbook, DataStore, AuthExpiredError } from '../public/excel.js';
import { cmd, osloToday, HEADERS, search, T, UserError } from '../public/core.js';

const today = osloToday();
const yesterday = (() => {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
})();

async function setup({ latency = 0 } = {}) {
  const g = createMockGraph({ latency });
  const client = async (user) => {
    const wb = new Workbook({
      graphBase: 'https://graph.test/v1.0', fileUrl: 'https://gard.sharepoint.com/:x:/r/Pall.xlsx',
      getToken: async () => 'token', fetchImpl: g.fetch,
    });
    await wb.ensureTable();
    const ds = new DataStore(wb, { user });
    await ds.load();
    return ds;
  };
  return { g, client };
}

const register = (ds, no, trays = 228) =>
  ds.commit(cmd.registerPallet(ds.state, { pallet_no: no, lay_from: yesterday, trays }, ds.ctx()));

test('oppretter tabellen «Hendelser» med overskrifter første gang', async () => {
  const { g, client } = await setup();
  await client('anne@gard.no');
  assert.equal(g.table.name, 'Hendelser');
  assert.deepEqual(g.sheets.get('Hendelser')[0], HEADERS);
  // Andre klient oppretter ikke på nytt
  await client('per@gard.no');
  assert.equal(g.calls.filter((c) => c.endsWith('/tables/add')).length, 1);
});

test('lagring skriver lesbare rader og bekreftes mot Excel', async () => {
  const { g, client } = await setup();
  const ds = await client('anne@gard.no');
  await register(ds, '0101', 200);
  const row = g.rows().find((r) => r[3] === 'PALL REGISTRERT');
  assert.equal(row[4], '101'); // tekst, ikke tall
  assert.equal(row[5], yesterday); // tekst, ikke datoserienummer
  assert.equal(row[7], 200); // brett som tall
  assert.equal(row[2], 'anne@gard.no');
  assert.equal(ds.state.pallets.get('101').trays, 200);
});

test('tekst som starter med «=» lagres som tekst (ingen formel-injeksjon)', async () => {
  const { g, client } = await setup();
  const ds = await client('anne@gard.no');
  await ds.commit(cmd.createStore(ds.state, { name: '=HYPERLINK("x")' }, ds.ctx()));
  assert.ok(g.rows().some((r) => r[10] === '=HYPERLINK("x")'));
  assert.equal(ds.tampered.length, 0);
});

test('20 samtidige registreringer av samme pallnummer: nøyaktig én lykkes', async () => {
  const { g, client } = await setup({ latency: 30 });
  const users = await Promise.all(Array.from({ length: 20 }, (_, i) => client(`bruker${i}@gard.no`)));
  const results = await Promise.allSettled(users.map((ds) => register(ds, '300')));
  const ok = results.filter((r) => r.status === 'fulfilled');
  const failed = results.filter((r) => r.status === 'rejected');
  assert.equal(ok.length, 1);
  assert.equal(failed.length, 19);
  assert.ok(failed.every((r) => r.reason instanceof UserError && /allerede registrert/.test(r.reason.message)));
  const check = await client('kontroll@gard.no');
  assert.equal(search(check.state, { no: '300' }).length, 1);
  // Avvisningene er synlige i loggen
  assert.equal(g.rows().filter((r) => r[3] === 'AVVIST').length, 19);
});

test('10 samtidige leveringer av samme pall: nøyaktig én lykkes', async () => {
  const { client } = await setup({ latency: 30 });
  const admin = await client('anne@gard.no');
  await admin.commit(cmd.createStore(admin.state, { name: 'Rema' }, admin.ctx()));
  await admin.commit(cmd.createStore(admin.state, { name: 'Joker' }, admin.ctx()));
  await register(admin, '500');
  const [rema, joker] = [...admin.state.stores.keys()];
  const users = await Promise.all(Array.from({ length: 10 }, (_, i) => client(`bruker${i}@gard.no`)));
  const results = await Promise.allSettled(users.map((ds, i) => ds.commit(cmd.deliver(ds.state, {
    pallets: ['500'], store_id: i % 2 ? rema : joker, order: `SAMTIDIG-${i}`, date: today,
  }, ds.ctx()))));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const check = await client('kontroll@gard.no');
  const p = search(check.state, { no: '500' })[0];
  assert.equal(p.status, 'levert');
  assert.equal(check.state.deliveries.size, 1);
});

test('tidsavbrudd etter at raden er skrevet: ingen dobbeltføring', async () => {
  const { g, client } = await setup();
  const ds = await client('anne@gard.no');
  g.failures.push({ match: 'append', status: 504, commit: true });
  await register(ds, '600');
  assert.equal(g.rows().filter((r) => r[4] === '600').length, 1);
  assert.equal(ds.state.pallets.get('600').trays, 228);
});

test('tidsavbrudd før raden er skrevet: prøver igjen og lagrer én gang', async () => {
  const { g, client } = await setup();
  const ds = await client('anne@gard.no');
  g.failures.push({ match: 'append', status: 504 });
  await register(ds, '601');
  assert.equal(g.rows().filter((r) => r[4] === '601').length, 1);
});

test('låst fil gir tydelig feil og ingenting lagres', async () => {
  const { g, client } = await setup();
  const ds = await client('anne@gard.no');
  g.locked = true;
  await assert.rejects(register(ds, '700'), /låst/);
  g.locked = false;
  await ds.load();
  assert.equal(ds.state.pallets.has('700'), false);
});

test('manglende tilgang og utløpt innlogging gir forståelige feil', async () => {
  const { g, client } = await setup();
  const ds = await client('anne@gard.no');
  g.failures.push({ match: 'append', status: 403 });
  await assert.rejects(register(ds, '710'), /ikke tilgang/);
  g.failures.push({ match: 'read', status: 401 });
  await assert.rejects(ds.load(), AuthExpiredError);
});

test('rader endret direkte i Excel oppdages', async () => {
  const { g, client } = await setup();
  const ds = await client('anne@gard.no');
  await register(ds, '800', 228);
  const rowNo = g.table.headerRow + g.rows().findIndex((r) => r[4] === '800') + 1;
  g.editCell(rowNo, 8, 200); // noen endrer antall brett i arket
  await ds.load();
  assert.equal(ds.tampered.length, 1);
  assert.equal(ds.tampered[0].row, rowNo);
});

test('sortering av arket oppdages', async () => {
  const { g, client } = await setup();
  const ds = await client('anne@gard.no');
  await register(ds, '901');
  await register(ds, '902');
  const rows = g.sheets.get('Hendelser');
  const [a, b] = [rows.findIndex((r) => r[4] === '901'), rows.findIndex((r) => r[4] === '902')];
  rows[a][1] = '2026-01-01 12:00:00'; // simuler at rader har byttet plass i tid
  rows[b][1] = '2026-01-01 08:00:00';
  await ds.load();
  assert.ok(ds.outOfOrder > 0);
});

test('store tabeller leses i biter', async () => {
  const { g, client } = await setup();
  const ds = await client('anne@gard.no');
  const events = [];
  for (let i = 0; i < 4500; i++) {
    events.push(...cmd.registerPallet(null, { pallet_no: `P${i}`, lay_from: yesterday, trays: 200 }, ds.ctx()));
  }
  await ds.commit(events);
  assert.equal(ds.state.pallets.size, 4500);
  assert.ok(g.calls.filter((c) => c.includes('/range(address=')).length >= 2);
});

test('hendelsestyper i Excel er lesbare', () => {
  assert.equal(T.REGISTERED, 'PALL REGISTRERT');
  assert.equal(T.DELIVERED, 'LEVERT');
});
