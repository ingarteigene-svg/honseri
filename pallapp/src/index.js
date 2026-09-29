// Pallsporing – Klokkargarden. API (Cloudflare Worker + D1).
// Statiske filer (public/) serveres direkte av Cloudflare; alt under /api/ går hit.

import { authenticate } from './auth.js';

const EGG_PER_TRAY = 30;

// ---------------------------------------------------------------------------
// Hjelpere
// ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** Dagens dato i Norge som ÅÅÅÅ-MM-DD. */
export function osloToday(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' }).format(now);
}

function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function requireDate(s, label) {
  if (!isDate(s)) throw new HttpError(400, `${label} mangler eller er ugyldig.`);
  return s;
}

function cleanText(s, label, { required = false, max = 200 } = {}) {
  const v = typeof s === 'string' ? s.trim().replace(/\s+/g, ' ') : '';
  if (required && !v) throw new HttpError(400, `${label} må fylles ut.`);
  if (v.length > max) throw new HttpError(400, `${label} kan være maks ${max} tegn.`);
  return v || null;
}

function requireReason(body) {
  return cleanText(body.reason, 'Årsak til endringen', { required: true, max: 300 });
}

/**
 * Normaliserer pallnummer slik at samme håndskrevne nummer alltid gir samme verdi:
 * fjerner mellomrom, store bokstaver, og fjerner ledende nuller i rene tall ("007" = "7").
 */
export function normalizePalletNo(input) {
  let v = String(input ?? '').replace(/\s+/g, '').toUpperCase();
  if (/^\d+$/.test(v)) v = v.replace(/^0+(?=\d)/, '');
  return v;
}

function requirePalletNo(input) {
  const v = normalizePalletNo(input);
  if (!v) throw new HttpError(400, 'Pallnummer må fylles ut.');
  if (!/^[0-9A-ZÆØÅ\-\/.]{1,20}$/.test(v)) {
    throw new HttpError(400, 'Pallnummer kan bare inneholde tall, bokstaver og bindestrek (maks 20 tegn).');
  }
  return v;
}

function requireTrays(v) {
  const n = typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : v;
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Antall brett må være et positivt heltall.');
  if (n > 5000) throw new HttpError(400, 'Antall brett virker urimelig høyt (maks 5000).');
  return n;
}

function requireId(v, label = 'ID') {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Ugyldig ${label}.`);
  return n;
}

function requireIdList(v, label) {
  if (!Array.isArray(v) || v.length === 0) throw new HttpError(400, `Velg minst én ${label}.`);
  const ids = [...new Set(v.map((x) => requireId(x, label)))];
  if (ids.length > 500) throw new HttpError(400, 'For mange paller i én operasjon (maks 500).');
  return ids;
}

function layPeriod(body, today) {
  const from = requireDate(body.lay_from, 'Verpedato fra');
  const to = body.lay_to ? requireDate(body.lay_to, 'Verpedato til') : from;
  if (from > to) throw new HttpError(400, 'Verpedato fra kan ikke være senere enn verpedato til.');
  if (to > today) throw new HttpError(400, 'Verpedato kan ikke være senere enn pakkedato.');
  return { from, to };
}

const placeholders = (n) => Array(n).fill('?').join(',');

/** Oversetter feil fra databasen (constraints/triggere) til forståelige meldinger. */
function dbError(e) {
  const m = String(e?.message || e);
  if (m.includes('UNIQUE constraint failed: pallets.pallet_no'))
    return new HttpError(409, 'Pallnummeret er allerede registrert. Et pallnummer kan aldri brukes på nytt.');
  if (m.includes('UNIQUE constraint failed: stores.name_key'))
    return new HttpError(409, 'Det finnes allerede en butikk med dette navnet.');
  if (m.includes('ALLEREDE_LEVERT')) return new HttpError(409, 'En eller flere paller er allerede levert. Ingenting ble lagret.');
  if (m.includes('PALL_SPERRET')) return new HttpError(409, 'En eller flere paller er sperret og kan ikke leveres. Ingenting ble lagret.');
  if (m.includes('PALL_ANNULLERT')) return new HttpError(409, 'En eller flere paller er annullert. Ingenting ble lagret.');
  if (m.includes('KAN_IKKE_SPERRE_LEVERT')) return new HttpError(409, 'Leverte paller kan ikke sperres.');
  if (m.includes('KAN_IKKE_ANNULLERE_LEVERT'))
    return new HttpError(409, 'En levert pall kan ikke annulleres. Fjern den fra leveringen først.');
  if (m.includes('PALLNUMMER_LAAST')) return new HttpError(409, 'Pallnummer kan ikke endres.');
  if (m.includes('SLETTING_IKKE_TILLATT')) return new HttpError(409, 'Sletting er ikke tillatt.');
  if (m.includes('CHECK constraint failed')) return new HttpError(400, 'Ugyldige verdier – kontroller feltene.');
  console.error('DB-feil:', m);
  return new HttpError(500, 'Lagring mislyktes i databasen. Ingenting ble lagret – prøv igjen.');
}

/**
 * Kjører skriveoperasjoner som én atomisk transaksjon (D1 batch).
 * Første setning setter hvem/hva/hvorfor for revisjonsloggen, siste nullstiller.
 */
async function write(env, user, action, reason, stmts) {
  const db = env.DB;
  const all = [
    db.prepare('UPDATE ctx SET user = ?, action = ?, reason = ? WHERE id = 1').bind(user, action, reason ?? null),
    ...stmts,
    db.prepare('UPDATE ctx SET user = NULL, action = NULL, reason = NULL WHERE id = 1'),
  ];
  try {
    const res = await db.batch(all);
    return res.slice(1, -1);
  } catch (e) {
    throw dbError(e);
  }
}

// ---------------------------------------------------------------------------
// Spørringer
// ---------------------------------------------------------------------------

const PALLET_SELECT = `
  SELECT p.id, p.pallet_no, p.lay_from, p.lay_to, p.trays, p.packed_date,
         p.blocked, p.voided, p.created_at, p.created_by, p.updated_at, p.updated_by,
         p.delivery_id, d.delivery_date, d.order_ref, d.store_id, s.name AS store_name,
         CASE WHEN p.voided = 1 THEN 'annullert'
              WHEN p.delivery_id IS NOT NULL THEN 'levert'
              ELSE 'lager' END AS status,
         (SELECT group_concat(rp.recall_id) FROM recall_pallets rp WHERE rp.pallet_id = p.id) AS recall_ids
  FROM pallets p
  LEFT JOIN deliveries d ON d.id = p.delivery_id
  LEFT JOIN stores s ON s.id = d.store_id`;

function shapePallet(r) {
  return {
    ...r,
    blocked: !!r.blocked,
    voided: !!r.voided,
    eggs: r.trays * EGG_PER_TRAY,
    recall_ids: r.recall_ids ? String(r.recall_ids).split(',').map(Number) : [],
  };
}

async function searchPallets(env, q) {
  const where = [];
  const args = [];

  if (q.get('no')) {
    const no = normalizePalletNo(q.get('no'));
    where.push(`p.pallet_no LIKE ? ESCAPE '\\'`);
    args.push(`%${no.replace(/[\\%_]/g, (c) => '\\' + c)}%`);
  }
  if (q.get('order')) {
    where.push(`d.order_ref LIKE ? ESCAPE '\\'`);
    args.push(`%${q.get('order').trim().replace(/[\\%_]/g, (c) => '\\' + c)}%`);
  }
  if (q.get('store')) {
    where.push('d.store_id = ?');
    args.push(requireId(q.get('store'), 'butikk'));
  }
  // Datosøk: alle paller der verpeperioden overlapper søkeperioden.
  // Én dato alene tolkes som én enkelt dag.
  const from = q.get('from') || q.get('to');
  const to = q.get('to') || q.get('from');
  if (from) {
    requireDate(from, 'Verpedato fra');
    requireDate(to, 'Verpedato til');
    if (from > to) throw new HttpError(400, 'Fra-dato kan ikke være senere enn til-dato.');
    where.push('p.lay_from <= ? AND p.lay_to >= ?');
    args.push(to, from);
  }
  const status = q.get('status');
  if (status === 'lager') where.push('p.delivery_id IS NULL AND p.voided = 0 AND p.blocked = 0');

  const limit = Math.min(Number(q.get('limit')) || 200, 1000);
  const sql = `${PALLET_SELECT}
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT ${limit + 1}`;
  const { results } = await env.DB.prepare(sql).bind(...args).all();
  return {
    pallets: results.slice(0, limit).map(shapePallet),
    truncated: results.length > limit,
  };
}

async function getPallet(env, id) {
  const row = await env.DB.prepare(`${PALLET_SELECT} WHERE p.id = ?`).bind(id).first();
  if (!row) throw new HttpError(404, 'Fant ikke pallen.');
  return shapePallet(row);
}

async function palletHistory(env, pallet) {
  // Pallens egen logg + logg for leveringer den har vært knyttet til.
  const { results: own } = await env.DB.prepare(
    `SELECT * FROM audit_log WHERE entity = 'pall' AND entity_id = ? ORDER BY id`,
  )
    .bind(pallet.id)
    .all();
  const deliveryIds = new Set();
  const recallIds = new Set();
  for (const a of own) {
    for (const v of [a.old_values, a.new_values]) {
      if (!v) continue;
      const o = JSON.parse(v);
      if (o.delivery_id) deliveryIds.add(o.delivery_id);
      if (o.recall_id) recallIds.add(o.recall_id);
    }
  }
  let deliveryLog = [];
  let deliveries = [];
  if (deliveryIds.size) {
    const ids = [...deliveryIds];
    deliveryLog = (
      await env.DB.prepare(
        `SELECT * FROM audit_log WHERE entity = 'levering' AND entity_id IN (${placeholders(ids.length)}) ORDER BY id`,
      )
        .bind(...ids)
        .all()
    ).results;
    deliveries = (
      await env.DB.prepare(
        `SELECT d.id, d.order_ref, d.delivery_date, d.store_id, s.name AS store_name
         FROM deliveries d JOIN stores s ON s.id = d.store_id WHERE d.id IN (${placeholders(ids.length)})`,
      )
        .bind(...ids)
        .all()
    ).results;
  }
  let recalls = [];
  if (recallIds.size) {
    const ids = [...recallIds];
    recalls = (
      await env.DB.prepare(`SELECT id, title, opened_date FROM recalls WHERE id IN (${placeholders(ids.length)})`)
        .bind(...ids)
        .all()
    ).results;
  }
  const stores = (await env.DB.prepare('SELECT id, name FROM stores').all()).results;
  const history = [...own, ...deliveryLog].sort((a, b) => a.id - b.id);
  return { history, deliveries, recalls, stores };
}

async function recallOverview(env, id) {
  const recall = await env.DB.prepare('SELECT * FROM recalls WHERE id = ?').bind(id).first();
  if (!recall) throw new HttpError(404, 'Fant ikke tilbakekallingen.');
  const { results } = await env.DB.prepare(
    `${PALLET_SELECT} WHERE p.id IN (SELECT pallet_id FROM recall_pallets WHERE recall_id = ?)
     ORDER BY p.pallet_no`,
  )
    .bind(id)
    .all();
  const pallets = results.map(shapePallet);
  const { results: notices } = await env.DB.prepare(
    'SELECT * FROM recall_notices WHERE recall_id = ?',
  )
    .bind(id)
    .all();
  const storeIds = [...new Set(pallets.filter((p) => p.store_id).map((p) => p.store_id))];
  const storeRows = storeIds.length
    ? (
        await env.DB.prepare(`SELECT * FROM stores WHERE id IN (${placeholders(storeIds.length)})`)
          .bind(...storeIds)
          .all()
      ).results
    : [];

  const stores = storeRows
    .map((s) => {
      const sp = pallets.filter((p) => p.store_id === s.id && p.status === 'levert');
      const byDelivery = new Map();
      for (const p of sp) {
        if (!byDelivery.has(p.delivery_id)) {
          byDelivery.set(p.delivery_id, {
            delivery_id: p.delivery_id,
            delivery_date: p.delivery_date,
            order_ref: p.order_ref,
            pallets: [],
            trays: 0,
          });
        }
        const d = byDelivery.get(p.delivery_id);
        d.pallets.push(p.pallet_no);
        d.trays += p.trays;
      }
      const deliveries = [...byDelivery.values()]
        .map((d) => ({ ...d, eggs: d.trays * EGG_PER_TRAY }))
        .sort((a, b) => a.delivery_date.localeCompare(b.delivery_date));
      const trays = sp.reduce((n, p) => n + p.trays, 0);
      return {
        id: s.id,
        name: s.name,
        phone: s.phone,
        email: s.email,
        pallets: sp.length,
        trays,
        eggs: trays * EGG_PER_TRAY,
        deliveries,
        notice: notices.find((n) => n.store_id === s.id) || null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'nb'));

  const stock = pallets.filter((p) => p.status === 'lager');
  return {
    recall,
    pallets,
    stores,
    summary: {
      pallets: pallets.length,
      delivered: pallets.filter((p) => p.status === 'levert').length,
      in_stock: stock.length,
      in_stock_unblocked: stock.filter((p) => !p.blocked).length,
      voided: pallets.filter((p) => p.status === 'annullert').length,
    },
  };
}

function toCsv(rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n') + '\r\n';
}

const fmtDate = (s) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '');
const STATUS_LABEL = { lager: 'På lager', levert: 'Levert', annullert: 'Annullert' };

function recallCsv(o) {
  const noticeByStore = new Map(o.stores.map((s) => [s.id, s.notice]));
  const rows = [
    [
      'Tilbakekalling', 'Pallnummer', 'Verpet fra', 'Verpet til', 'Brett', 'Egg', 'Leveringsstatus',
      'Sperret', 'Butikk', 'Leveringsdato', 'Ordre-/fakturanr', 'Butikk varslet', 'Varslet dato',
      'Oppfølging', 'Varslet registrert av',
    ],
  ];
  for (const p of o.pallets) {
    const n = p.store_id ? noticeByStore.get(p.store_id) : null;
    rows.push([
      o.recall.title,
      p.pallet_no,
      fmtDate(p.lay_from),
      fmtDate(p.lay_to),
      p.trays,
      p.eggs,
      STATUS_LABEL[p.status],
      p.blocked ? 'Ja' : 'Nei',
      p.store_name || '',
      fmtDate(p.delivery_date),
      p.order_ref || '',
      p.store_id ? (n ? 'Ja' : 'Nei') : '',
      n ? fmtDate(n.notified_date) : '',
      n?.note || '',
      n ? n.updated_by || n.created_by : '',
    ]);
  }
  return toCsv(rows);
}

// ---------------------------------------------------------------------------
// Ruter
// ---------------------------------------------------------------------------

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Ugyldig forespørsel.');
  }
}

async function route(request, env, user) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;
  const today = osloToday();
  const seg = path.split('/').filter(Boolean); // ['api', ...]
  const db = env.DB;

  // --- Bruker ---
  if (path === '/api/me' && method === 'GET') return json({ user, today });

  // --- Butikker ---
  if (path === '/api/stores' && method === 'GET') {
    const { results } = await db.prepare('SELECT * FROM stores ORDER BY name COLLATE NOCASE').all();
    return json({ stores: results });
  }
  if (path === '/api/stores' && method === 'POST') {
    const b = await readBody(request);
    const name = cleanText(b.name, 'Butikknavn', { required: true, max: 100 });
    const phone = cleanText(b.phone, 'Telefon', { max: 40 });
    const email = cleanText(b.email, 'E-post', { max: 120 });
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'E-postadressen ser ikke gyldig ut.');
    const [r] = await write(env, user, 'opprettet', null, [
      db
        .prepare('INSERT INTO stores (name, name_key, phone, email, created_by) VALUES (?, ?, ?, ?, ?) RETURNING *')
        .bind(name, name.toLocaleLowerCase('nb'), phone, email, user),
    ]);
    return json({ store: r.results[0] }, 201);
  }
  if (seg[1] === 'stores' && seg.length === 3 && method === 'PUT') {
    const id = requireId(seg[2], 'butikk');
    const b = await readBody(request);
    const name = cleanText(b.name, 'Butikknavn', { required: true, max: 100 });
    const phone = cleanText(b.phone, 'Telefon', { max: 40 });
    const email = cleanText(b.email, 'E-post', { max: 120 });
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'E-postadressen ser ikke gyldig ut.');
    const reason = requireReason(b);
    const [r] = await write(env, user, 'rettet', reason, [
      db
        .prepare(
          `UPDATE stores SET name = ?, name_key = ?, phone = ?, email = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by = ? WHERE id = ? RETURNING *`,
        )
        .bind(name, name.toLocaleLowerCase('nb'), phone, email, user, id),
    ]);
    if (!r.results.length) throw new HttpError(404, 'Fant ikke butikken.');
    return json({ store: r.results[0] });
  }

  // --- Paller ---
  if (path === '/api/pallets' && method === 'GET') return json(await searchPallets(env, url.searchParams));

  if (path === '/api/pallets' && method === 'POST') {
    const b = await readBody(request);
    const no = requirePalletNo(b.pallet_no);
    const { from, to } = layPeriod(b, today);
    const trays = requireTrays(b.trays);
    const [r] = await write(env, user, 'opprettet', null, [
      db
        .prepare(
          `INSERT INTO pallets (pallet_no, lay_from, lay_to, trays, packed_date, created_by)
           VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .bind(no, from, to, trays, today, user),
    ]);
    return json({ pallet: await getPallet(env, r.results[0].id) }, 201);
  }

  if (seg[1] === 'pallets' && seg.length >= 3) {
    const id = requireId(seg[2], 'pall');

    if (seg.length === 3 && method === 'GET') {
      const pallet = await getPallet(env, id);
      return json({ pallet, ...(await palletHistory(env, pallet)) });
    }

    if (seg.length === 3 && method === 'PUT') {
      // Rett verpeperiode/antall brett. Pallnummer og pakkedato endres ikke.
      const b = await readBody(request);
      const reason = requireReason(b);
      const current = await getPallet(env, id);
      // Egg kan ikke være verpet etter at pallen ble pakket.
      const { from, to } = layPeriod(b, current.packed_date);
      const trays = requireTrays(b.trays);
      if (from === current.lay_from && to === current.lay_to && trays === current.trays) {
        throw new HttpError(400, 'Ingen endringer å lagre.');
      }
      await write(env, user, 'rettet', reason, [
        db
          .prepare(
            `UPDATE pallets SET lay_from = ?, lay_to = ?, trays = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by = ? WHERE id = ?`,
          )
          .bind(from, to, trays, user, id),
      ]);
      return json({ pallet: await getPallet(env, id) });
    }

    const actions = {
      // Feilregistrert pall: annulleres, men beholdes (og nummeret forblir reservert).
      void: ['annullert', 'voided = 1', 'voided = 0'],
      unvoid: ['annullering opphevet', 'voided = 0', 'voided = 1'],
      // Pall ført på feil levering: fjernes fra leveringen. Historikken beholdes i loggen.
      undeliver: ['fjernet fra levering', 'delivery_id = NULL', 'delivery_id IS NOT NULL'],
      unblock: ['sperre opphevet', 'blocked = 0', 'blocked = 1'],
    };
    if (seg.length === 4 && method === 'POST' && actions[seg[3]]) {
      const [label, set, cond] = actions[seg[3]];
      const b = await readBody(request);
      const reason = requireReason(b);
      const [r] = await write(env, user, label, reason, [
        db
          .prepare(
            `UPDATE pallets SET ${set}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by = ?
             WHERE id = ? AND ${cond} RETURNING id`,
          )
          .bind(user, id),
      ]);
      if (!r.results.length) throw new HttpError(409, 'Pallen har ikke riktig status for denne handlingen.');
      return json({ pallet: await getPallet(env, id) });
    }
  }

  // --- Leveringer ---
  if (path === '/api/deliveries' && method === 'POST') {
    const b = await readBody(request);
    const ids = requireIdList(b.pallet_ids, 'pall');
    const storeId = requireId(b.store_id, 'butikk');
    const orderRef = cleanText(b.order_ref, 'Ordre-/fakturanummer', { required: true, max: 60 });
    const date = requireDate(b.delivery_date, 'Leveringsdato');

    const store = await db.prepare('SELECT id, name FROM stores WHERE id = ?').bind(storeId).first();
    if (!store) throw new HttpError(400, 'Velg en butikk.');

    // Forhåndskontroll for tydelige feilmeldinger. Selve garantien ligger i databasen
    // (trigger pallets_guard_delivery), som også stopper samtidige leveringer.
    const { results: sel } = await db
      .prepare(`SELECT id, pallet_no, delivery_id, blocked, voided FROM pallets WHERE id IN (${placeholders(ids.length)})`)
      .bind(...ids)
      .all();
    if (sel.length !== ids.length) throw new HttpError(400, 'En eller flere valgte paller finnes ikke.');
    const bad = sel.filter((p) => p.delivery_id || p.blocked || p.voided);
    if (bad.length) {
      throw new HttpError(
        409,
        `Disse pallene er ikke på lager og kan ikke leveres: ${bad.map((p) => p.pallet_no).join(', ')}. Ingenting ble lagret.`,
      );
    }

    const uid = crypto.randomUUID();
    await write(env, user, 'levert', null, [
      db
        .prepare('INSERT INTO deliveries (uid, store_id, order_ref, delivery_date, created_by) VALUES (?, ?, ?, ?, ?)')
        .bind(uid, storeId, orderRef, date, user),
      db
        .prepare(
          `UPDATE pallets SET delivery_id = (SELECT id FROM deliveries WHERE uid = ?),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by = ?
           WHERE id IN (${placeholders(ids.length)})`,
        )
        .bind(uid, user, ...ids),
    ]);
    const delivery = await db.prepare('SELECT * FROM deliveries WHERE uid = ?').bind(uid).first();
    const { results: pallets } = await db
      .prepare('SELECT pallet_no, trays FROM pallets WHERE delivery_id = ? ORDER BY pallet_no')
      .bind(delivery.id)
      .all();
    if (pallets.length !== ids.length) {
      // Skal ikke kunne skje; varsle tydelig hvis det gjør det.
      throw new HttpError(500, 'Leveringen ble lagret, men antall paller stemmer ikke. Kontroller i Oversikt.');
    }
    return json({ delivery: { ...delivery, store_name: store.name }, pallets }, 201);
  }

  if (seg[1] === 'deliveries' && seg.length === 3 && method === 'PUT') {
    const id = requireId(seg[2], 'levering');
    const b = await readBody(request);
    const reason = requireReason(b);
    const storeId = requireId(b.store_id, 'butikk');
    const orderRef = cleanText(b.order_ref, 'Ordre-/fakturanummer', { required: true, max: 60 });
    const date = requireDate(b.delivery_date, 'Leveringsdato');
    const store = await db.prepare('SELECT id FROM stores WHERE id = ?').bind(storeId).first();
    if (!store) throw new HttpError(400, 'Velg en butikk.');
    const [r] = await write(env, user, 'rettet', reason, [
      db
        .prepare(
          `UPDATE deliveries SET store_id = ?, order_ref = ?, delivery_date = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by = ? WHERE id = ? RETURNING *`,
        )
        .bind(storeId, orderRef, date, user, id),
    ]);
    if (!r.results.length) throw new HttpError(404, 'Fant ikke leveringen.');
    return json({ delivery: r.results[0] });
  }

  // --- Tilbakekalling ---
  if (path === '/api/recalls' && method === 'GET') {
    const { results } = await db
      .prepare(
        `SELECT r.*, (SELECT count(*) FROM recall_pallets rp WHERE rp.recall_id = r.id) AS pallets
         FROM recalls r ORDER BY r.id DESC`,
      )
      .all();
    return json({ recalls: results });
  }

  if (path === '/api/recalls' && method === 'POST') {
    // Merk berørte paller: ny tilbakekalling, eller legg til i eksisterende.
    const b = await readBody(request);
    const ids = requireIdList(b.pallet_ids, 'pall');
    const { results: found } = await db
      .prepare(`SELECT id FROM pallets WHERE id IN (${placeholders(ids.length)})`)
      .bind(...ids)
      .all();
    if (found.length !== ids.length) throw new HttpError(400, 'En eller flere valgte paller finnes ikke.');

    let recallId;
    const stmts = [];
    if (b.recall_id) {
      recallId = requireId(b.recall_id, 'tilbakekalling');
      const exists = await db.prepare('SELECT id FROM recalls WHERE id = ?').bind(recallId).first();
      if (!exists) throw new HttpError(404, 'Fant ikke tilbakekallingen.');
    } else {
      const title = cleanText(b.title, 'Beskrivelse', { max: 120 }) || `Tilbakekalling ${fmtDate(today)}`;
      stmts.push(
        db.prepare('INSERT INTO recalls (title, opened_date, created_by) VALUES (?, ?, ?)').bind(title, today, user),
      );
    }
    // Ny tilbakekalling: id hentes innenfor samme transaksjon (D1 skriver serielt).
    const recallExpr = recallId ? '?' : '(SELECT max(id) FROM recalls)';
    for (const pid of ids) {
      const s = db.prepare(
        `INSERT OR IGNORE INTO recall_pallets (recall_id, pallet_id, created_by) VALUES (${recallExpr}, ?, ?)`,
      );
      stmts.push(recallId ? s.bind(recallId, pid, user) : s.bind(pid, user));
    }
    stmts.push(db.prepare(`SELECT ${recallExpr} AS id`).bind(...(recallId ? [recallId] : [])));
    const res = await write(env, user, 'merket berørt', null, stmts);
    return json({ recall_id: res[res.length - 1].results[0].id }, 201);
  }

  if (seg[1] === 'recalls' && seg.length >= 3) {
    const id = requireId(seg[2], 'tilbakekalling');

    if (seg.length === 3 && method === 'GET') return json(await recallOverview(env, id));

    if (seg.length === 4 && seg[3] === 'csv' && method === 'GET') {
      const o = await recallOverview(env, id);
      const name = `tilbakekalling-${id}-${today}.csv`;
      return new Response(recallCsv(o), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${name}"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    if (seg.length === 4 && seg[3] === 'block' && method === 'POST') {
      // Sperr alle berørte paller som fortsatt er på lager.
      const recall = await db.prepare('SELECT title FROM recalls WHERE id = ?').bind(id).first();
      if (!recall) throw new HttpError(404, 'Fant ikke tilbakekallingen.');
      const [r] = await write(env, user, 'sperret', `Tilbakekalling: ${recall.title}`, [
        db
          .prepare(
            `UPDATE pallets SET blocked = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by = ?
             WHERE id IN (SELECT pallet_id FROM recall_pallets WHERE recall_id = ?)
               AND delivery_id IS NULL AND voided = 0 AND blocked = 0
             RETURNING id`,
          )
          .bind(user, id),
      ]);
      // (meta.changes teller også revisjonslogg-rader fra triggere, derfor RETURNING)
      return json({ blocked: r.results.length });
    }

    if (seg.length === 4 && seg[3] === 'notices' && method === 'POST') {
      const b = await readBody(request);
      const storeId = requireId(b.store_id, 'butikk');
      const date = requireDate(b.notified_date, 'Dato for varsling');
      if (date > today) throw new HttpError(400, 'Dato for varsling kan ikke være i fremtiden.');
      const note = cleanText(b.note, 'Notat', { max: 500 });
      const recall = await db.prepare('SELECT id FROM recalls WHERE id = ?').bind(id).first();
      if (!recall) throw new HttpError(404, 'Fant ikke tilbakekallingen.');
      const [r] = await write(env, user, 'butikk varslet', null, [
        db
          .prepare(
            `INSERT INTO recall_notices (recall_id, store_id, notified_date, note, created_by)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (recall_id, store_id) DO UPDATE SET
               notified_date = excluded.notified_date, note = excluded.note,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by = excluded.created_by
             RETURNING *`,
          )
          .bind(id, storeId, date, note, user),
      ]);
      return json({ notice: r.results[0] }, 201);
    }
  }

  throw new HttpError(404, 'Ukjent adresse.');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      // Ukjente stier: vis appen (statiske filer serveres før Workeren kalles).
      return env.ASSETS.fetch(new Request(new URL('/', url), request));
    }
    try {
      const user = await authenticate(request, env);
      if (!user) return json({ error: 'Ikke innlogget. Last siden på nytt for å logge inn.', login: true }, 401);
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        // Enkel CSRF-beskyttelse: skriveoperasjoner må komme som JSON fra samme opprinnelse.
        const origin = request.headers.get('Origin');
        if (origin && origin !== url.origin) throw new HttpError(403, 'Forespørselen ble avvist.');
        if (!(request.headers.get('Content-Type') || '').includes('application/json'))
          throw new HttpError(415, 'Forespørselen må være JSON.');
      }
      return await route(request, env, user);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...(e.extra || {}) }, e.status);
      if (e?.status) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Uventet feil på serveren. Ingenting ble lagret.' }, 500);
    }
  },
};
