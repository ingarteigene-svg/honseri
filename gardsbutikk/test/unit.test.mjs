// Enhetstester for ren logikk (uten database).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeAllowed, cleanLines, mvaOf, osloDayStartUtc } from '../src/index.js';

test('butikk-Workeren svarer ikke på adminsiden eller admin-API-et', () => {
  for (const p of ['/admin', '/admin/', '/admin/index.html', '/api/admin', '/api/admin/oversikt']) {
    assert.equal(routeAllowed('butikk', p), false, p);
    assert.equal(routeAllowed(undefined, p), false, `ukjent rolle: ${p}`);
    assert.equal(routeAllowed('admin', p), true, p);
  }
  for (const p of ['/', '/kvittering', '/api/butikk', '/administrasjon-er-ikke-admin']) {
    assert.equal(routeAllowed('butikk', p), true, p);
  }
});

test('handlekurv: like varer slås sammen, ugyldige linjer avvises', () => {
  assert.deepEqual(cleanLines([{ produkt: 1, antall: 2 }, { produkt: '1', antall: '3' }, { produkt: 2, antall: 1 }]),
    [{ produkt: 1, antall: 5 }, { produkt: 2, antall: 1 }]);
  assert.throws(() => cleanLines([]), /tom/);
  assert.throws(() => cleanLines([{ produkt: 1, antall: 0 }]), /Antall/);
  assert.throws(() => cleanLines([{ produkt: 1, antall: 1.5 }]), /Antall/);
  assert.throws(() => cleanLines([{ produkt: 'x', antall: 1 }]), /Ukjent/);
  assert.throws(() => cleanLines([{ produkt: 1, antall: 30 }, { produkt: 1, antall: 21 }]), /Maks 50/);
});

test('MVA regnes ut av priser inkl. MVA (15 % på mat)', () => {
  assert.equal(mvaOf([{ antall: 1, pris_ore: 10000, mva_sats: 15 }]), 1304);
  assert.equal(mvaOf([{ antall: 1, pris_ore: 10000, mva_sats: 15 }, { antall: 2, pris_ore: 4000, mva_sats: 15 }]), 2348);
  assert.equal(mvaOf([{ antall: 3, pris_ore: 4000, mva_sats: 0 }]), 0);
});

test('midnatt norsk tid, både sommer- og vintertid', () => {
  assert.equal(osloDayStartUtc('2026-07-01'), '2026-06-30T22:00:00.000Z');
  assert.equal(osloDayStartUtc('2026-12-01'), '2026-11-30T23:00:00.000Z');
  assert.equal(osloDayStartUtc('2026-03-29'), '2026-03-28T23:00:00.000Z'); // dagen sommertid starter
  assert.equal(osloDayStartUtc('2026-10-25'), '2026-10-24T22:00:00.000Z'); // dagen vintertid starter
});
