// Testar datafilene i data/ (flytting frå den gamle appen) mot ein eigen, lokal
// database: rett tal rader, rett innhald, revisjonslogg, og ingen dobbel ved
// ny køyring eller når dagen alt er registrert i den nye appen.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const persist = mkdtempSync(join(tmpdir(), 'honseri-data-'));
const wrangler = join(root, 'node_modules', '.bin', 'wrangler');
const FILE = 'data/2026-10-06-gamal-logg-lars-andreas.sql';

function d1(...args) {
  try {
    return execFileSync(wrangler, ['d1', ...args, '--local', '--persist-to', persist], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    throw new Error(`${e.stdout}${e.stderr}`);
  }
}
const sql = (command) => {
  const out = d1('execute', 'DB', '--json', '--command', command);
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
};
const runFile = () => d1('execute', 'DB', '--yes', '--file', FILE);

before(() => {
  d1('migrations', 'apply', 'DB');
  // Lars Andreas har alt registrert 05.10 i den nye appen
  sql(`INSERT INTO entries (uid, navn, dato, egg, created_by) VALUES ('ny-1', 'Lars Andreas', '2026-10-05', 15000, 'lars@gard.no')`);
});
after(() => rmSync(persist, { recursive: true, force: true }));

test('gamal logg: 49 nye dagar, dagen som alt fanst blir ikkje dobla', () => {
  runFile();
  const [c] = sql(`SELECT COUNT(*) n, MIN(dato) fra, MAX(dato) til, SUM(egg) egg FROM entries WHERE uid LIKE 'gamal-la-%'`);
  assert.equal(c.n, 49);
  assert.equal(c.fra, '2026-06-29');
  assert.equal(c.til, '2026-10-02');
  assert.equal(sql(`SELECT egg FROM entries WHERE dato = '2026-10-05'`).map((r) => r.egg).join(), '15000');
});

test('gamal logg: innhald, desimalar og kommentar med linjeskift', () => {
  const [r] = sql(`SELECT * FROM entries WHERE uid = 'gamal-la-2026-08-03'`);
  assert.equal(r.navn, 'Lars Andreas');
  assert.equal(r.egg, 15720);
  assert.equal(r.vanlige, 102);
  assert.equal(r.vann, 199.1);
  assert.equal(r.timer, 4.2);
  assert.equal(r.kommentar, '40 brett hareid sjukehein\n42 brett ingar u/sjukeheim?');
  assert.equal(sql(`SELECT kommentar FROM entries WHERE uid = 'gamal-la-2026-06-29'`)[0].kommentar, null);
});

test('gamal logg: revisjonslogg viser flyttinga, og ctx blir nullstilt', () => {
  const a = sql(`SELECT a.user, a.action FROM audit_log a JOIN entries e ON e.id = a.entity_id WHERE e.uid LIKE 'gamal-la-%'`);
  assert.equal(a.length, 49);
  assert.ok(a.every((x) => x.user === 'flytta frå gamal app' && x.action === 'flytta'));
  assert.deepEqual(sql('SELECT user, action, reason FROM ctx')[0], { user: null, action: null, reason: null });
});

test('gamal logg: ny køyring (neste publisering) endrar ingenting, heller ikkje sletta eller retta rader', () => {
  sql(`UPDATE entries SET deleted = 1 WHERE uid = 'gamal-la-2026-07-01'`);
  sql(`UPDATE entries SET silo = 4060 WHERE uid = 'gamal-la-2026-06-30'`);
  const before = sql('SELECT COUNT(*) n FROM entries')[0].n;
  runFile();
  assert.equal(sql('SELECT COUNT(*) n FROM entries')[0].n, before);
  assert.equal(sql(`SELECT silo FROM entries WHERE uid = 'gamal-la-2026-06-30'`)[0].silo, 4060);
  assert.equal(sql(`SELECT deleted FROM entries WHERE uid = 'gamal-la-2026-07-01'`)[0].deleted, 1);
});
