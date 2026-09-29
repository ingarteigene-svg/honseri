// Pallsporing – forretningslogikk (ren JavaScript, ingen nettverk).
//
// Excel-arket «Hendelser» er en logg der appen bare legger til rader. Gjeldende
// status for paller, leveringer, butikker og tilbakekallinger regnes ut ved å
// spille av loggen i radrekkefølge (replay). Reglene håndheves her:
//   * Første registrering av et pallnummer vinner – senere registreringer avvises.
//   * En levering godtas bare hvis ALLE pallene er på lager i det øyeblikket
//     raden kommer i loggen – ellers avvises hele leveringen.
//   * Rettelser legges til som nye rader med tidligere verdier; ingenting overskrives.
// Fordi Excel legger nye rader etter hverandre i én rekkefølge, gir dette samme
// resultat for alle brukere, også når to lagrer samtidig.

export const EGG_PER_TRAY = 30;
export const TABLE_NAME = 'Hendelser';

// Kolonner i Excel-tabellen (rekkefølgen må ikke endres).
export const COLUMNS = [
  ['id', 'Hendelse-ID'],
  ['ts', 'Tidspunkt'],
  ['user', 'Bruker'],
  ['type', 'Hendelse'],
  ['pallet', 'Pallnummer'],
  ['lay_from', 'Verpet fra'],
  ['lay_to', 'Verpet til'],
  ['trays', 'Brett'],
  ['packed', 'Pakkedato'],
  ['store_id', 'Butikk-ID'],
  ['store', 'Butikk'],
  ['phone', 'Telefon'],
  ['email', 'E-post'],
  ['order', 'Ordre-/fakturanr'],
  ['delivery_date', 'Leveringsdato'],
  ['delivery_id', 'Levering-ID'],
  ['recall_id', 'Tilbakekalling-ID'],
  ['notified', 'Varslet dato'],
  ['text', 'Tekst'],
  ['reason', 'Årsak'],
  ['previous', 'Tidligere verdier'],
  ['ref', 'Gjelder'],
  ['checksum', 'Sjekksum'],
];
export const HEADERS = COLUMNS.map((c) => c[1]);
const KEYS = COLUMNS.map((c) => c[0]);
const DATE_KEYS = new Set(['lay_from', 'lay_to', 'packed', 'delivery_date', 'notified']);

export const T = {
  REGISTERED: 'PALL REGISTRERT',
  CORRECTED: 'PALL RETTET',
  VOIDED: 'PALL ANNULLERT',
  UNVOIDED: 'ANNULLERING OPPHEVET',
  DELIVERED: 'LEVERT',
  UNDELIVERED: 'FJERNET FRA LEVERING',
  DELIVERY_CORRECTED: 'LEVERING RETTET',
  STORE_CREATED: 'BUTIKK OPPRETTET',
  STORE_CORRECTED: 'BUTIKK RETTET',
  RECALL_CREATED: 'TILBAKEKALLING OPPRETTET',
  AFFECTED: 'MERKET BERØRT',
  BLOCKED: 'SPERRET',
  UNBLOCKED: 'SPERRE OPPHEVET',
  NOTIFIED: 'BUTIKK VARSLET',
  REJECTED: 'AVVIST',
};

export class UserError extends Error {}

// ---------------------------------------------------------------------------
// Hjelpere
// ---------------------------------------------------------------------------

/** Dagens dato i Norge (ÅÅÅÅ-MM-DD). */
export function osloToday(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' }).format(now);
}

/** Tidspunkt i norsk tid, «ÅÅÅÅ-MM-DD TT:MM:SS». */
export function osloNow(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(now).replace(',', '');
}

export function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** «007» og « 7 » er samme pall: fjerner mellomrom, store bokstaver, ledende nuller i rene tall. */
export function normalizePalletNo(input) {
  let v = String(input ?? '').replace(/\s+/g, '').toUpperCase();
  if (/^\d+$/.test(v)) v = v.replace(/^0+(?=\d)/, '');
  return v;
}

export function isValidPalletNo(v) {
  return /^[0-9A-ZÆØÅ\-\/.]{1,20}$/.test(v);
}

export function isPositiveInt(n) {
  return Number.isInteger(n) && n > 0 && n <= 5000;
}

const clean = (s) => (typeof s === 'string' ? s.trim().replace(/\s+/g, ' ') : s == null ? '' : String(s).trim());
const storeKey = (name) => clean(name).toLocaleLowerCase('nb');

export function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => (b % 36).toString(36)).join('').toUpperCase();
}

const fmtDate = (s) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '');

// ---------------------------------------------------------------------------
// Rader ↔ hendelser
// ---------------------------------------------------------------------------

/** Excel-serienummer → ÅÅÅÅ-MM-DD (hvis noen har skrevet en dato direkte i arket). */
function serialToIso(n, withTime = false) {
  const ms = Date.UTC(1899, 11, 30) + Math.round(n * 86400000);
  const iso = new Date(ms).toISOString();
  return withTime ? iso.slice(0, 19).replace('T', ' ') : iso.slice(0, 10);
}

/** Leser én rad fra Excel (verdiene slik Graph returnerer dem) til en hendelse. */
export function rowToEvent(values) {
  const e = {};
  KEYS.forEach((k, i) => {
    let v = values[i];
    if (v == null) v = '';
    if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1);
    if (k === 'trays') {
      e[k] = v === '' ? null : Number(v);
    } else if (typeof v === 'number' && DATE_KEYS.has(k)) {
      e[k] = serialToIso(v);
    } else if (typeof v === 'number' && k === 'ts') {
      e[k] = serialToIso(v, true);
    } else {
      e[k] = String(v).trim();
    }
  });
  return e;
}

/** Hendelse → radverdier (uten sjekksum-behandling). */
export function eventToValues(e) {
  return KEYS.map((k) => {
    const v = e[k];
    if (k === 'trays') return v == null || v === '' ? '' : Number(v);
    return v == null ? '' : String(v);
  });
}

function canonical(e) {
  return KEYS.filter((k) => k !== 'checksum')
    .map((k) => (e[k] == null ? '' : String(e[k])))
    .join('␟');
}

/** Sjekksum per rad. Avslører rader som er endret direkte i Excel. */
export async function checksum(e) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(e)));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function withChecksum(e) {
  return { ...e, checksum: await checksum(e) };
}

// ---------------------------------------------------------------------------
// Avspilling av loggen
// ---------------------------------------------------------------------------

const group = (id) => String(id).split('.')[0];

/**
 * Spiller av hendelsene i rekkefølge og returnerer gjeldende tilstand.
 * events: [{...hendelse, row}] i samme rekkefølge som i Excel.
 */
export function replay(events) {
  const pallets = new Map();
  const deliveries = new Map();
  const stores = new Map();
  const recalls = new Map();
  const notices = new Map();
  const results = new Map(); // hendelse-ID → { ok, reason }
  const log = [];

  const seen = new Set();
  const list = [];
  for (const e of events) {
    if (!e.id || seen.has(e.id)) continue; // tomme rader og duplikater (f.eks. etter nettverksfeil)
    seen.add(e.id);
    list.push(e);
  }
  // Grupper (én handling kan være flere rader, f.eks. levering av flere paller)
  const groups = new Map();
  for (const e of list) {
    const g = group(e.id);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(e);
  }

  const done = new Set();
  const reject = (e, reason) => results.set(e.id, { ok: false, reason });
  const accept = (e) => results.set(e.id, { ok: true });
  const inStock = (p) => p && !p.voided && !p.delivery_id && !p.blocked;

  function applyOne(e) {
    const p = e.pallet ? pallets.get(normalizePalletNo(e.pallet)) : null;
    switch (e.type) {
      case T.REGISTERED: {
        const no = normalizePalletNo(e.pallet);
        if (!isValidPalletNo(no)) return reject(e, 'Ugyldig pallnummer.');
        if (pallets.has(no)) {
          const first = pallets.get(no);
          return reject(e, `Pallnummer ${no} er allerede registrert (${first.created_at} av ${first.created_by}).`);
        }
        if (!isDate(e.lay_from) || !isDate(e.lay_to)) return reject(e, 'Ugyldig verpedato.');
        if (e.lay_from > e.lay_to) return reject(e, 'Verpedato fra er senere enn til.');
        if (!isPositiveInt(e.trays)) return reject(e, 'Antall brett må være et positivt heltall.');
        if (isDate(e.packed) && e.lay_to > e.packed) return reject(e, 'Verpedato er senere enn pakkedato.');
        pallets.set(no, {
          no, lay_from: e.lay_from, lay_to: e.lay_to, trays: e.trays, packed: e.packed,
          created_by: e.user, created_at: e.ts, seq: e.row ?? pallets.size,
          delivery_id: null, blocked: false, voided: false, recalls: new Set(), deliveries: new Set(),
        });
        return accept(e);
      }
      case T.CORRECTED: {
        if (!p) return reject(e, 'Ukjent pall.');
        if (p.voided) return reject(e, 'Pallen er annullert.');
        if (!isDate(e.lay_from) || !isDate(e.lay_to) || e.lay_from > e.lay_to) return reject(e, 'Ugyldig verpeperiode.');
        if (isDate(p.packed) && e.lay_to > p.packed) return reject(e, 'Verpedato er senere enn pakkedato.');
        if (!isPositiveInt(e.trays)) return reject(e, 'Antall brett må være et positivt heltall.');
        Object.assign(p, { lay_from: e.lay_from, lay_to: e.lay_to, trays: e.trays });
        return accept(e);
      }
      case T.VOIDED:
        if (!p) return reject(e, 'Ukjent pall.');
        if (p.voided) return reject(e, 'Pallen er allerede annullert.');
        if (p.delivery_id) return reject(e, 'En levert pall kan ikke annulleres. Fjern den fra leveringen først.');
        p.voided = true;
        return accept(e);
      case T.UNVOIDED:
        if (!p || !p.voided) return reject(e, 'Pallen er ikke annullert.');
        p.voided = false;
        return accept(e);
      case T.UNDELIVERED:
        if (!p || !p.delivery_id) return reject(e, 'Pallen er ikke levert.');
        p.delivery_id = null;
        return accept(e);
      case T.DELIVERY_CORRECTED: {
        const d = deliveries.get(e.delivery_id);
        if (!d) return reject(e, 'Ukjent levering.');
        if (!stores.has(e.store_id)) return reject(e, 'Ukjent butikk.');
        if (!clean(e.order)) return reject(e, 'Ordre-/fakturanummer mangler.');
        if (!isDate(e.delivery_date)) return reject(e, 'Ugyldig leveringsdato.');
        Object.assign(d, { store_id: e.store_id, order: clean(e.order), date: e.delivery_date });
        return accept(e);
      }
      case T.STORE_CREATED: {
        if (!e.store_id || stores.has(e.store_id)) return reject(e, 'Ugyldig butikk-ID.');
        if (!clean(e.store)) return reject(e, 'Butikknavn mangler.');
        if ([...stores.values()].some((s) => storeKey(s.name) === storeKey(e.store)))
          return reject(e, `Butikken «${clean(e.store)}» finnes allerede.`);
        stores.set(e.store_id, { id: e.store_id, name: clean(e.store), phone: e.phone, email: e.email });
        return accept(e);
      }
      case T.STORE_CORRECTED: {
        const s = stores.get(e.store_id);
        if (!s) return reject(e, 'Ukjent butikk.');
        if (!clean(e.store)) return reject(e, 'Butikknavn mangler.');
        if ([...stores.values()].some((o) => o.id !== s.id && storeKey(o.name) === storeKey(e.store)))
          return reject(e, `Butikken «${clean(e.store)}» finnes allerede.`);
        Object.assign(s, { name: clean(e.store), phone: e.phone, email: e.email });
        return accept(e);
      }
      case T.RECALL_CREATED:
        if (!e.recall_id || recalls.has(e.recall_id)) return reject(e, 'Ugyldig tilbakekalling-ID.');
        recalls.set(e.recall_id, {
          id: e.recall_id, title: clean(e.text) || 'Tilbakekalling', date: String(e.ts).slice(0, 10),
          created_by: e.user, pallets: new Set(),
        });
        return accept(e);
      case T.AFFECTED: {
        const r = recalls.get(e.recall_id);
        if (!r) return reject(e, 'Ukjent tilbakekalling.');
        if (!p) return reject(e, 'Ukjent pall.');
        r.pallets.add(p.no);
        p.recalls.add(r.id);
        return accept(e);
      }
      case T.BLOCKED:
        if (!p) return reject(e, 'Ukjent pall.');
        if (!inStock(p)) return reject(e, `Pall ${p.no} er ikke på lager og kan ikke sperres.`);
        p.blocked = true;
        return accept(e);
      case T.UNBLOCKED:
        if (!p || !p.blocked) return reject(e, 'Pallen er ikke sperret.');
        p.blocked = false;
        return accept(e);
      case T.NOTIFIED: {
        if (!recalls.has(e.recall_id)) return reject(e, 'Ukjent tilbakekalling.');
        if (!stores.has(e.store_id)) return reject(e, 'Ukjent butikk.');
        if (!isDate(e.notified)) return reject(e, 'Ugyldig dato for varsling.');
        notices.set(`${e.recall_id}|${e.store_id}`, { date: e.notified, note: e.text, by: e.user, at: e.ts });
        return accept(e);
      }
      case T.REJECTED:
        return accept(e); // bare en merknad i loggen
      default:
        return reject(e, `Ukjent hendelse «${e.type}».`);
    }
  }

  function applyDelivery(rows) {
    // Alt-eller-ingenting: alle pallene må være på lager.
    const first = rows[0];
    const did = group(first.id);
    let reason = null;
    const nos = new Set();
    if (!stores.has(first.store_id)) reason = 'Ukjent butikk.';
    else if (!clean(first.order)) reason = 'Ordre-/fakturanummer mangler.';
    else if (!isDate(first.delivery_date)) reason = 'Ugyldig leveringsdato.';
    for (const r of rows) {
      if (reason) break;
      const p = pallets.get(normalizePalletNo(r.pallet));
      if (r.type !== T.DELIVERED || r.store_id !== first.store_id || r.order !== first.order) reason = 'Ugyldig levering.';
      else if (!p) reason = `Pall ${r.pallet} finnes ikke.`;
      else if (nos.has(p.no)) reason = `Pall ${p.no} er valgt to ganger.`;
      else if (p.voided) reason = `Pall ${p.no} er annullert.`;
      else if (p.blocked) reason = `Pall ${p.no} er sperret.`;
      else if (p.delivery_id) {
        const d = deliveries.get(p.delivery_id);
        reason = `Pall ${p.no} er allerede levert (${stores.get(d.store_id)?.name}, ordre ${d.order}, registrert av ${d.created_by}).`;
      }
      if (p) nos.add(p.no);
    }
    if (reason) {
      for (const r of rows) reject(r, reason);
      return;
    }
    deliveries.set(did, {
      id: did, store_id: first.store_id, order: clean(first.order), date: first.delivery_date,
      created_by: first.user, created_at: first.ts,
    });
    for (const r of rows) {
      const p = pallets.get(normalizePalletNo(r.pallet));
      p.delivery_id = did;
      p.deliveries.add(did);
      accept(r);
    }
  }

  for (const e of list) {
    const g = group(e.id);
    if (done.has(g)) continue;
    done.add(g);
    const rows = groups.get(g);
    if (rows[0].type === T.DELIVERED) applyDelivery(rows);
    else rows.forEach(applyOne);
    log.push(...rows);
  }

  return { pallets, deliveries, stores, recalls, notices, results, log };
}

// ---------------------------------------------------------------------------
// Visninger
// ---------------------------------------------------------------------------

export function palletView(state, p) {
  const d = p.delivery_id ? state.deliveries.get(p.delivery_id) : null;
  return {
    no: p.no, lay_from: p.lay_from, lay_to: p.lay_to, trays: p.trays, eggs: p.trays * EGG_PER_TRAY,
    packed: p.packed, created_by: p.created_by, created_at: p.created_at, seq: p.seq,
    status: p.voided ? 'annullert' : p.delivery_id ? 'levert' : 'lager',
    blocked: p.blocked, voided: p.voided, recalls: [...p.recalls],
    delivery_id: p.delivery_id, store_id: d?.store_id || null,
    store_name: d ? state.stores.get(d.store_id)?.name || '' : '',
    order: d?.order || '', delivery_date: d?.date || '',
  };
}

/** Søk. Datosøk: alle paller der verpeperioden overlapper søkeperioden. */
export function search(state, q = {}) {
  let from = q.from || q.to || '';
  let to = q.to || q.from || '';
  if (from && (!isDate(from) || !isDate(to))) throw new UserError('Ugyldig dato i søket.');
  if (from && from > to) throw new UserError('Fra-dato kan ikke være senere enn til-dato.');
  const no = q.no ? normalizePalletNo(q.no) : '';
  const order = q.order ? clean(q.order).toLowerCase() : '';
  const out = [];
  for (const p of state.pallets.values()) {
    const v = palletView(state, p);
    if (no && !v.no.includes(no)) continue;
    if (order && !v.order.toLowerCase().includes(order)) continue;
    if (q.store && v.store_id !== q.store) continue;
    if (from && !(v.lay_from <= to && v.lay_to >= from)) continue;
    if (q.status === 'lager' && !(v.status === 'lager' && !v.blocked)) continue;
    out.push(v);
  }
  out.sort((a, b) => b.seq - a.seq);
  return out;
}

export function storeList(state) {
  return [...state.stores.values()].sort((a, b) => a.name.localeCompare(b.name, 'nb'));
}

export function recallList(state) {
  return [...state.recalls.values()].reverse().map((r) => ({ ...r, count: r.pallets.size }));
}

/** Historikk for én pall: egne hendelser + rettelser av leveringer den har vært med i. */
export function palletHistory(state, no) {
  const p = state.pallets.get(no);
  if (!p) return [];
  return state.log
    .filter((e) => normalizePalletNo(e.pallet) === no ||
      (e.type === T.DELIVERY_CORRECTED && p.deliveries.has(e.delivery_id)))
    .map((e) => ({ ...e, result: state.results.get(e.id) }));
}

export function recallOverview(state, id) {
  const recall = state.recalls.get(id);
  if (!recall) throw new UserError('Fant ikke tilbakekallingen.');
  const pallets = [...recall.pallets].map((no) => palletView(state, state.pallets.get(no)))
    .sort((a, b) => a.no.localeCompare(b.no, 'nb', { numeric: true }));
  const byStore = new Map();
  for (const p of pallets.filter((x) => x.status === 'levert')) {
    if (!byStore.has(p.store_id)) byStore.set(p.store_id, new Map());
    const m = byStore.get(p.store_id);
    if (!m.has(p.delivery_id)) m.set(p.delivery_id, { delivery_id: p.delivery_id, date: p.delivery_date, order: p.order, pallets: [], trays: 0 });
    const d = m.get(p.delivery_id);
    d.pallets.push(p.no);
    d.trays += p.trays;
  }
  const stores = [...byStore.entries()].map(([sid, m]) => {
    const s = state.stores.get(sid);
    const deliveries = [...m.values()].sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({ ...d, eggs: d.trays * EGG_PER_TRAY }));
    const trays = deliveries.reduce((n, d) => n + d.trays, 0);
    return {
      id: sid, name: s?.name || sid, phone: s?.phone || '', email: s?.email || '',
      pallets: deliveries.reduce((n, d) => n + d.pallets.length, 0), trays, eggs: trays * EGG_PER_TRAY,
      deliveries, notice: state.notices.get(`${id}|${sid}`) || null,
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'nb'));
  const stock = pallets.filter((p) => p.status === 'lager');
  return {
    recall, pallets, stores,
    summary: {
      pallets: pallets.length,
      delivered: pallets.filter((p) => p.status === 'levert').length,
      in_stock: stock.length,
      in_stock_unblocked: stock.filter((p) => !p.blocked).length,
    },
  };
}

export function recallCsv(o) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const notice = new Map(o.stores.map((s) => [s.id, s.notice]));
  const label = { lager: 'På lager', levert: 'Levert', annullert: 'Annullert' };
  const rows = [[
    'Tilbakekalling', 'Pallnummer', 'Verpet fra', 'Verpet til', 'Brett', 'Egg', 'Leveringsstatus', 'Sperret',
    'Butikk', 'Leveringsdato', 'Ordre-/fakturanr', 'Butikk varslet', 'Varslet dato', 'Oppfølging', 'Varslet registrert av',
  ]];
  for (const p of o.pallets) {
    const n = p.store_id ? notice.get(p.store_id) : null;
    rows.push([
      o.recall.title, p.no, fmtDate(p.lay_from), fmtDate(p.lay_to), p.trays, p.eggs, label[p.status],
      p.blocked ? 'Ja' : 'Nei', p.store_name, fmtDate(p.delivery_date), p.order,
      p.store_id ? (n ? 'Ja' : 'Nei') : '', n ? fmtDate(n.date) : '', n?.note || '', n?.by || '',
    ]);
  }
  return '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Kommandoer: validerer mot gjeldende tilstand og lager nye hendelser.
// (Endelig kontroll skjer når loggen spilles av etter lagring.)
// ---------------------------------------------------------------------------

function base(ctx, type, gid, n = 1) {
  return { id: `${gid}.${n}`, ts: ctx.now || osloNow(), user: ctx.user, type };
}

function requireReason(reason) {
  const r = clean(reason);
  if (!r) throw new UserError('Skriv en kort årsak til endringen.');
  if (r.length > 300) throw new UserError('Årsaken kan være maks 300 tegn.');
  return r;
}

function requirePallet(state, no) {
  const p = state.pallets.get(normalizePalletNo(no));
  if (!p) throw new UserError('Fant ikke pallen.');
  return p;
}

function layPeriod(input, maxDate) {
  const from = input.lay_from;
  const to = input.lay_to || from;
  if (!isDate(from)) throw new UserError('Velg verpedato.');
  if (!isDate(to)) throw new UserError('Ugyldig verpedato til.');
  if (from > to) throw new UserError('Verpedato fra kan ikke være senere enn verpedato til.');
  if (to > maxDate) throw new UserError('Verpedato kan ikke være senere enn pakkedato.');
  return { from, to };
}

function requireTrays(v) {
  const n = typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : v;
  if (!isPositiveInt(n)) throw new UserError('Antall brett må være et positivt heltall.');
  return n;
}

const describe = (obj) => Object.entries(obj).map(([k, v]) => `${k}: ${v ?? ''}`).join('; ');

export const cmd = {
  registerPallet(state, input, ctx) {
    const no = normalizePalletNo(input.pallet_no);
    if (!no) throw new UserError('Skriv inn pallnummer.');
    if (!isValidPalletNo(no)) throw new UserError('Pallnummer kan bare inneholde tall, bokstaver og bindestrek (maks 20 tegn).');
    const today = ctx.today || osloToday();
    const { from, to } = layPeriod(input, today);
    const trays = requireTrays(input.trays);
    if (state?.pallets.has(no)) {
      const p = state.pallets.get(no);
      throw new UserError(`Pallnummer ${no} er allerede registrert (${p.created_at} av ${p.created_by}). Et pallnummer kan aldri brukes på nytt.`);
    }
    return [{ ...base(ctx, T.REGISTERED, newId()), pallet: no, lay_from: from, lay_to: to, trays, packed: today }];
  },

  correctPallet(state, no, input, ctx) {
    const p = requirePallet(state, no);
    const reason = requireReason(input.reason);
    const { from, to } = layPeriod(input, p.packed);
    const trays = requireTrays(input.trays);
    if (from === p.lay_from && to === p.lay_to && trays === p.trays) throw new UserError('Ingen endringer å lagre.');
    return [{
      ...base(ctx, T.CORRECTED, newId()), pallet: p.no, lay_from: from, lay_to: to, trays, reason,
      previous: describe({ 'Verpet fra': fmtDate(p.lay_from), 'Verpet til': fmtDate(p.lay_to), Brett: p.trays }),
    }];
  },

  palletAction(state, no, action, reasonInput, ctx) {
    const p = requirePallet(state, no);
    const reason = requireReason(reasonInput);
    const type = { void: T.VOIDED, unvoid: T.UNVOIDED, undeliver: T.UNDELIVERED, unblock: T.UNBLOCKED }[action];
    if (!type) throw new UserError('Ukjent handling.');
    const e = { ...base(ctx, type, newId()), pallet: p.no, reason };
    if (action === 'undeliver') {
      if (!p.delivery_id) throw new UserError('Pallen er ikke levert.');
      const d = state.deliveries.get(p.delivery_id);
      e.delivery_id = p.delivery_id;
      e.previous = describe({ Butikk: state.stores.get(d.store_id)?.name, Ordre: d.order, Leveringsdato: fmtDate(d.date) });
    }
    if (action === 'void' && p.delivery_id) throw new UserError('En levert pall kan ikke annulleres. Fjern den fra leveringen først.');
    return [e];
  },

  deliver(state, input, ctx) {
    const nos = [...new Set((input.pallets || []).map(normalizePalletNo))];
    if (!nos.length) throw new UserError('Velg minst én pall.');
    const store = state.stores.get(input.store_id);
    if (!store) throw new UserError('Velg butikk.');
    const order = clean(input.order);
    if (!order) throw new UserError('Skriv inn ordre-/fakturanummer.');
    if (order.length > 60) throw new UserError('Ordre-/fakturanummer kan være maks 60 tegn.');
    if (!isDate(input.date)) throw new UserError('Velg leveringsdato.');
    const bad = nos.filter((no) => {
      const p = state.pallets.get(no);
      return !p || p.voided || p.blocked || p.delivery_id;
    });
    if (bad.length) throw new UserError(`Disse pallene er ikke på lager og kan ikke leveres: ${bad.join(', ')}.`);
    const gid = newId();
    return nos.map((no, i) => ({
      ...base(ctx, T.DELIVERED, gid, i + 1), pallet: no, store_id: store.id, store: store.name,
      order, delivery_date: input.date, delivery_id: gid, trays: state.pallets.get(no).trays,
    }));
  },

  correctDelivery(state, deliveryId, input, ctx) {
    const d = state.deliveries.get(deliveryId);
    if (!d) throw new UserError('Fant ikke leveringen.');
    const reason = requireReason(input.reason);
    const store = state.stores.get(input.store_id);
    if (!store) throw new UserError('Velg butikk.');
    const order = clean(input.order);
    if (!order) throw new UserError('Skriv inn ordre-/fakturanummer.');
    if (!isDate(input.date)) throw new UserError('Velg leveringsdato.');
    if (store.id === d.store_id && order === d.order && input.date === d.date) throw new UserError('Ingen endringer å lagre.');
    return [{
      ...base(ctx, T.DELIVERY_CORRECTED, newId()), delivery_id: d.id, store_id: store.id, store: store.name,
      order, delivery_date: input.date, reason,
      previous: describe({ Butikk: state.stores.get(d.store_id)?.name, Ordre: d.order, Leveringsdato: fmtDate(d.date) }),
    }];
  },

  createStore(state, input, ctx) {
    const name = clean(input.name);
    if (!name) throw new UserError('Skriv inn butikknavn.');
    if (name.length > 100) throw new UserError('Butikknavn kan være maks 100 tegn.');
    const email = clean(input.email);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UserError('E-postadressen ser ikke gyldig ut.');
    if ([...state.stores.values()].some((s) => storeKey(s.name) === storeKey(name)))
      throw new UserError(`Butikken «${name}» finnes allerede.`);
    return [{ ...base(ctx, T.STORE_CREATED, newId()), store_id: `B-${newId().slice(0, 6)}`, store: name, phone: clean(input.phone), email }];
  },

  correctStore(state, storeId, input, ctx) {
    const s = state.stores.get(storeId);
    if (!s) throw new UserError('Fant ikke butikken.');
    const reason = requireReason(input.reason);
    const name = clean(input.name);
    if (!name) throw new UserError('Skriv inn butikknavn.');
    const email = clean(input.email);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UserError('E-postadressen ser ikke gyldig ut.');
    if ([...state.stores.values()].some((o) => o.id !== s.id && storeKey(o.name) === storeKey(name)))
      throw new UserError(`Butikken «${name}» finnes allerede.`);
    return [{
      ...base(ctx, T.STORE_CORRECTED, newId()), store_id: s.id, store: name, phone: clean(input.phone), email, reason,
      previous: describe({ Navn: s.name, Telefon: s.phone, 'E-post': s.email }),
    }];
  },

  markAffected(state, input, ctx) {
    const nos = [...new Set((input.pallets || []).map(normalizePalletNo))];
    if (!nos.length) throw new UserError('Velg minst én pall.');
    for (const no of nos) requirePallet(state, no);
    const gid = newId();
    const events = [];
    let recallId = input.recall_id;
    if (recallId) {
      if (!state.recalls.has(recallId)) throw new UserError('Fant ikke tilbakekallingen.');
    } else {
      recallId = `T-${newId().slice(0, 6)}`;
      const title = clean(input.title) || `Tilbakekalling ${fmtDate(ctx.today || osloToday())}`;
      if (title.length > 120) throw new UserError('Beskrivelsen kan være maks 120 tegn.');
      events.push({ ...base(ctx, T.RECALL_CREATED, gid, 1), recall_id: recallId, text: title });
    }
    const already = recallId && state.recalls.get(recallId)?.pallets || new Set();
    for (const no of nos.filter((n) => !already.has(n))) {
      events.push({ ...base(ctx, T.AFFECTED, gid, events.length + 1), recall_id: recallId, pallet: no });
    }
    if (!events.length) throw new UserError('Pallene er allerede merket i denne tilbakekallingen.');
    return { recallId, events };
  },

  blockRecall(state, recallId, ctx) {
    const r = state.recalls.get(recallId);
    if (!r) throw new UserError('Fant ikke tilbakekallingen.');
    const nos = [...r.pallets].filter((no) => {
      const p = state.pallets.get(no);
      return p && !p.voided && !p.delivery_id && !p.blocked;
    });
    if (!nos.length) throw new UserError('Ingen berørte paller på lager å sperre.');
    const gid = newId();
    return nos.map((no, i) => ({
      ...base(ctx, T.BLOCKED, gid, i + 1), pallet: no, recall_id: recallId, reason: `Tilbakekalling: ${r.title}`,
    }));
  },

  notify(state, input, ctx) {
    if (!state.recalls.has(input.recall_id)) throw new UserError('Fant ikke tilbakekallingen.');
    if (!state.stores.has(input.store_id)) throw new UserError('Fant ikke butikken.');
    if (!isDate(input.date)) throw new UserError('Velg dato for varsling.');
    if (input.date > (ctx.today || osloToday())) throw new UserError('Dato for varsling kan ikke være i fremtiden.');
    const note = clean(input.note);
    if (note.length > 500) throw new UserError('Notatet kan være maks 500 tegn.');
    const prev = state.notices.get(`${input.recall_id}|${input.store_id}`);
    return [{
      ...base(ctx, T.NOTIFIED, newId()), recall_id: input.recall_id, store_id: input.store_id,
      store: state.stores.get(input.store_id).name, notified: input.date, text: note,
      previous: prev ? describe({ Dato: fmtDate(prev.date), Notat: prev.note }) : '',
    }];
  },

  rejected(original, reason, ctx) {
    return { ...base(ctx, T.REJECTED, newId()), pallet: original.pallet || '', ref: original.id, text: reason };
  },
};
