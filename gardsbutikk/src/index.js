// Gårdsbutikk – selvbetjent salg av egg med Vipps og kontant (Cloudflare Worker + D1).
//
// Samme kode kjører som to Workers mot samme database:
//  * «gardsbutikk»       (ROLE=butikk): åpen butikkside for kundene, uten innlogging.
//                        Adminsiden og admin-API-et finnes ikke her.
//  * «gardsbutikk-admin» (ROLE=admin):  adminsiden, bak Cloudflare Access.
// Admin-API-et sjekker i tillegg Access-tokenet i Workeren selv (fail closed).

import { authenticateWithReason } from './auth.js';
import * as vipps from './vipps.js';

const APP_VERSION = '1.0';
const MAX_ANTALL = 50;            // per vare per handel
const DEFAULT_RATE_LIMIT = 20;    // handler per IP per 10 minutter
const RECONCILE_HOURS = 48;       // hvor lenge cron leter etter ubekreftede Vipps-betalinger
const REF = /^gb-[0-9a-f]{32}$/;
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

// ---------------------------------------------------------------------------
// Hjelpere
// ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Ugyldig forespørsel.');
  }
}

function cleanText(v, max) {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  return s.length > max ? s.slice(0, max) : s;
}

function toNumber(v) {
  if (v == null || v === '') return NaN;
  if (typeof v === 'number') return v;
  return Number(String(v).trim().replace(/\s/g, '').replace(',', '.'));
}

function randomHex(bytes) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Dagens dato i Norge som ÅÅÅÅ-MM-DD. */
export function osloToday(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' }).format(now);
}

function osloOffsetMs(date) {
  const tz = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Oslo', timeZoneName: 'longOffset' })
    .formatToParts(date).find((p) => p.type === 'timeZoneName')?.value || '';
  const m = tz.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) * 60000;
}

/** Midnatt norsk tid for datoen, som UTC-tidspunkt i samme format som databasen. */
export function osloDayStartUtc(d) {
  const guess = new Date(`${d}T00:00:00Z`);
  return new Date(guess.getTime() - osloOffsetMs(guess)).toISOString();
}

function addDays(d, n) {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Periode fra spørrestrengen (fra/til, begge med), som UTC-grenser [start, slutt). */
function period(url) {
  const today = osloToday();
  const fra = url.searchParams.get('fra') || today;
  const til = url.searchParams.get('til') || fra;
  if (!isDate(fra) || !isDate(til) || til < fra) throw new HttpError(400, 'Ugyldig periode.');
  return { fra, til, start: osloDayStartUtc(fra), end: osloDayStartUtc(addDays(til, 1)) };
}

/** Hvilke adresser hver Worker svarer på. Ukjent rolle behandles som butikk (sikreste valg). */
export function routeAllowed(role, pathname) {
  const admin = /^\/(api\/)?admin(\/|$)/.test(pathname);
  if (role === 'admin' || role === 'begge') return true;
  return !admin;
}

function dbError(e) {
  const m = String(e?.message || e);
  if (m.includes('SLETTING_IKKE_TILLATT')) return new HttpError(409, 'Sletting er ikke tillatt.');
  if (m.includes('ULOVLIG_STATUSENDRING')) return new HttpError(409, 'Ordren har allerede endret status.');
  if (m.includes('ORDRE_LAAST') || m.includes('KAN_IKKE_ENDRES')) return new HttpError(409, 'Dette kan ikke endres.');
  if (m.includes('CHECK constraint failed')) return new HttpError(400, 'Ugyldige verdier. Kontroller feltene.');
  console.error('DB-feil:', m);
  return new HttpError(500, 'Lagring mislyktes i databasen. Ingenting ble lagret, prøv igjen.');
}

async function batch(db, stmts) {
  try {
    return await db.batch(stmts);
  } catch (e) {
    throw dbError(e);
  }
}

function audit(db, user, action, entity, id, oldV, newV) {
  return db.prepare('INSERT INTO audit_log (user, action, entity, entity_id, old_values, new_values) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(user, action, entity, id == null ? null : String(id),
      oldV == null ? null : JSON.stringify(oldV), newV == null ? null : JSON.stringify(newV));
}

async function loadSettings(db) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(results.map((r) => [r.key, r.value]));
}

const PUBLIC_SETTINGS = ['butikknavn', 'adresse', 'orgnr', 'kontakt', 'melding'];
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k] || '']));

function stockStatus(p) {
  if (!p.moves) return null; // lageret er ikke registrert for denne varen
  if (p.lager <= 0) return 'tomt';
  if (p.lager <= p.lav_grense) return 'få';
  return 'ja';
}

function productApi(p) {
  return {
    id: p.id, navn: p.navn, beskrivelse: p.beskrivelse, emoji: p.emoji, pris: p.pris_ore,
    mvaSats: p.mva_sats, aktiv: !!p.aktiv, sortering: p.sortering, lavGrense: p.lav_grense,
    lager: p.moves ? p.lager : null,
  };
}

const PRODUCTS_WITH_STOCK = `
  SELECT p.*, COALESCE((SELECT SUM(delta) FROM stock_moves s WHERE s.product_id = p.id), 0) AS lager,
         (SELECT count(*) FROM stock_moves s WHERE s.product_id = p.id) AS moves
  FROM products p`;

function orderApi(o, lines) {
  return {
    ref: o.ref, nr: o.id, metode: o.metode, status: o.status, sum: o.sum_ore, mva: o.mva_ore,
    opprettet: o.created_at, betalt: o.paid_at, avsluttet: o.closed_at,
    annullertAv: o.annullert_av, annullertGrunn: o.annullert_grunn, vippsStatus: o.vipps_state,
    linjer: lines.map((l) => ({ produkt: l.product_id, navn: l.navn, antall: l.antall, pris: l.pris_ore, mvaSats: l.mva_sats })),
  };
}

async function loadOrder(db, ref) {
  const [o, l] = await db.batch([
    db.prepare('SELECT * FROM orders WHERE ref = ?').bind(ref),
    db.prepare('SELECT l.* FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.ref = ? ORDER BY l.id').bind(ref),
  ]);
  if (!o.results.length) return null;
  return orderApi(o.results[0], l.results);
}

// ---------------------------------------------------------------------------
// Butikk (åpen for kunder)
// ---------------------------------------------------------------------------

async function shop(env, url, role) {
  const db = env.DB;
  const [{ results: prods }, settings] = await Promise.all([
    db.prepare(`${PRODUCTS_WITH_STOCK} WHERE p.aktiv = 1 ORDER BY p.sortering, p.id`).all(),
    loadSettings(db),
  ]);
  // Adressen til butikken huskes, så adminsiden kan lage QR-plakat med riktig lenke.
  if (role === 'butikk' && settings.butikk_url_auto !== url.origin) {
    await db.prepare("INSERT INTO settings (key, value) VALUES ('butikk_url_auto', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
      .bind(url.origin).run();
  }
  const vc = vipps.config(env);
  return {
    butikk: pick(settings, PUBLIC_SETTINGS),
    produkter: prods.map((p) => ({ id: p.id, navn: p.navn, beskrivelse: p.beskrivelse, emoji: p.emoji, pris: p.pris_ore, status: stockStatus(p) })),
    vipps: !!vc,
    vippsTest: !!vc && vc.env === 'test',
    version: APP_VERSION,
  };
}

/** Rensker handlekurven: [{produkt, antall}], like varer slås sammen. */
export function cleanLines(raw) {
  if (!Array.isArray(raw) || !raw.length) throw new HttpError(400, 'Handlekurven er tom.');
  if (raw.length > 30) throw new HttpError(400, 'For mange varelinjer.');
  const byId = new Map();
  for (const r of raw) {
    const id = toNumber(r?.produkt);
    const n = toNumber(r?.antall);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Ukjent vare.');
    if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'Antall må være et helt tall over 0.');
    byId.set(id, (byId.get(id) || 0) + n);
  }
  for (const n of byId.values()) {
    if (n > MAX_ANTALL) throw new HttpError(400, `Maks ${MAX_ANTALL} av hver vare per handel.`);
  }
  return [...byId].map(([produkt, antall]) => ({ produkt, antall }));
}

/** MVA som inngår i beløpene (priser er inkl. MVA), avrundet til hele øre. */
export function mvaOf(lines) {
  return Math.round(lines.reduce((s, l) => s + (l.antall * l.pris_ore * l.mva_sats) / (100 + l.mva_sats), 0));
}

let ipSalt = null;
async function ipHash(db, request) {
  if (!ipSalt) {
    await db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('ip_salt', ?)").bind(randomHex(16)).run();
    ipSalt = (await db.prepare("SELECT value FROM settings WHERE key = 'ip_salt'").first()).value;
  }
  const ip = request.headers.get('CF-Connecting-IP') || 'ukjent';
  return (await sha256Hex(`${ipSalt}|${ip}`)).slice(0, 24);
}

async function createOrder(request, env, url) {
  const db = env.DB;
  const b = await readBody(request);
  const metode = b?.metode;
  if (metode !== 'vipps' && metode !== 'kontant') throw new HttpError(400, 'Velg Vipps eller kontant.');
  const wanted = cleanLines(b.linjer);

  const vc = vipps.config(env);
  if (metode === 'vipps' && !vc) throw new HttpError(503, 'Vipps er ikke satt opp ennå. Betal kontant.');

  const ids = wanted.map((l) => l.produkt);
  const { results: prods } = await db
    .prepare(`SELECT * FROM products WHERE aktiv = 1 AND id IN (${ids.map(() => '?').join(', ')})`)
    .bind(...ids).all();
  if (prods.length !== ids.length) throw new HttpError(409, 'En av varene er ikke lenger til salgs. Last siden på nytt.');
  const byId = new Map(prods.map((p) => [p.id, p]));
  const lines = wanted.map((w) => {
    const p = byId.get(w.produkt);
    return { product_id: p.id, navn: p.navn, antall: w.antall, pris_ore: p.pris_ore, mva_sats: p.mva_sats };
  });
  const sum = lines.reduce((s, l) => s + l.antall * l.pris_ore, 0);

  const hash = await ipHash(db, request);
  const limit = Number(env.RATE_LIMIT) || DEFAULT_RATE_LIMIT;
  const recent = await db
    .prepare(`SELECT count(*) AS n FROM orders WHERE ip_hash = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 minutes')`)
    .bind(hash).first();
  if (recent.n >= limit) throw new HttpError(429, 'For mange handler på kort tid. Vent litt og prøv igjen.');

  const ref = `gb-${randomHex(16)}`;
  const kontant = metode === 'kontant';
  const stmts = [
    db.prepare(`INSERT INTO orders (ref, metode, status, sum_ore, mva_ore, ip_hash, paid_at)
                VALUES (?, ?, ?, ?, ?, ?, ${kontant ? NOW : 'NULL'}) RETURNING id`)
      .bind(ref, metode, kontant ? 'betalt' : 'venter', sum, mvaOf(lines), hash),
    ...lines.map((l) =>
      db.prepare(`INSERT INTO order_lines (order_id, product_id, navn, antall, pris_ore, mva_sats)
                  VALUES ((SELECT id FROM orders WHERE ref = ?), ?, ?, ?, ?, ?)`)
        .bind(ref, l.product_id, l.navn, l.antall, l.pris_ore, l.mva_sats)),
  ];
  if (kontant) stmts.push(saleMoves(db, ref, 'kunde (kontant)'));
  const [first] = await batch(db, stmts);
  const nr = first.results[0].id;

  if (kontant) return json({ ref, status: 'betalt', ordre: await loadOrder(db, ref) }, 201);

  const settings = await loadSettings(db);
  try {
    const p = await vipps.createPayment(vc, {
      reference: ref,
      amountOre: sum,
      description: `${settings.butikknavn || 'Gårdsbutikk'} – ordre ${nr}`,
      returnUrl: `${url.origin}/kvittering?ref=${ref}`,
    });
    if (!p?.redirectUrl) throw new Error('Mangler redirectUrl');
    return json({ ref, status: 'venter', redirectUrl: p.redirectUrl }, 201);
  } catch (e) {
    console.error('Vipps-oppretting feilet:', e?.message || e);
    await db.prepare(`UPDATE orders SET status = 'avbrutt', vipps_state = 'FEIL', closed_at = ${NOW} WHERE ref = ? AND status = 'venter'`)
      .bind(ref).run();
    throw new HttpError(502, 'Fikk ikke kontakt med Vipps. Prøv igjen, eller betal kontant.');
  }
}

/** Trekker varene på en betalt ordre fra lageret. Trygt å kjøre flere ganger. */
function saleMoves(db, ref, user) {
  return db.prepare(`INSERT OR IGNORE INTO stock_moves (product_id, delta, type, order_id, user)
                     SELECT l.product_id, -l.antall, 'salg', l.order_id, ?
                     FROM order_lines l JOIN orders o ON o.id = l.order_id
                     WHERE o.ref = ? AND o.status = 'betalt'`).bind(user, ref);
}

/**
 * Henter Vipps-status for en ventende ordre og fullfører den: godkjent → trekk
 * beløpet (capture), merk betalt og trekk lageret; avbrutt/utløpt → merk avbrutt.
 * Uten force spørres Vipps maks hvert 2. sekund per ordre.
 */
export async function settle(env, ref, { force = false } = {}) {
  const db = env.DB;
  if (!force) {
    const claim = await db.prepare(`UPDATE orders SET checked_at = ${NOW}
      WHERE ref = ? AND status = 'venter' AND metode = 'vipps'
        AND (checked_at IS NULL OR checked_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 seconds')) RETURNING id`).bind(ref).first();
    if (!claim) return;
  }
  const order = await db.prepare('SELECT * FROM orders WHERE ref = ?').bind(ref).first();
  if (!order || order.status !== 'venter' || order.metode !== 'vipps') return;
  const vc = vipps.config(env);
  if (!vc) return;

  const p = await vipps.getPayment(vc, ref);
  if (p?.amount?.currency !== 'NOK' || p?.amount?.value !== order.sum_ore) {
    console.error(`Beløpet hos Vipps stemmer ikke for ${ref}:`, JSON.stringify(p?.amount));
    await db.prepare("UPDATE orders SET vipps_state = 'BELØPSAVVIK' WHERE ref = ?").bind(ref).run();
    return;
  }
  if (p.state === 'AUTHORIZED') {
    const captured = p.aggregate?.capturedAmount?.value || 0;
    if (captured === 0) await vipps.capturePayment(vc, ref, order.sum_ore);
    else if (captured < order.sum_ore) {
      console.error(`Delvis trukket beløp for ${ref}: ${captured}`);
      return;
    }
    await batch(db, [
      db.prepare(`UPDATE orders SET status = 'betalt', paid_at = ${NOW}, vipps_state = 'CAPTURED', psp_ref = ?
                  WHERE ref = ? AND status = 'venter'`).bind(p.pspReference || null, ref),
      saleMoves(db, ref, 'kunde (Vipps)'),
    ]);
  } else if (['ABORTED', 'EXPIRED', 'TERMINATED'].includes(p.state)) {
    await db.prepare(`UPDATE orders SET status = 'avbrutt', vipps_state = ?, closed_at = ${NOW} WHERE ref = ? AND status = 'venter'`)
      .bind(p.state, ref).run();
  } else if (p.state && p.state !== order.vipps_state) {
    await db.prepare('UPDATE orders SET vipps_state = ? WHERE ref = ?').bind(String(p.state).slice(0, 20), ref).run();
  }
}

/** Cron: fullfører Vipps-betalinger der kunden ikke kom tilbake til kvitteringssiden. */
export async function reconcile(env) {
  if (!vipps.config(env)) return { checked: 0 };
  const { results } = await env.DB.prepare(`SELECT ref FROM orders WHERE status = 'venter' AND metode = 'vipps'
    AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-${RECONCILE_HOURS} hours') ORDER BY id LIMIT 50`).all();
  let failed = 0;
  for (const { ref } of results) {
    try { await settle(env, ref, { force: true }); } catch (e) { failed++; console.error(`Sjekk av ${ref} feilet:`, e?.message || e); }
  }
  return { checked: results.length, failed };
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

function cleanProduct(b) {
  const p = {
    navn: cleanText(b?.navn, 60),
    beskrivelse: cleanText(b?.beskrivelse, 120),
    emoji: cleanText(b?.emoji, 8) || '🥚',
    mva_sats: b?.mvaSats == null || b.mvaSats === '' ? 15 : toNumber(b.mvaSats),
    aktiv: b?.aktiv === false || b?.aktiv === 0 ? 0 : 1,
    sortering: b?.sortering == null || b.sortering === '' ? 0 : toNumber(b.sortering),
    lav_grense: b?.lavGrense == null || b.lavGrense === '' ? 3 : toNumber(b.lavGrense),
  };
  const kr = toNumber(b?.pris);
  if (!p.navn) throw new HttpError(400, 'Varen må ha et navn.');
  if (!Number.isFinite(kr) || kr <= 0 || kr > 10000) throw new HttpError(400, 'Pris må være et beløp mellom 0 og 10 000 kr.');
  p.pris_ore = Math.round(kr * 100);
  if (![0, 12, 15, 25].includes(p.mva_sats)) throw new HttpError(400, 'MVA-sats må være 0, 12, 15 eller 25.');
  if (!Number.isInteger(p.sortering) || Math.abs(p.sortering) > 1000) throw new HttpError(400, 'Ugyldig sortering.');
  if (!Number.isInteger(p.lav_grense) || p.lav_grense < 0 || p.lav_grense > 10000) throw new HttpError(400, 'Ugyldig grense for «få igjen».');
  return p;
}

const PRODUCT_COLS = ['navn', 'beskrivelse', 'emoji', 'pris_ore', 'mva_sats', 'aktiv', 'sortering', 'lav_grense'];

async function saveProduct(env, user, b) {
  const db = env.DB;
  const p = cleanProduct(b);
  const id = b?.id == null || b.id === '' ? null : toNumber(b.id);
  if (id == null) {
    const [r] = await batch(db, [
      db.prepare(`INSERT INTO products (${PRODUCT_COLS.join(', ')}, updated_by) VALUES (${PRODUCT_COLS.map(() => '?').join(', ')}, ?) RETURNING id`)
        .bind(...PRODUCT_COLS.map((c) => p[c]), user),
      audit(db, user, 'opprettet', 'vare', null, null, p),
    ]);
    return r.results[0].id;
  }
  if (!Number.isInteger(id)) throw new HttpError(400, 'Ugyldig vare.');
  const old = await db.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
  if (!old) throw new HttpError(404, 'Fant ikke varen.');
  if (PRODUCT_COLS.every((c) => old[c] === p[c])) return id;
  await batch(db, [
    db.prepare(`UPDATE products SET ${PRODUCT_COLS.map((c) => `${c} = ?`).join(', ')}, updated_at = ${NOW}, updated_by = ? WHERE id = ?`)
      .bind(...PRODUCT_COLS.map((c) => p[c]), user, id),
    audit(db, user, 'endret', 'vare', id, Object.fromEntries(PRODUCT_COLS.map((c) => [c, old[c]])), p),
  ]);
  return id;
}

async function stockMove(env, user, b) {
  const db = env.DB;
  const id = toNumber(b?.produkt);
  const n = toNumber(b?.antall);
  const type = b?.type;
  const kommentar = cleanText(b?.kommentar, 200) || null;
  if (!Number.isInteger(id)) throw new HttpError(400, 'Ukjent vare.');
  if (!(await db.prepare('SELECT 1 FROM products WHERE id = ?').bind(id).first())) throw new HttpError(404, 'Fant ikke varen.');
  if (type === 'påfyll') {
    if (!Number.isInteger(n) || n < 1 || n > 10000) throw new HttpError(400, 'Påfyll må være et helt tall mellom 1 og 10 000.');
    await batch(db, [db.prepare("INSERT INTO stock_moves (product_id, delta, type, kommentar, user) VALUES (?, ?, 'påfyll', ?, ?)")
      .bind(id, n, kommentar, user)]);
  } else if (type === 'telling') {
    if (!Number.isInteger(n) || n < 0 || n > 100000) throw new HttpError(400, 'Telling må være et helt tall, 0 eller mer.');
    // Differansen regnes ut i databasen, så samtidige salg ikke gir feil lager.
    await batch(db, [db.prepare(`INSERT INTO stock_moves (product_id, delta, type, telt, kommentar, user)
      VALUES (?, ? - COALESCE((SELECT SUM(delta) FROM stock_moves WHERE product_id = ?), 0), 'telling', ?, ?, ?)`)
      .bind(id, n, id, n, kommentar, user)]);
  } else {
    throw new HttpError(400, 'Velg påfyll eller telling.');
  }
  const p = await db.prepare(`${PRODUCTS_WITH_STOCK} WHERE p.id = ?`).bind(id).first();
  return productApi(p);
}

async function voidOrder(env, user, ref, b) {
  const db = env.DB;
  const grunn = cleanText(b?.grunn, 200);
  if (!grunn) throw new HttpError(400, 'Skriv en kort grunn for annulleringen.');
  const o = await db.prepare('SELECT * FROM orders WHERE ref = ?').bind(ref).first();
  if (!o) throw new HttpError(404, 'Fant ikke ordren.');
  if (o.status === 'annullert') return loadOrder(db, ref);
  if (o.status !== 'betalt') throw new HttpError(409, 'Bare betalte ordrer kan annulleres.');
  if (o.metode === 'vipps') {
    const vc = vipps.config(env);
    if (!vc) throw new HttpError(503, 'Vipps er ikke satt opp, så pengene kan ikke betales tilbake herfra.');
    try {
      await vipps.refundPayment(vc, ref, o.sum_ore);
    } catch (e) {
      throw new HttpError(502, `Tilbakebetaling i Vipps feilet: ${e.message}`);
    }
  }
  await batch(db, [
    db.prepare(`UPDATE orders SET status = 'annullert', closed_at = ${NOW}, annullert_av = ?, annullert_grunn = ?,
                vipps_state = CASE WHEN metode = 'vipps' THEN 'REFUNDED' ELSE vipps_state END
                WHERE ref = ? AND status = 'betalt'`).bind(user, grunn, ref),
    db.prepare(`INSERT OR IGNORE INTO stock_moves (product_id, delta, type, order_id, user)
                SELECT l.product_id, l.antall, 'retur', l.order_id, ? FROM order_lines l JOIN orders o ON o.id = l.order_id
                WHERE o.ref = ? AND o.status = 'annullert'`).bind(user, ref),
    audit(db, user, 'annullert', 'ordre', o.id, { status: o.status }, { status: 'annullert', grunn }),
  ]);
  return loadOrder(db, ref);
}

const EXPECTED_CASH = `COALESCE((SELECT SUM(sum_ore) FROM orders WHERE metode = 'kontant' AND status = 'betalt'
  AND paid_at > COALESCE((SELECT MAX(at) FROM cash_counts), '')), 0)`;

async function cashStatus(db) {
  const [exp, list] = await db.batch([
    db.prepare(`SELECT ${EXPECTED_CASH} AS forventet, (SELECT MAX(at) FROM cash_counts) AS siden`),
    db.prepare('SELECT * FROM cash_counts ORDER BY id DESC LIMIT 50'),
  ]);
  return {
    forventet: exp.results[0].forventet,
    siden: exp.results[0].siden,
    tellinger: list.results.map((c) => ({
      id: c.id, telt: c.telt_ore, forventet: c.forventet_ore, differanse: c.telt_ore - c.forventet_ore,
      fra: c.fra, til: c.at, kommentar: c.kommentar, av: c.user,
    })),
  };
}

const SETTING_RULES = { butikknavn: 60, adresse: 100, orgnr: 40, kontakt: 60, melding: 200, butikk_url: 200 };

async function overview(db, url) {
  const per = period(url);
  const [prods, sold, totals, svinn, venter] = await db.batch([
    db.prepare(`${PRODUCTS_WITH_STOCK} ORDER BY p.aktiv DESC, p.sortering, p.id`),
    db.prepare(`SELECT l.product_id, SUM(l.antall) AS antall, SUM(l.antall * l.pris_ore) AS sum
                FROM order_lines l JOIN orders o ON o.id = l.order_id
                WHERE o.status = 'betalt' AND o.paid_at >= ? AND o.paid_at < ? GROUP BY l.product_id`).bind(per.start, per.end),
    db.prepare(`SELECT metode, count(*) AS n, SUM(sum_ore) AS sum, SUM(mva_ore) AS mva FROM orders
                WHERE status = 'betalt' AND paid_at >= ? AND paid_at < ? GROUP BY metode`).bind(per.start, per.end),
    db.prepare(`SELECT product_id, SUM(delta) AS delta FROM stock_moves
                WHERE type = 'telling' AND delta < 0 AND at >= ? AND at < ? GROUP BY product_id`).bind(per.start, per.end),
    db.prepare("SELECT count(*) AS n FROM orders WHERE status = 'venter'"),
  ]);
  const soldBy = new Map(sold.results.map((r) => [r.product_id, r]));
  const svinnBy = new Map(svinn.results.map((r) => [r.product_id, -r.delta]));
  const t = { omsetning: 0, mva: 0, antall: 0, vipps: 0, kontant: 0, antallVipps: 0, antallKontant: 0 };
  for (const r of totals.results) {
    t.omsetning += r.sum; t.mva += r.mva; t.antall += r.n;
    if (r.metode === 'vipps') { t.vipps = r.sum; t.antallVipps = r.n; } else { t.kontant = r.sum; t.antallKontant = r.n; }
  }
  return {
    periode: { fra: per.fra, til: per.til },
    totalt: t,
    produkter: prods.results.map((p) => ({
      ...productApi(p), status: stockStatus(p),
      solgt: soldBy.get(p.id)?.antall || 0, omsetning: soldBy.get(p.id)?.sum || 0, svinn: svinnBy.get(p.id) || 0,
    })),
    venter: venter.results[0].n,
  };
}

async function listOrders(db, url) {
  const per = period(url);
  const [o, l] = await db.batch([
    db.prepare('SELECT * FROM orders WHERE created_at >= ? AND created_at < ? ORDER BY id DESC LIMIT 5000').bind(per.start, per.end),
    db.prepare(`SELECT l.* FROM order_lines l JOIN orders o ON o.id = l.order_id
                WHERE o.created_at >= ? AND o.created_at < ? ORDER BY l.id`).bind(per.start, per.end),
  ]);
  const lines = new Map();
  for (const x of l.results) (lines.get(x.order_id) || lines.set(x.order_id, []).get(x.order_id)).push(x);
  return { periode: { fra: per.fra, til: per.til }, ordrer: o.results.map((x) => orderApi(x, lines.get(x.id) || [])) };
}

async function adminRoute(request, env, user, url) {
  const db = env.DB;
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;
  const seg = path.split('/').filter(Boolean); // ['api', 'admin', ...]

  if (path === '/api/admin/me' && method === 'GET') return json({ user, today: osloToday(), version: APP_VERSION });
  if (path === '/api/admin/oversikt' && method === 'GET') return json(await overview(db, url));
  if (path === '/api/admin/ordrer' && method === 'GET') return json(await listOrders(db, url));

  if (seg[2] === 'ordrer' && seg.length === 5 && method === 'POST') {
    const ref = decodeURIComponent(seg[3]);
    if (!REF.test(ref)) throw new HttpError(400, 'Ugyldig ordre.');
    if (seg[4] === 'annuller') return json({ ordre: await voidOrder(env, user, ref, await readBody(request)) });
    if (seg[4] === 'sjekk') {
      try { await settle(env, ref, { force: true }); } catch (e) { throw new HttpError(502, `Sjekk mot Vipps feilet: ${e.message}`); }
      const ordre = await loadOrder(db, ref);
      if (!ordre) throw new HttpError(404, 'Fant ikke ordren.');
      return json({ ordre });
    }
  }

  if (path === '/api/admin/varer' && method === 'GET') {
    const { results } = await db.prepare(`${PRODUCTS_WITH_STOCK} ORDER BY p.aktiv DESC, p.sortering, p.id`).all();
    return json({ varer: results.map((p) => ({ ...productApi(p), status: stockStatus(p) })) });
  }
  if (path === '/api/admin/varer' && method === 'POST') {
    const id = await saveProduct(env, user, await readBody(request));
    const p = await db.prepare(`${PRODUCTS_WITH_STOCK} WHERE p.id = ?`).bind(id).first();
    return json({ vare: productApi(p) });
  }

  if (path === '/api/admin/lager' && method === 'POST') return json({ vare: await stockMove(env, user, await readBody(request)) });
  if (seg[2] === 'lager' && seg.length === 4 && method === 'GET') {
    const id = toNumber(seg[3]);
    if (!Number.isInteger(id)) throw new HttpError(400, 'Ugyldig vare.');
    const { results } = await db.prepare(`SELECT s.*, o.ref FROM stock_moves s LEFT JOIN orders o ON o.id = s.order_id
      WHERE s.product_id = ? ORDER BY s.id DESC LIMIT 200`).bind(id).all();
    return json({
      bevegelser: results.map((m) => ({ type: m.type, delta: m.delta, telt: m.telt, kommentar: m.kommentar, av: m.user, tid: m.at, ref: m.ref })),
    });
  }

  if (path === '/api/admin/kasse' && method === 'GET') return json(await cashStatus(db));
  if (path === '/api/admin/kasse' && method === 'POST') {
    const b = await readBody(request);
    const kr = toNumber(b?.telt);
    if (!Number.isFinite(kr) || kr < 0 || kr > 1000000) throw new HttpError(400, 'Skriv inn beløpet som ligger i kassa.');
    await batch(db, [db.prepare(`INSERT INTO cash_counts (telt_ore, forventet_ore, fra, kommentar, user)
      VALUES (?, ${EXPECTED_CASH}, (SELECT MAX(at) FROM cash_counts), ?, ?)`)
      .bind(Math.round(kr * 100), cleanText(b?.kommentar, 200) || null, user)]);
    return json(await cashStatus(db), 201);
  }

  if (path === '/api/admin/innstillinger' && method === 'GET') {
    const s = await loadSettings(db);
    const vc = vipps.config(env);
    return json({
      innstillinger: { ...pick(s, Object.keys(SETTING_RULES)), butikk_url_auto: s.butikk_url_auto || '' },
      vipps: { konfigurert: !!vc, miljo: vc?.env || null, msn: vc?.msn || null },
    });
  }
  if (path === '/api/admin/innstillinger' && method === 'POST') {
    const b = await readBody(request);
    const old = await loadSettings(db);
    const stmts = [];
    const changed = {};
    for (const [k, max] of Object.entries(SETTING_RULES)) {
      if (!(k in (b || {}))) continue;
      const v = cleanText(b[k], max);
      if (k === 'butikknavn' && !v) throw new HttpError(400, 'Butikken må ha et navn.');
      if (k === 'butikk_url' && v && !/^https:\/\/[^\s]+$/.test(v)) throw new HttpError(400, 'Butikkadressen må starte med https://');
      if ((old[k] || '') === v) continue;
      changed[k] = v;
      stmts.push(db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').bind(k, v));
    }
    if (stmts.length) {
      stmts.push(audit(db, user, 'endret', 'innstillinger', null, pick(old, Object.keys(changed)), changed));
      await batch(db, stmts);
    }
    return json({ ok: true, endret: Object.keys(changed) });
  }

  if (path === '/api/admin/vipps/test' && method === 'POST') {
    const vc = vipps.config(env);
    if (!vc) throw new HttpError(503, 'Vipps-nøklene er ikke lagt inn ennå (se README).');
    try {
      await vipps.accessToken(vc, { refresh: true });
    } catch (e) {
      throw new HttpError(502, e.message);
    }
    return json({ ok: true, miljo: vc.env, msn: vc.msn });
  }

  throw new HttpError(404, 'Ukjent adresse.');
}

// ---------------------------------------------------------------------------
// Inngang
// ---------------------------------------------------------------------------

async function route(request, env, url, role) {
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;

  if (method !== 'GET' && method !== 'HEAD') {
    // Enkel CSRF-vern: skriveoperasjoner må komme som JSON fra samme opphav.
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) throw new HttpError(403, 'Forespørselen ble avvist.');
    if (!(request.headers.get('Content-Type') || '').includes('application/json')) throw new HttpError(415, 'Forespørselen må være JSON.');
  }

  if (path.startsWith('/api/admin')) {
    const { user, reason } = await authenticateWithReason(request, env);
    if (!user) {
      console.warn('Innlogging avvist:', reason);
      return json({ error: 'Ikke innlogget. Last siden på nytt for å logge inn.', login: true, reason }, 401);
    }
    return adminRoute(request, env, user, url);
  }

  if (path === '/api/butikk' && method === 'GET') return json(await shop(env, url, role));
  if (path === '/api/butikk/ordrer' && method === 'POST') return createOrder(request, env, url);
  const m = path.match(/^\/api\/butikk\/ordrer\/([^/]+)$/);
  if (m && method === 'GET') {
    const ref = decodeURIComponent(m[1]);
    if (!REF.test(ref)) throw new HttpError(400, 'Ugyldig kvittering.');
    try { await settle(env, ref); } catch (e) { console.error(`Sjekk av ${ref} feilet:`, e?.message || e); }
    const ordre = await loadOrder(env.DB, ref);
    if (!ordre) throw new HttpError(404, 'Fant ikke kvitteringen.');
    const settings = await loadSettings(env.DB);
    return json({ ordre, butikk: pick(settings, PUBLIC_SETTINGS) });
  }

  throw new HttpError(404, 'Ukjent adresse.');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const role = env.ROLE || 'butikk';
    if (!routeAllowed(role, url.pathname)) return new Response('Ikke funnet', { status: 404 });

    if (!url.pathname.startsWith('/api/')) {
      if (role === 'admin' && url.pathname === '/') return Response.redirect(new URL('/admin/', url).toString(), 302);
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) return asset;
      // Ukjente stier (f.eks. /kvittering) viser butikken, eller adminsiden under /admin/.
      const fallback = url.pathname.startsWith('/admin/') ? '/admin/' : '/';
      return env.ASSETS.fetch(new Request(new URL(fallback, url), request));
    }

    try {
      return await route(request, env, url, role);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      if (e?.status) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Uventet feil på serveren. Ingenting ble lagret.' }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(reconcile(env).then((r) => console.log('Vipps-sjekk:', JSON.stringify(r))));
  },
};
