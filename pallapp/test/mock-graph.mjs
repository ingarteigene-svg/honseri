// Simulert Microsoft Graph / Excel for tester og lokal utvikling (npm run dev).
// Etterligner det som betyr noe for appen:
//   * Tekst med apostrof foran lagres som tekst (uten apostrof).
//   * Tekst som ser ut som tall/dato uten apostrof blir tall (Excel-serienummer for datoer).
//   * «=…» blir formel (her: feilverdi).
//   * rows/add legger alle radene til samlet, i ankomstrekkefølge.
//   * Valgfri forsinkelse og feilsituasjoner for å teste samtidighet og nettverksfeil.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function excelValue(v) {
  if (typeof v === 'number') return v;
  if (v == null) return '';
  const s = String(v);
  if (s.startsWith("'")) return s.slice(1);
  if (s.startsWith('=')) return '#NAME?';
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return (Date.parse(`${s}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000;
  return s;
}

const colIndex = (letters) => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);

export function createMockGraph({ latency = 0 } = {}) {
  const g = {
    sheets: new Map(), // navn → array av rader (array av verdier), rad 1 = index 0
    table: null, // { id, name, sheet, cols, headerRow, lastRow }
    failures: [], // kø: { match: 'append'|'read'|..., status, commit }
    calls: [],
    latency,
  };

  function range(sheet, a1) {
    const m = a1.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
    return { c1: colIndex(m[1]), r1: Number(m[2]), c2: colIndex(m[3]), r2: Number(m[4]), sheet };
  }
  function get(sheet, r, c) {
    return g.sheets.get(sheet)?.[r - 1]?.[c - 1] ?? '';
  }
  function set(sheet, r, c, v) {
    const rows = g.sheets.get(sheet);
    while (rows.length < r) rows.push([]);
    rows[r - 1][c - 1] = excelValue(v);
  }

  async function handle(method, url, body) {
    const u = new URL(url, 'http://mock');
    const path = decodeURIComponent(u.pathname).replace(/^.*?\/v1\.0/, '');
    g.calls.push(`${method} ${path}`);
    if (g.latency) await sleep(Math.random() * g.latency);

    const kind = method === 'POST' && path.endsWith('/rows/add') ? 'append' : method === 'GET' ? 'read' : 'other';
    const fi = g.failures.findIndex((f) => f.match === kind);
    let failAfter = null;
    if (fi >= 0) {
      const f = g.failures.splice(fi, 1)[0];
      if (!f.commit) return { status: f.status, body: { error: { code: f.code || 'mockError', message: 'mock' } } };
      failAfter = f;
    }

    let m;
    if (method === 'GET' && /^\/shares\/u!.+\/driveItem$/.test(path)) {
      return { status: 200, body: { id: 'ITEM1', parentReference: { driveId: 'DRIVE1' } } };
    }
    const wb = '/drives/DRIVE1/items/ITEM1/workbook';
    if (!path.startsWith(wb)) return { status: 404, body: { error: { code: 'itemNotFound' } } };
    const p = path.slice(wb.length);

    if (method === 'POST' && p === '/worksheets/add') {
      if (g.sheets.has(body.name)) return { status: 409, body: { error: { code: 'ItemAlreadyExists' } } };
      g.sheets.set(body.name, []);
      return { status: 201, body: { name: body.name } };
    }
    if ((m = p.match(/^\/worksheets\('(.+)'\)\/range\(address='(.+)'\)$/))) {
      const sheet = m[1].replace(/''/g, "'");
      const r = range(sheet, m[2]);
      if (method === 'PATCH') {
        body.values.forEach((row, i) => row.forEach((v, j) => set(sheet, r.r1 + i, r.c1 + j, v)));
        return { status: 200, body: {} };
      }
      const values = [];
      for (let i = r.r1; i <= r.r2; i++) {
        const row = [];
        for (let j = r.c1; j <= r.c2; j++) row.push(get(sheet, i, j));
        values.push(row);
      }
      return { status: 200, body: { values } };
    }
    if (method === 'POST' && p === '/tables/add') {
      const [sheet, a1] = body.address.split('!');
      const r = range(sheet, a1);
      if (g.table && g.table.sheet === sheet) return { status: 409, body: { error: { code: 'InvalidArgument', message: 'overlapper tabell' } } };
      g.table = { id: '{T1}', name: 'Table1', sheet, cols: r.c2 - r.c1 + 1, headerRow: r.r1, lastRow: r.r1 + 1 };
      return { status: 201, body: { id: g.table.id, name: g.table.name } };
    }
    if (method === 'PATCH' && p === `/tables/${g.table?.id}`) {
      g.table.name = body.name;
      return { status: 200, body: {} };
    }
    if ((m = p.match(/^\/tables\('(.+?)'\)(.*)$/))) {
      if (!g.table || g.table.name !== m[1]) return { status: 404, body: { error: { code: 'ItemNotFound' } } };
      const rest = m[2];
      const t = g.table;
      if (method === 'GET' && rest === '') return { status: 200, body: { name: t.name } };
      if (method === 'GET' && rest === '/dataBodyRange') {
        const last = String.fromCharCode(64 + t.cols);
        return { status: 200, body: { address: `${t.sheet}!A${t.headerRow + 1}:${last}${t.lastRow}`, rowCount: t.lastRow - t.headerRow } };
      }
      if (method === 'POST' && rest === '/rows/add') {
        if (g.locked) return { status: 423, body: { error: { code: 'EditModeCannotAcquireLock' } } };
        for (const row of body.values) {
          t.lastRow += 1;
          row.forEach((v, j) => set(t.sheet, t.lastRow, j + 1, v));
        }
        if (failAfter) return { status: failAfter.status, body: { error: { code: 'mockTimeout' } } };
        return { status: 201, body: {} };
      }
    }
    return { status: 400, body: { error: { code: 'mockUnsupported', message: `${method} ${p}` } } };
  }

  g.handle = handle;
  /** fetch-kompatibel funksjon for tester. */
  g.fetch = async (url, init = {}) => {
    const r = await handle(init.method || 'GET', url, init.body ? JSON.parse(init.body) : undefined);
    return new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  };
  /** Endre en celle direkte (som om noen redigerte arket). */
  g.editCell = (row, col, value) => set(g.table.sheet, row, col, value);
  g.rows = () => g.sheets.get(g.table.sheet).slice(g.table.headerRow);
  return g;
}
