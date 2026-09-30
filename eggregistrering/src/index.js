// Hønseri – dagleg eggregistrering. API (Cloudflare Worker + D1).
// Statiske filer (public/) blir serverte direkte av Cloudflare; alt under /api/ går hit.
// Heilt åtskild frå Pallsporing: eigen Worker, eigen database og eiga innlogging.

import { authenticate } from './auth.js';
import { getVapid, sendPush } from './push.js';

const REMINDER_HOUR = 17; // norsk tid
const APP_VERSION = '3.1';

// ---------------------------------------------------------------------------
// Hjelparar
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

/** Dagens dato i Noreg som ÅÅÅÅ-MM-DD. */
export function osloToday(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' }).format(now);
}

/** Klokketime i Noreg (0–23). */
export function osloHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', hourCycle: 'h23' }).format(now));
}

function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Felta i API-et (same namn som i appen) og kolonnane i databasen.
const INT_FIELDS = ['egg', 'store', 'vanlige', 'kartonger', 'klink', 'pall200', 'pall228', 'dode'];
const DEC_FIELDS = ['for', 'vann', 'timer'];
const COLUMN = { for: 'silo' }; // «for» er eit reservert ord i SQL
const col = (k) => COLUMN[k] || k;
const LABEL = {
  egg: 'Antall egg', store: 'Store brett', vanlige: 'Vanlege brett', kartonger: 'Kartongar', klink: 'Klink brett',
  pall200: '200-paller', pall228: '228-paller', dode: 'Døde høner', for: 'For på siloen', vann: 'Vassmålar', timer: 'Timar arbeidd',
};
const MAX = {
  egg: 200000, store: 10000, vanlige: 10000, kartonger: 10000, klink: 10000, pall200: 100, pall228: 100,
  dode: 10000, for: 1000000, vann: 100000000, timer: 24,
};

function toNumber(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).trim().replace(/\s/g, '').replace(',', '.');
  return s === '' ? 0 : Number(s);
}

function cleanText(v, max) {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  return s.length > max ? s.slice(0, max) : s;
}

/** Validerer ei registrering frå appen. Kastar HttpError med forståeleg melding. */
export function cleanEntry(b, today) {
  const uid = typeof b?.id === 'number' ? String(b.id) : cleanText(b?.id, 64);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(uid)) throw new HttpError(400, 'Ugyldig id på registreringa.');
  if (!isDate(b.dato)) throw new HttpError(400, 'Dato manglar eller er ugyldig.');
  if (b.dato > today) throw new HttpError(400, 'Dato kan ikkje vere fram i tid.');
  const e = { uid, dato: b.dato, navn: cleanText(b.navn, 60), kommentar: cleanText(b.kommentar, 1000) || null };
  for (const k of INT_FIELDS) {
    const v = toNumber(b[k]);
    if (!Number.isInteger(v)) throw new HttpError(400, `${LABEL[k]} må vere eit heilt tal.`);
    if (v < 0 || v > MAX[k]) throw new HttpError(400, `${LABEL[k]} er utanfor gyldig område.`);
    e[k] = v;
  }
  for (const k of DEC_FIELDS) {
    const v = toNumber(b[k]);
    if (!Number.isFinite(v)) throw new HttpError(400, `${LABEL[k]} må vere eit tal.`);
    if (v < 0 || v > MAX[k]) throw new HttpError(400, `${LABEL[k]} er utanfor gyldig område.`);
    e[k] = Math.round(v * 100) / 100;
  }
  if (![...INT_FIELDS, ...DEC_FIELDS].some((k) => e[k] > 0)) throw new HttpError(400, 'Fyll inn minst eitt felt.');
  return e;
}

/** Databaserad → JSON i same form som appen brukar. */
function toApi(r) {
  const o = { id: r.uid, navn: r.navn, dato: r.dato, kommentar: r.kommentar || '' };
  for (const k of [...INT_FIELDS, ...DEC_FIELDS]) o[k] = r[col(k)];
  o.createdBy = r.created_by;
  o.createdAt = r.created_at;
  o.updatedBy = r.updated_by || null;
  o.updatedAt = r.updated_at || null;
  return o;
}

function dbError(e) {
  const m = String(e?.message || e);
  if (m.includes('SLETTING_IKKE_TILLATT')) return new HttpError(409, 'Sletting er ikkje tillate.');
  if (m.includes('ID_LAAST')) return new HttpError(409, 'Id-en til ei registrering kan ikkje endrast.');
  if (m.includes('CHECK constraint failed')) return new HttpError(400, 'Ugyldige verdiar. Kontroller felta.');
  console.error('DB-feil:', m);
  return new HttpError(500, 'Lagring mislukkast i databasen. Ingenting vart lagra, prøv igjen.');
}

/**
 * Køyrer setningane som éin transaksjon, med «kven» sett i ctx slik at
 * revisjonsloggen får rett brukar. Returnerer resultata for setningane.
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

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Ugyldig førespurnad.');
  }
}

// ---------------------------------------------------------------------------
// Registreringar
// ---------------------------------------------------------------------------

const FIELD_COLS = ['navn', 'dato', ...[...INT_FIELDS, ...DEC_FIELDS].map(col), 'kommentar'];

function upsertStatement(db, e, user) {
  const cols = ['uid', ...FIELD_COLS, 'created_by'];
  const values = [e.uid, e.navn, e.dato, ...[...INT_FIELDS, ...DEC_FIELDS].map((k) => e[k]), e.kommentar, user];
  // Oppdaterer berre når noko faktisk er endra (eller registreringa var sletta),
  // så ein gjentatt sending frå offline-køa ikkje fyller revisjonsloggen.
  const changed = [...FIELD_COLS.map((c) => `entries.${c} IS NOT excluded.${c}`), 'entries.deleted = 1'].join(' OR ');
  return db
    .prepare(
      `INSERT INTO entries (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
       ON CONFLICT (uid) DO UPDATE SET
         ${FIELD_COLS.map((c) => `${c} = excluded.${c}`).join(', ')},
         deleted = 0,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
         updated_by = excluded.created_by
       WHERE ${changed}
       RETURNING *`,
    )
    .bind(...values);
}

async function setDeleted(env, user, uid, deleted) {
  const db = env.DB;
  const [r] = await write(env, user, deleted ? 'sletta' : 'gjenoppretta', null, [
    db
      .prepare(
        `UPDATE entries SET deleted = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by = ?
         WHERE uid = ? AND deleted = ? RETURNING *`,
      )
      .bind(deleted ? 1 : 0, user, uid, deleted ? 0 : 1),
  ]);
  if (r.results.length) return toApi(r.results[0]);
  const row = await db.prepare('SELECT * FROM entries WHERE uid = ?').bind(uid).first();
  if (!row) throw new HttpError(404, 'Fann ikkje registreringa.');
  return toApi(row); // allereie i ønskt tilstand (t.d. gjentatt sending frå køa)
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

const MESSAGES = {
  reminder: {
    no: 'Egg er ikkje registrert i dag enno.',
    uk: 'Яйця сьогодні ще не зареєстровані.',
    lv: 'Olas šodien vēl nav reģistrētas.',
  },
  test: {
    no: 'Varsel fungerer på denne telefonen.',
    uk: 'Сповіщення працюють на цьому телефоні.',
    lv: 'Paziņojumi šajā tālrunī darbojas.',
  },
};

function message(kind, lang) {
  const body = MESSAGES[kind][lang] || MESSAGES[kind].no;
  return { title: 'Hønseri 🥚', body, tag: kind === 'test' ? 'honseri-test' : 'egg-reminder', url: './' };
}

function validSubscription(b, env) {
  const s = b?.subscription;
  const endpoint = typeof s?.endpoint === 'string' ? s.endpoint : '';
  let url;
  try { url = new URL(endpoint); } catch { throw new HttpError(400, 'Ugyldig push-abonnement.'); }
  const local = env.DEV_USER && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  if (url.protocol !== 'https:' && !local) throw new HttpError(400, 'Ugyldig push-abonnement.');
  const p256dh = String(s?.keys?.p256dh || '');
  const auth = String(s?.keys?.auth || '');
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(auth)) {
    throw new HttpError(400, 'Ugyldig push-abonnement.');
  }
  const lang = ['no', 'uk', 'lv'].includes(b.lang) ? b.lang : 'no';
  return { endpoint, p256dh, auth, lang, navn: cleanText(b.navn, 60) || null };
}

/** Sender til eitt abonnement og held tabellen rein for utgåtte abonnement. */
async function deliver(env, sub, msg, vapid, subject) {
  let status;
  try {
    status = await sendPush(sub, msg, vapid, subject);
  } catch (e) {
    console.error('Push feila:', e?.message || e);
    status = 0;
  }
  const db = env.DB;
  if (status === 404 || status === 410) {
    await db.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(sub.id).run();
  } else if (status >= 200 && status < 300) {
    await db.prepare("UPDATE push_subscriptions SET last_ok_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), fails = 0 WHERE id = ?")
      .bind(sub.id).run();
  } else {
    await db.prepare('UPDATE push_subscriptions SET fails = fails + 1 WHERE id = ?').bind(sub.id).run();
  }
  return status;
}

async function vapidSubject(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'origin'").first();
  return row?.value || 'https://klokkargarden.workers.dev';
}

/**
 * Påminning: køyrer frå cron. Sender berre når klokka er 17 i Noreg, det ikkje er
 * registrert egg i dag, og det ikkje alt er sendt påminning i dag.
 */
export async function runReminder(env, now = new Date(), { force = false } = {}) {
  if (!force && osloHour(now) !== REMINDER_HOUR) return { sent: 0, reason: 'ikkje kl. 17' };
  const today = osloToday(now);
  const db = env.DB;
  const done = await db.prepare('SELECT 1 FROM entries WHERE dato = ? AND deleted = 0 AND egg > 0 LIMIT 1').bind(today).first();
  if (done) return { sent: 0, reason: 'egg er registrert' };
  // Reserver dagen først, så to parallelle køyringar ikkje sender dobbelt.
  const claim = await db.prepare('INSERT OR IGNORE INTO reminders_sent (dato) VALUES (?)').bind(today).run();
  if (!claim.meta.changes) return { sent: 0, reason: 'allereie sendt i dag' };
  const { results: subs } = await db.prepare('SELECT * FROM push_subscriptions').all();
  if (!subs.length) return { sent: 0, reason: 'ingen abonnement' };
  const vapid = await getVapid(db);
  const subject = await vapidSubject(env);
  let sent = 0;
  for (const sub of subs) {
    const status = await deliver(env, sub, message('reminder', sub.lang), vapid, subject);
    if (status >= 200 && status < 300) sent++;
  }
  await db.prepare('UPDATE reminders_sent SET recipients = ? WHERE dato = ?').bind(sent, today).run();
  return { sent, reason: 'sendt' };
}

// ---------------------------------------------------------------------------
// Ruter
// ---------------------------------------------------------------------------

async function route(request, env, user) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;
  const today = osloToday();
  const seg = path.split('/').filter(Boolean); // ['api', ...]
  const db = env.DB;

  if (path === '/api/me' && method === 'GET') return json({ user, today, version: APP_VERSION });

  // --- Registreringar ---
  if (path === '/api/entries' && method === 'GET') {
    const { results } = await db.prepare('SELECT * FROM entries WHERE deleted = 0 ORDER BY dato, id').all();
    return json({ entries: results.map(toApi), today });
  }

  if (path === '/api/entries' && method === 'POST') {
    const e = cleanEntry(await readBody(request), today);
    const existed = await db.prepare('SELECT 1 FROM entries WHERE uid = ?').bind(e.uid).first();
    const [r] = await write(env, user, null, null, [upsertStatement(db, e, user)]);
    const row = r.results[0] || (await db.prepare('SELECT * FROM entries WHERE uid = ?').bind(e.uid).first());
    return json({ entry: toApi(row), created: !existed }, existed ? 200 : 201);
  }

  if (seg[0] === 'api' && seg[1] === 'entries' && seg.length === 4 && method === 'POST') {
    const uid = decodeURIComponent(seg[2]);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(uid)) throw new HttpError(400, 'Ugyldig id.');
    if (seg[3] === 'delete') return json({ entry: await setDeleted(env, user, uid, true) });
    if (seg[3] === 'restore') return json({ entry: await setDeleted(env, user, uid, false) });
  }

  // Flytting av eldre registreringar (frå Google-arket eller Excel-eksporten).
  // Registreringar som alt finst (same id), blir hoppa over.
  if (path === '/api/import' && method === 'POST') {
    const b = await readBody(request);
    const list = Array.isArray(b?.entries) ? b.entries : null;
    if (!list || !list.length) throw new HttpError(400, 'Fila inneheld ingen registreringar.');
    if (list.length > 5000) throw new HttpError(400, 'For mange registreringar i éi fil (maks 5000).');
    const valid = [];
    const invalid = [];
    list.forEach((raw, i) => {
      try { valid.push(cleanEntry(raw, today)); } catch (err) { invalid.push({ rad: i + 1, feil: err.message }); }
    });
    let imported = 0;
    for (let i = 0; i < valid.length; i += 50) {
      const chunk = valid.slice(i, i + 50);
      const cols = ['uid', ...FIELD_COLS, 'created_by'];
      const stmts = chunk.map((e) =>
        db.prepare(`INSERT INTO entries (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
                    ON CONFLICT (uid) DO NOTHING RETURNING id`)
          .bind(e.uid, e.navn, e.dato, ...[...INT_FIELDS, ...DEC_FIELDS].map((k) => e[k]), e.kommentar, user),
      );
      const res = await write(env, user, 'importert', 'Flytta frå tidlegare app', stmts);
      imported += res.reduce((n, r) => n + r.results.length, 0);
    }
    return json({ imported, skipped: valid.length - imported, invalid: invalid.length, errors: invalid.slice(0, 10) });
  }

  // --- Push-varsel ---
  if (path === '/api/push/key' && method === 'GET') {
    const vapid = await getVapid(db);
    return json({ publicKey: vapid.publicKey });
  }

  if (path === '/api/push/subscribe' && method === 'POST') {
    const s = validSubscription(await readBody(request), env);
    await db.batch([
      db.prepare(
        `INSERT INTO push_subscriptions (endpoint, p256dh, auth, lang, navn, user) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth,
           lang = excluded.lang, navn = excluded.navn, user = excluded.user, fails = 0`,
      ).bind(s.endpoint, s.p256dh, s.auth, s.lang, s.navn, user),
      // Adressa til appen blir brukt som avsendar-ID (VAPID «sub») overfor push-tenesta.
      db.prepare("INSERT INTO settings (key, value) VALUES ('origin', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
        .bind(url.origin),
    ]);
    return json({ ok: true }, 201);
  }

  if (path === '/api/push/unsubscribe' && method === 'POST') {
    const b = await readBody(request);
    await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(String(b?.endpoint || '')).run();
    return json({ ok: true });
  }

  if (path === '/api/push/test' && method === 'POST') {
    const b = await readBody(request);
    const sub = await db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').bind(String(b?.endpoint || '')).first();
    if (!sub) throw new HttpError(404, 'Varsel er ikkje slått på for denne telefonen.');
    const status = await deliver(env, sub, message('test', sub.lang), await getVapid(db), await vapidSubject(env));
    if (status < 200 || status >= 300) throw new HttpError(502, `Push-tenesta avviste varselet (${status || 'ingen kontakt'}).`);
    return json({ ok: true });
  }

  throw new HttpError(404, 'Ukjend adresse.');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      // Ukjende stiar: vis appen (statiske filer blir serverte før Workeren blir kalla).
      return env.ASSETS.fetch(new Request(new URL('/', url), request));
    }
    try {
      const user = await authenticate(request, env);
      if (!user) return json({ error: 'Ikkje innlogga. Last sida på nytt for å logge inn.', login: true }, 401);
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        // Enkel CSRF-vern: skriveoperasjonar må kome som JSON frå same opphav.
        const origin = request.headers.get('Origin');
        if (origin && origin !== url.origin) throw new HttpError(403, 'Førespurnaden vart avvist.');
        if (!(request.headers.get('Content-Type') || '').includes('application/json'))
          throw new HttpError(415, 'Førespurnaden må vere JSON.');
      }
      return await route(request, env, user);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...(e.extra || {}) }, e.status);
      if (e?.status) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Uventa feil på tenaren. Ingenting vart lagra.' }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminder(env, new Date(event.scheduledTime)).then((r) => console.log('Påminning:', JSON.stringify(r))));
  },
};
