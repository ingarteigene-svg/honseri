// Tester av forretningsreglene (avspilling av loggen), uten nettverk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  replay, cmd, search, recallOverview, recallCsv, palletHistory, normalizePalletNo, rowToEvent,
  eventToValues, osloToday, T, UserError,
} from '../public/core.js';

const today = osloToday();
const daysAgo = (n) => {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
const anne = { user: 'anne@gard.no' };
const per = { user: 'per@gard.no' };

/** Liten logg som bygges opp kommando for kommando (som Excel-tabellen). */
function book() {
  const events = [];
  const b = {
    events,
    state: replay([]),
    add(evs) {
      events.push(...evs.map((e, i) => ({ ...e, row: events.length + i + 2 })));
      b.state = replay(events);
      return evs.map((e) => b.state.results.get(e.id));
    },
  };
  return b;
}
const reg = (b, no, extra = {}, ctx = anne) =>
  b.add(cmd.registerPallet(b.state, { pallet_no: no, lay_from: daysAgo(1), trays: 228, ...extra }, ctx))[0];
const store = (b, name) => {
  const [e] = cmd.createStore(b.state, { name }, anne);
  b.add([e]);
  return e.store_id;
};

test('normalisering av pallnummer', () => {
  assert.equal(normalizePalletNo(' 0 07 '), '7');
  assert.equal(normalizePalletNo('a-12'), 'A-12');
  assert.equal(normalizePalletNo('000'), '0');
});

test('ny pall: til = fra som standard, pakkedato og bruker settes', () => {
  const b = book();
  assert.equal(reg(b, '100').ok, true);
  const p = b.state.pallets.get('100');
  assert.equal(p.lay_to, p.lay_from);
  assert.equal(p.packed, today);
  assert.equal(p.created_by, 'anne@gard.no');
  assert.equal(p.trays, 228);
});

test('validering: brett positivt heltall, fra ≤ til, ikke etter pakkedato', () => {
  const b = book();
  for (const trays of [0, -1, 1.5, 'abc', null, 99999]) {
    assert.throws(() => cmd.registerPallet(b.state, { pallet_no: '1', lay_from: daysAgo(1), trays }, anne), UserError);
  }
  assert.throws(() => cmd.registerPallet(b.state, { pallet_no: '1', lay_from: daysAgo(1), lay_to: daysAgo(3), trays: 200 }, anne), /senere enn verpedato til/);
  assert.throws(() => cmd.registerPallet(b.state, { pallet_no: '1', lay_from: daysAgo(-1), trays: 200 }, anne), /pakkedato/);
  assert.throws(() => cmd.registerPallet(b.state, { pallet_no: ' ', lay_from: daysAgo(1), trays: 200 }, anne), /pallnummer/);
});

test('samme pallnummer registrert samtidig av to brukere: første rad vinner', () => {
  const b = book();
  const s0 = b.state; // begge ser samme (gamle) tilstand
  const e1 = cmd.registerPallet(s0, { pallet_no: '300', lay_from: daysAgo(1), trays: 200 }, anne);
  const e2 = cmd.registerPallet(s0, { pallet_no: '0300', lay_from: daysAgo(2), trays: 228 }, per);
  const [r1, r2] = b.add([...e1, ...e2]);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, false);
  assert.match(r2.reason, /allerede registrert/);
  assert.equal(b.state.pallets.get('300').trays, 200);
});

test('levering: alle paller til samme butikk og ordre; levert pall kan ikke leveres igjen', () => {
  const b = book();
  const rema = store(b, 'Rema 1000 Hareid');
  const joker = store(b, 'Joker Brandal');
  reg(b, '401'); reg(b, '402'); reg(b, '403');
  const ok = b.add(cmd.deliver(b.state, { pallets: ['401', '402'], store_id: rema, order: 'F-1', date: today }, anne));
  assert.ok(ok.every((r) => r.ok));
  const v = search(b.state, { order: 'F-1' });
  assert.equal(v.length, 2);
  assert.ok(v.every((p) => p.status === 'levert' && p.store_name === 'Rema 1000 Hareid'));
  // Forhåndskontroll stopper forsøk på å levere 401 på nytt
  assert.throws(() => cmd.deliver(b.state, { pallets: ['401', '403'], store_id: joker, order: 'F-2', date: today }, anne), /401/);
});

test('samtidige leveringer av samme pall: bare første gjelder, hele den andre avvises', () => {
  const b = book();
  const rema = store(b, 'Rema');
  const joker = store(b, 'Joker');
  reg(b, '500'); reg(b, '501');
  const s0 = b.state;
  const d1 = cmd.deliver(s0, { pallets: ['500'], store_id: rema, order: 'A', date: today }, anne);
  const d2 = cmd.deliver(s0, { pallets: ['501', '500'], store_id: joker, order: 'B', date: today }, per);
  const res = b.add([...d1, ...d2]);
  assert.deepEqual(res.map((r) => r.ok), [true, false, false]); // alt-eller-ingenting for d2
  assert.match(res[2].reason, /allerede levert/);
  assert.equal(b.state.pallets.get('501').delivery_id, null); // 501 fortsatt på lager
  assert.equal(search(b.state, { order: 'B' }).length, 0);
});

test('sperret og annullert pall kan ikke leveres, heller ikke via rader lagt inn direkte', () => {
  const b = book();
  const rema = store(b, 'Rema');
  reg(b, '600');
  b.add(cmd.palletAction(b.state, '600', 'void', 'feil nummer', anne));
  const fake = { id: 'X.1', ts: '2026-01-01 10:00:00', user: 'x', type: T.DELIVERED, pallet: '600', store_id: rema, order: 'Z', delivery_date: today };
  const [r] = b.add([fake]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /annullert/);
});

test('datosøk finner alle paller der verpeperioden overlapper søkeperioden', () => {
  const b = book();
  const d = (n) => daysAgo(40 - n);
  reg(b, 'D1', { lay_from: d(1), lay_to: d(5) });
  reg(b, 'D2', { lay_from: d(6), lay_to: d(10) });
  reg(b, 'D3', { lay_from: d(3), lay_to: d(3) });
  reg(b, 'D4', { lay_from: d(1), lay_to: d(20) });
  const q = (from, to) => search(b.state, { from, to }).map((p) => p.no).sort();
  assert.deepEqual(q(d(5), d(6)), ['D1', 'D2', 'D4']);
  assert.deepEqual(q(d(3), ''), ['D1', 'D3', 'D4']);
  assert.deepEqual(q('', d(3)), ['D1', 'D3', 'D4']);
  assert.deepEqual(q(d(4), d(4)), ['D1', 'D4']);
  assert.deepEqual(q(d(11), d(12)), ['D4']);
  assert.deepEqual(q(d(0), d(21)), ['D1', 'D2', 'D3', 'D4']);
  assert.deepEqual(q(d(21), d(25)), []);
  assert.throws(() => search(b.state, { from: d(5), to: d(1) }), /Fra-dato/);
});

test('rettelser krever årsak og bevarer tidligere verdier', () => {
  const b = book();
  reg(b, '700', { trays: 228 });
  assert.throws(() => cmd.correctPallet(b.state, '700', { lay_from: daysAgo(1), trays: 200 }, per), /årsak/);
  const [r] = b.add(cmd.correctPallet(b.state, '700', { lay_from: daysAgo(1), trays: 200, reason: 'Telte feil' }, per));
  assert.equal(r.ok, true);
  assert.equal(b.state.pallets.get('700').trays, 200);
  const h = palletHistory(b.state, '700');
  assert.deepEqual(h.map((e) => e.type), [T.REGISTERED, T.CORRECTED]);
  assert.equal(h[0].trays, 228); // opprinnelig rad er uendret
  assert.equal(h[1].user, 'per@gard.no');
  assert.match(h[1].previous, /Brett: 228/);
  assert.equal(h[1].reason, 'Telte feil');
});

test('feil levering rettes med historikk, og pallen kan leveres riktig etterpå', () => {
  const b = book();
  const rema = store(b, 'Rema');
  const joker = store(b, 'Joker');
  reg(b, '800');
  b.add(cmd.deliver(b.state, { pallets: ['800'], store_id: rema, order: 'F-1', date: today }, anne));
  b.add(cmd.palletAction(b.state, '800', 'undeliver', 'Feil pall valgt', anne));
  assert.equal(b.state.pallets.get('800').delivery_id, null);
  b.add(cmd.deliver(b.state, { pallets: ['800'], store_id: joker, order: 'F-2', date: today }, anne));
  const did = b.state.pallets.get('800').delivery_id;
  b.add(cmd.correctDelivery(b.state, did, { store_id: joker, order: 'F-3', date: today, reason: 'Skrivefeil' }, per));
  const h = palletHistory(b.state, '800').map((e) => e.type);
  assert.deepEqual(h, [T.REGISTERED, T.DELIVERED, T.UNDELIVERED, T.DELIVERED, T.DELIVERY_CORRECTED]);
  assert.equal(search(b.state, { no: '800' })[0].order, 'F-3');
});

test('annullering: nummeret forblir reservert, levert pall kan ikke annulleres', () => {
  const b = book();
  const rema = store(b, 'Rema');
  reg(b, '900');
  b.add(cmd.palletAction(b.state, '900', 'void', 'Feil nummer', anne));
  assert.throws(() => cmd.registerPallet(b.state, { pallet_no: '900', lay_from: daysAgo(1), trays: 200 }, anne), /aldri brukes på nytt/);
  reg(b, '901');
  b.add(cmd.deliver(b.state, { pallets: ['901'], store_id: rema, order: 'X', date: today }, anne));
  assert.throws(() => cmd.palletAction(b.state, '901', 'void', 'x', anne), /levert pall/);
});

test('butikker: unikt navn, valgfri kontaktinfo', () => {
  const b = book();
  store(b, 'Rema 1000 Hareid');
  assert.throws(() => cmd.createStore(b.state, { name: 'rema 1000 hareid' }, anne), /finnes allerede/);
  assert.throws(() => cmd.createStore(b.state, { name: 'X', email: 'ikke-epost' }, anne), /E-post/);
});

test('tilbakekalling: merk, sperr lager, butikker, varsling og CSV', () => {
  const b = book();
  const rema = store(b, 'Rema 1000 Hareid');
  const joker = store(b, 'Joker Brandal');
  reg(b, 'R1', { lay_from: daysAgo(30), lay_to: daysAgo(29) });
  reg(b, 'R2', { lay_from: daysAgo(29) });
  reg(b, 'R3', { lay_from: daysAgo(29), trays: 200 });
  reg(b, 'R4', { lay_from: daysAgo(28) });
  b.add(cmd.deliver(b.state, { pallets: ['R1', 'R2'], store_id: rema, order: 'O-1', date: daysAgo(27) }, anne));
  b.add(cmd.deliver(b.state, { pallets: ['R3'], store_id: joker, order: 'O-2', date: daysAgo(26) }, anne));

  const hits = search(b.state, { from: daysAgo(29), to: daysAgo(29) }).map((p) => p.no).sort();
  assert.deepEqual(hits, ['R1', 'R2', 'R3']);
  const { recallId, events } = cmd.markAffected(b.state, { pallets: [...hits, 'R4'], title: 'Salmonella-test' }, anne);
  assert.ok(b.add(events).every((r) => r.ok));

  let o = recallOverview(b.state, recallId);
  assert.equal(o.summary.pallets, 4);
  assert.equal(o.summary.in_stock_unblocked, 1);
  const r = o.stores.find((s) => s.name === 'Rema 1000 Hareid');
  assert.equal(r.pallets, 2);
  assert.equal(r.trays, 456);
  assert.equal(r.deliveries[0].order, 'O-1');
  assert.equal(r.deliveries[0].date, daysAgo(27));

  b.add(cmd.blockRecall(b.state, recallId, anne));
  o = recallOverview(b.state, recallId);
  assert.equal(o.pallets.find((p) => p.no === 'R4').blocked, true);
  assert.ok(o.pallets.filter((p) => p.no !== 'R4').every((p) => p.status === 'levert' && !p.blocked));
  assert.throws(() => cmd.deliver(b.state, { pallets: ['R4'], store_id: rema, order: 'O-3', date: today }, anne), /R4/);

  b.add(cmd.notify(b.state, { recall_id: recallId, store_id: rema, date: today, note: 'Ringte butikksjef' }, anne));
  b.add(cmd.notify(b.state, { recall_id: recallId, store_id: rema, date: today, note: 'Varer fjernet' }, per));
  o = recallOverview(b.state, recallId);
  assert.equal(o.stores.find((s) => s.id === rema).notice.note, 'Varer fjernet');
  assert.equal(b.events.filter((e) => e.type === T.NOTIFIED).length, 2); // begge varslinger står i loggen
  assert.match(b.events.at(-1).previous, /Ringte butikksjef/);

  // Merking på nytt av samme pall gir ingen dobbeltføring
  assert.throws(() => cmd.markAffected(b.state, { pallets: ['R1'], recall_id: recallId }, anne), /allerede merket/);

  const csv = recallCsv(o);
  assert.ok(csv.startsWith('﻿'));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 5);
  assert.match(csv, /R1;.*Levert;Nei;Rema 1000 Hareid;.*O-1;Ja;.*Varer fjernet/);
  assert.match(csv, /R4;.*På lager;Ja;/);

  // Opphev sperre krever årsak
  assert.throws(() => cmd.palletAction(b.state, 'R4', 'unblock', '', anne), /årsak/);
  b.add(cmd.palletAction(b.state, 'R4', 'unblock', 'Analyse negativ', anne));
  assert.equal(b.state.pallets.get('R4').blocked, false);
});

test('rader tåler Excels typekonvertering (tall og datoer som serienummer)', () => {
  const [e] = cmd.registerPallet(replay([]), { pallet_no: '123', lay_from: '2026-09-28', trays: 228 }, anne);
  const values = eventToValues(e);
  // Slik Excel ville levert tilbake hvis teksten ikke var beskyttet
  const excelish = values.map((v, i) => (i === 4 ? 123 : i === 5 || i === 6 ? 46293 : v));
  const back = rowToEvent(excelish);
  assert.equal(back.pallet, '123');
  assert.equal(back.lay_from, '2026-09-28');
  assert.equal(back.trays, 228);
});

test('duplikatrader (f.eks. etter nettverksfeil) telles bare én gang', () => {
  const b = book();
  const evs = cmd.registerPallet(b.state, { pallet_no: '55', lay_from: daysAgo(1), trays: 200 }, anne);
  b.add(evs);
  b.add(evs); // samme ID-er på nytt
  assert.equal(b.state.pallets.size, 1);
  assert.equal(palletHistory(b.state, '55').length, 1);
});
