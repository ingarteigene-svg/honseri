// Pallsporing – lagring i Excel (OneDrive for Business / SharePoint) via Microsoft Graph.
//
// Lagring skjer i tre steg, og «Lagret» vises først etter steg 3:
//   1. Nye rader legges til i Excel-tabellen «Hendelser» (én operasjon).
//   2. Hele tabellen leses inn igjen og spilles av (se core.js).
//   3. Appen kontrollerer at de nye radene ble godtatt. Hvis en annen bruker kom
//      først (samme pallnummer / samme pall levert), får brukeren feilmelding, og
//      raden merkes som avvist i loggen.

import {
  TABLE_NAME, HEADERS, rowToEvent, eventToValues, withChecksum, checksum, replay, cmd, UserError,
} from './core.js';

export class AuthExpiredError extends Error {}

const minutesBetween = (a, b) => Math.abs(Date.parse(b.replace(' ', 'T')) - Date.parse(a.replace(' ', 'T'))) / 60000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');

function colLetter(n) {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
const LAST_COL = colLetter(HEADERS.length);
const CHUNK = 4000;

/** Tekst skrives med apostrof foran, slik at Excel lagrer den som tekst
 *  (ikke tall/dato/formel). Excel viser ikke apostrofen. */
function toCell(v) {
  if (typeof v === 'number') return v;
  if (v == null || v === '') return '';
  return `'${v}`;
}

export class Workbook {
  constructor({ graphBase = 'https://graph.microsoft.com/v1.0', fileUrl, driveId, itemId, getToken, fetchImpl }) {
    this.graphBase = graphBase.replace(/\/$/, '');
    this.fileUrl = fileUrl;
    this.driveId = driveId;
    this.itemId = itemId;
    this.getToken = getToken;
    this.fetch = fetchImpl || ((...a) => fetch(...a));
  }

  async request(method, path, body, { retries = 2 } = {}) {
    const url = path.startsWith('http') ? path : `${this.graphBase}${path}`;
    for (let attempt = 0; ; attempt++) {
      const token = await this.getToken();
      let res;
      try {
        res = await this.fetch(url, {
          method,
          headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch {
        if (attempt < retries && method === 'GET') { await sleep(800 * (attempt + 1)); continue; }
        throw Object.assign(new Error('Får ikke kontakt med Microsoft. Sjekk nettet og prøv igjen.'), { uncertain: method !== 'GET' });
      }
      if (res.ok) return res.status === 204 ? null : res.json();
      const data = await res.json().catch(() => ({}));
      const code = data?.error?.code || '';
      if (res.status === 401) throw new AuthExpiredError('Innloggingen er utløpt.');
      if (res.status === 403 || code === 'accessDenied')
        throw new Error('Du har ikke tilgang til Excel-filen. Be administrator dele filen med deg (kan redigere).');
      if (res.status === 404) throw Object.assign(new Error('Fant ikke Excel-filen eller tabellen.'), { notFound: true });
      if (res.status === 409 && /AlreadyExists|Conflict|InvalidArgument/i.test(code))
        throw Object.assign(new Error(`Konflikt i Excel (${code}).`), { conflict: true });
      if ([409, 423].includes(res.status) || /lock|EditMode/i.test(code))
        throw new Error('Excel-filen er låst av et annet program akkurat nå (f.eks. åpnet i Excel uten automatisk lagring). Prøv igjen om litt.');
      const transient = [429, 500, 502, 503, 504].includes(res.status);
      if (transient && attempt < retries && method === 'GET') {
        const wait = Number(res.headers.get('Retry-After')) * 1000 || 1000 * (attempt + 1);
        await sleep(Math.min(wait, 5000));
        continue;
      }
      throw Object.assign(new Error(`Microsoft svarte med feil (${res.status}${code ? ` ${code}` : ''}).`), { uncertain: transient && method !== 'GET' });
    }
  }

  async itemBase() {
    if (!this.driveId || !this.itemId) {
      if (!this.fileUrl) throw new Error('Excel-filen er ikke satt opp (PALL_FILE_URL mangler).');
      const item = await this.request('GET', `/shares/u!${b64url(this.fileUrl)}/driveItem?$select=id,parentReference`);
      this.driveId = item.parentReference.driveId;
      this.itemId = item.id;
    }
    return `/drives/${this.driveId}/items/${this.itemId}/workbook`;
  }

  /** Oppretter arket og tabellen «Hendelser» hvis de mangler (første gang). */
  async ensureTable() {
    const wb = await this.itemBase();
    const exists = async () => {
      try {
        await this.request('GET', `${wb}/tables('${TABLE_NAME}')?$select=name`);
        return true;
      } catch (e) {
        if (e.notFound) return false;
        throw e;
      }
    };
    if (await exists()) return false;
    // Første gang: opprett ark og tabell. Starter to enheter samtidig, vinner den
    // første; den andre får konflikt og bruker tabellen som ble laget.
    try {
      try {
        await this.request('POST', `${wb}/worksheets/add`, { name: TABLE_NAME });
      } catch (e) {
        if (!e.conflict) throw e; // arket finnes allerede
      }
      await this.request('PATCH', `${wb}/worksheets('${TABLE_NAME}')/range(address='A1:${LAST_COL}1')`, { values: [HEADERS] });
      const table = await this.request('POST', `${wb}/tables/add`, { address: `${TABLE_NAME}!A1:${LAST_COL}1`, hasHeaders: true });
      await this.request('PATCH', `${wb}/tables/${table.id}`, { name: TABLE_NAME });
      return true;
    } catch (e) {
      // En annen enhet kan være midt i opprettingen (tabellen får navn til slutt).
      for (let i = 0; i < 6; i++) {
        if (await exists()) return false;
        await sleep(500 * (i + 1));
      }
      throw e;
    }
  }

  /** Leser alle rader i tabellen (i biter for store tabeller). */
  async readRows() {
    const wb = await this.itemBase();
    const body = await this.request('GET', `${wb}/tables('${TABLE_NAME}')/dataBodyRange?$select=address,rowCount`);
    const m = String(body.address).match(/^(?:'?(.+?)'?!)?[A-Z]+(\d+):[A-Z]+(\d+)$/);
    if (!m) throw new Error('Uventet tabellformat i Excel.');
    const sheet = (m[1] || TABLE_NAME).replace(/''/g, "'");
    const first = Number(m[2]);
    const last = Number(m[3]);
    const rows = [];
    for (let s = first; s <= last; s += CHUNK) {
      const e = Math.min(last, s + CHUNK - 1);
      const r = await this.request('GET',
        `${wb}/worksheets('${encodeURIComponent(sheet.replace(/'/g, "''"))}')/range(address='A${s}:${LAST_COL}${e}')?$select=values`);
      r.values.forEach((v, i) => rows.push({ row: s + i, values: v }));
    }
    return rows;
  }

  async appendRows(valueRows) {
    const wb = await this.itemBase();
    await this.request('POST', `${wb}/tables('${TABLE_NAME}')/rows/add`, {
      index: null,
      values: valueRows.map((r) => r.map(toCell)),
    });
  }
}

/** Datatjeneste for appen: les/avspill og lagre med kontroll etterpå. */
export class DataStore {
  constructor(workbook, { user }) {
    this.wb = workbook;
    this.user = user;
    this.state = null;
    this.tampered = [];
  }

  ctx() {
    return { user: this.user };
  }

  async load() {
    const rows = await this.wb.readRows();
    const events = [];
    const tampered = [];
    for (const { row, values } of rows) {
      const e = rowToEvent(values);
      if (!e.id) continue;
      e.row = row;
      if (e.checksum !== await checksum(e)) tampered.push({ row, id: e.id, type: e.type, pallet: e.pallet });
      events.push(e);
    }
    // Rekkefølgen i arket avgjør hvem som kom først. Er tabellen sortert i Excel,
    // hopper tidspunktene bakover – det varsles (gjenopprett via versjonsloggen).
    let maxTs = '';
    let outOfOrder = 0;
    for (const e of events) {
      if (maxTs && e.ts && e.ts < maxTs && minutesBetween(e.ts, maxTs) > 15) outOfOrder++;
      if (e.ts > maxTs) maxTs = e.ts;
    }
    this.state = replay(events);
    this.tampered = tampered;
    this.outOfOrder = outOfOrder;
    return this.state;
  }

  /**
   * Lagrer hendelser og bekrefter mot Excel. Kaster UserError med forklaring hvis
   * noe ble avvist; da er ingenting av handlingen gjeldende.
   * allowPartial: godta at enkelte rader avvises (brukes ved sperring).
   */
  async commit(events, { allowPartial = false } = {}) {
    const rows = await Promise.all(events.map(withChecksum));
    try {
      await this.wb.appendRows(rows.map(eventToValues));
    } catch (e) {
      if (!e.uncertain) throw e;
      // Usikkert om raden kom inn (tidsavbrudd). Sjekk før vi eventuelt prøver igjen.
      await this.load();
      if (!events.every((ev) => this.state.results.has(ev.id))) await this.wb.appendRows(rows.map(eventToValues));
    }
    const state = await this.load();
    const results = events.map((ev) => ({ ev, r: state.results.get(ev.id) }));
    if (results.some((x) => !x.r)) throw new Error('Kunne ikke bekrefte lagringen i Excel. Kontroller i Oversikt før du prøver igjen.');
    const failed = results.filter((x) => !x.r.ok);
    if (failed.length && (!allowPartial || failed.length === results.length)) {
      // Merk avvisningen synlig i loggen (best effort – avspillingen avviser uansett).
      try {
        const marks = await Promise.all(failed.slice(0, 20).map((x) => withChecksum(cmd.rejected(x.ev, x.r.reason, this.ctx()))));
        await this.wb.appendRows(marks.map(eventToValues));
        await this.load();
      } catch { /* ignorer */ }
      throw new UserError(`Ikke lagret: ${failed[0].r.reason}`);
    }
    return { state: this.state, accepted: results.filter((x) => x.r.ok).length, rejected: failed.length };
  }
}
