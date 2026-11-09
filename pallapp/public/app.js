// Pallsporing – Klokkargarden. Grensesnitt (ingen rammeverk, ingen byggesteg).
// All data lagres i den felles databasen via /api. Nettleseren husker bare
// sist brukte verpedato/antall brett for å spare tasting.

const EGG_PER_TRAY = 30;
const PALLET_SIZES = [200, 228];
const view = document.getElementById('view');
const dialog = document.getElementById('dialog');
let me = { user: '' };

/** Dagens dato i Norge (ÅÅÅÅ-MM-DD). Regnes ut hver gang den brukes, slik at appen
 *  ikke henger igjen på gårsdagen når den står åpen over natten. */
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' }).format(new Date());
let renderedDay = today();
let deliveryDateMemo = null; // sist valgte leveringsdato samme dag

// ---------------------------------------------------------------------------
// Hjelpere
// ---------------------------------------------------------------------------

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const nf = new Intl.NumberFormat('nb-NO');
const num = (n) => nf.format(n);
const fmtDate = (s) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '');
const period = (a, b) => (a === b ? fmtDate(a) : `${fmtDate(a)} – ${fmtDate(b)}`);
const fmtTime = (iso) =>
  new Date(iso).toLocaleString('nb-NO', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Oslo' });
const eggs = (trays) => `${num(trays)} brett (${num(trays * EGG_PER_TRAY)} egg)`;

class ApiError extends Error {}

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      redirect: 'manual',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(
      method === 'GET'
        ? 'Får ikke kontakt med serveren. Sjekk nettet og prøv igjen.'
        : 'Får ikke kontakt med serveren. Ingenting ble lagret – sjekk nettet og prøv igjen.',
    );
  }
  if (res.type === 'opaqueredirect' || res.status === 401) {
    showLoginExpired();
    throw new ApiError('Innloggingen er utløpt. Last siden på nytt og logg inn. Ingenting ble lagret.');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* ikke JSON */
  }
  if (!data && res.status === 403) {
    showLoginExpired();
    throw new ApiError('Ingen tilgang eller utløpt innlogging. Last siden på nytt. Ingenting ble lagret.');
  }
  if (!res.ok || !data) {
    throw new ApiError(data?.error || `Serverfeil (${res.status}). Ingenting ble lagret.`);
  }
  return data;
}

function showLoginExpired() {
  if (document.getElementById('login-expired')) return;
  document.body.prepend(
    h('div', { id: 'login-expired', class: 'msg msg-warn', style: 'margin:12px' },
      'Innloggingen er utløpt. ',
      h('button', { class: 'btn-primary btn-sm', onclick: () => location.reload() }, 'Logg inn på nytt')),
  );
}

function msg(kind, title, sub) {
  return h('div', { class: `msg msg-${kind}`, role: kind === 'err' ? 'alert' : 'status' },
    kind === 'ok' ? h('span', { class: 'big' }, '✓ ', title) : title,
    sub ? h('span', { class: 'sub' }, sub) : null);
}

function setMsg(container, node) {
  container.replaceChildren(...(node ? [node] : []));
  if (node) node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), input, hint ? h('div', { class: 'hint' }, hint) : null);
}

function badges(p) {
  const out = [h('span', { class: `badge b-${p.status}` }, { lager: 'På lager', levert: 'Levert', annullert: 'Annullert' }[p.status])];
  if (p.blocked) out.push(h('span', { class: 'badge b-sperret' }, 'Sperret'));
  if (p.recall_ids?.length) out.push(h('span', { class: 'badge b-berort' }, 'Berørt'));
  return out;
}

const store = {
  get(k) {
    try { return JSON.parse(localStorage.getItem(k)); } catch { return null; }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignorer */ }
  },
};

/** Knapp som låses mens en lagring pågår (hindrer dobbeltklikk). */
async function busy(button, text, fn) {
  const old = button.textContent;
  button.disabled = true;
  button.textContent = text;
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.textContent = old;
  }
}

const clean = (children) => children.flat(Infinity).filter((c) => c != null && c !== false);

/** Tegner en visning (lister flates ut, tomme verdier hoppes over). */
function render(...children) {
  view.replaceChildren(...clean(children));
}

function openDialog(...children) {
  dialog.replaceChildren(...clean(children));
  dialog.showModal();
}
function closeDialog() {
  dialog.close();
}

let storesCache = null;
async function loadStores(force = false) {
  if (!storesCache || force) storesCache = (await api('GET', '/api/stores')).stores;
  return storesCache;
}

function storeOptions(stores, selected, emptyLabel = 'Velg butikk …') {
  return [
    h('option', { value: '' }, emptyLabel),
    ...stores.map((s) => h('option', { value: s.id, selected: String(s.id) === String(selected) }, s.name)),
  ];
}

// ---------------------------------------------------------------------------
// 1. Ny pall
// ---------------------------------------------------------------------------

async function viewNew() {
  const last = store.get('pall.sist') || {};
  const sameDay = last.dato === today();
  const result = h('div', { id: 'result' });

  const no = h('input', {
    class: 'big', id: 'pallet_no', inputMode: 'numeric', autocomplete: 'off', autocapitalize: 'characters',
    enterKeyHint: 'done', maxLength: 20, required: true, 'aria-label': 'Pallnummer',
  });
  const from = h('input', { type: 'date', id: 'lay_from', required: true, max: today(), value: sameDay && last.fra ? last.fra : today() });
  const to = h('input', { type: 'date', id: 'lay_to', max: today(), value: sameDay && last.til ? last.til : from.value });
  const multi = sameDay && last.til && last.til !== last.fra;
  const toWrap = field('Verpedato til', to);
  toWrap.classList.toggle('hidden', !multi);
  const toggle = h('button', {
    type: 'button', class: 'btn-link',
    onclick: () => {
      const show = toWrap.classList.contains('hidden');
      toWrap.classList.toggle('hidden', !show);
      if (!show) to.value = from.value;
      toggle.textContent = show ? 'Bare én verpedag' : 'Flere verpedager?';
    },
  }, multi ? 'Bare én verpedag' : 'Flere verpedager?');
  from.addEventListener('change', () => {
    if (toWrap.classList.contains('hidden') || to.value < from.value) to.value = from.value;
  });

  // Pallstørrelse: 200 eller 228 brett med ett trykk, «Annet antall» for unntak.
  let trays = PALLET_SIZES.includes(last.brett) ? last.brett : null;
  const other = h('input', { id: 'trays_other', inputMode: 'numeric', pattern: '[0-9]*', 'aria-label': 'Annet antall brett' });
  const otherWrap = h('div', { class: 'hidden', style: 'margin-top:10px' }, other);
  const eggHint = h('div', { class: 'hint' });
  const sizeBtns = PALLET_SIZES.map((n) => h('button', {
    type: 'button', class: 'size', 'data-size': n, 'aria-pressed': 'false',
    onclick: () => { trays = n; otherWrap.classList.add('hidden'); other.value = ''; updHint(); },
  }, h('b', {}, String(n)), h('span', {}, 'brett')));
  const otherBtn = h('button', { type: 'button', class: 'btn-link', onclick: () => {
    trays = 'annet'; otherWrap.classList.remove('hidden'); other.focus(); updHint();
  } }, 'Annet antall');
  if (Number.isInteger(last.brett) && !PALLET_SIZES.includes(last.brett)) {
    trays = 'annet';
    other.value = last.brett;
    otherWrap.classList.remove('hidden');
  }
  const trayValue = () => (trays === 'annet' ? Number(other.value) : trays);
  function updHint() {
    sizeBtns.forEach((b) => {
      const on = Number(b.dataset.size) === trays;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const n = trayValue();
    eggHint.textContent = Number.isInteger(n) && n > 0 ? `= ${num(n * EGG_PER_TRAY)} egg` : 'Velg pallstørrelse';
  }
  other.addEventListener('input', updHint);
  updHint();

  // Forslag til neste pallnummer (kortene er løpende). Fylles inn først når brukeren trykker,
  // slik at nummeret alltid kontrolleres mot kortet.
  const nextBtn = h('button', { type: 'button', id: 'next_no', class: 'btn-sm hidden', style: 'margin:-6px 0 16px', onclick: () => {
    no.value = nextBtn.dataset.no;
    no.focus();
  } });
  async function loadNext() {
    try {
      const { next } = await api('GET', '/api/next-pallet-no');
      nextBtn.dataset.no = next || '';
      nextBtn.textContent = next ? `Bruk neste nummer: ${next}` : '';
      nextBtn.classList.toggle('hidden', !next);
    } catch {
      nextBtn.classList.add('hidden');
    }
  }

  const save = h('button', { type: 'submit', class: 'btn-primary btn-block' }, 'Lagre pall');
  const todayList = h('div');

  const form = h('form', { class: 'card narrow', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    setMsg(result, null);
    const body = {
      pallet_no: no.value,
      lay_from: from.value,
      lay_to: toWrap.classList.contains('hidden') ? from.value : to.value,
      trays: trayValue(),
    };
    // Rask kontroll i nettleseren; serveren kontrollerer alt på nytt.
    const errs = [];
    if (!no.value.trim()) errs.push('Skriv inn pallnummer.');
    if (!body.lay_from) errs.push('Velg verpedato.');
    if (body.lay_to && body.lay_from && body.lay_from > body.lay_to) errs.push('Verpedato fra kan ikke være senere enn til.');
    if (!Number.isInteger(body.trays) || body.trays <= 0) errs.push(trays ? 'Antall brett må være et positivt heltall.' : 'Velg pallstørrelse (200 eller 228 brett).');
    if (errs.length) return setMsg(result, msg('err', errs.join(' ')));

    await busy(save, 'Lagrer …', async () => {
      try {
        const { pallet: p } = await api('POST', '/api/pallets', body);
        store.set('pall.sist', { dato: today(), fra: p.lay_from, til: p.lay_to, brett: p.trays });
        setMsg(result, msg('ok', `Pall ${p.pallet_no} er lagret`,
          `Verpet ${period(p.lay_from, p.lay_to)} · ${eggs(p.trays)} · pakket ${fmtDate(p.packed_date)} av ${p.created_by}`));
        navigator.vibrate?.(60);
        no.value = '';
        no.focus();
        renderToday(todayList);
        loadNext();
      } catch (err) {
        setMsg(result, msg('err', err.message));
      }
    });
  } },
  field('Pallnummer (fra kortet)', no),
  nextBtn,
  h('div', { class: 'row stack-sm' }, field('Verpedato', from), toWrap),
  toggle,
  h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Pallstørrelse'),
    h('div', { class: 'sizes' }, sizeBtns), otherBtn, otherWrap, eggHint),
  save);

  render(h('h1', {}, 'Ny pall'), result, form, todayList);
  renderToday(todayList);
  loadNext();
  no.focus();
}

async function renderToday(container) {
  try {
    const { pallets } = await api('GET', '/api/pallets?limit=200');
    const packed = pallets.filter((p) => p.packed_date === today());
    if (!packed.length) return container.replaceChildren();
    container.replaceChildren(
      h('h2', {}, `Pakket i dag (${packed.length})`),
      h('p', { class: 'muted small' }, `Totalt ${eggs(packed.reduce((n, p) => n + p.trays, 0))}`),
      h('ul', { class: 'small' }, packed.slice(0, 15).map((p) =>
        h('li', {}, h('a', { href: `#pall/${p.id}` }, `Pall ${p.pallet_no}`), ` · ${period(p.lay_from, p.lay_to)} · ${num(p.trays)} brett · ${p.created_by}`))),
    );
  } catch {
    container.replaceChildren();
  }
}

// ---------------------------------------------------------------------------
// 2. Levering
// ---------------------------------------------------------------------------

async function viewDelivery(flash) {
  const result = h('div');
  if (flash) result.append(flash);
  render(h('h1', {}, 'Levering'), result, h('p', { class: 'muted' }, 'Laster paller …'));

  let pallets, stores;
  try {
    [{ pallets }, stores] = await Promise.all([api('GET', '/api/pallets?status=leverbar&limit=1000'), loadStores(true)]);
  } catch (err) {
    return render(h('h1', {}, 'Levering'), msg('err', err.message));
  }
  pallets.sort((a, b) => a.pallet_no.localeCompare(b.pallet_no, 'nb', { numeric: true }));

  // Ruten: leveringer som er lagt til, men ikke lagret ennå. Alt lagres samlet til slutt.
  const route = [];
  const inRoute = new Set();
  const selected = new Set();
  const sumText = h('span', { class: 'sumtext' });
  const tiles = h('div', { class: 'tiles' });
  const filter = h('input', { type: 'search', placeholder: 'Finn pallnummer …', inputMode: 'numeric', 'aria-label': 'Finn pall' });
  const tileEls = pallets.map((p) => {
    const cb = h('input', { type: 'checkbox', 'aria-label': `Pall ${p.pallet_no}` });
    const tile = h('label', { class: 'tile' }, cb,
      h('div', {}, h('b', {}, `Pall ${p.pallet_no}`), h('small', {}, `Verpet ${period(p.lay_from, p.lay_to)} · ${num(p.trays)} brett`)));
    cb.addEventListener('change', () => {
      cb.checked ? selected.add(p.id) : selected.delete(p.id);
      tile.classList.toggle('sel', cb.checked);
      updSum();
    });
    tile._p = p;
    tile._cb = cb;
    return tile;
  });
  tiles.append(...tileEls);
  const stockTitle = h('h2', { style: 'margin-top:0' });
  const noStock = h('p', { class: 'muted hidden' }, 'Ingen flere paller på lager.');

  function showTiles() {
    const q = filter.value.trim().toUpperCase();
    for (const t of tileEls) t.classList.toggle('hidden', inRoute.has(t._p.id) || (!!q && !t._p.pallet_no.includes(q)));
    const left = pallets.length - inRoute.size;
    stockTitle.textContent = `1. Velg paller på lager (${left})`;
    noStock.classList.toggle('hidden', left > 0);
  }
  filter.addEventListener('input', showTiles);

  const chosen = () => pallets.filter((p) => selected.has(p.id));
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const trayTotal = (list) => list.reduce((n, p) => n + p.trays, 0);

  // Butikk
  const storeSel = h('select', { id: 'store', 'aria-label': 'Butikk' }, storeOptions(stores));
  const newStoreBox = h('div', { class: 'hidden' });
  const newStoreBtn = h('button', { type: 'button', class: 'btn-sm', onclick: () => {
    newStoreBox.classList.toggle('hidden');
    if (!newStoreBox.classList.contains('hidden')) newStoreBox.querySelector('input').focus();
  } }, '+ Ny butikk');
  newStoreBox.append(storeForm(null, async (s) => {
    storesCache = null;
    const all = await loadStores(true);
    storeSel.replaceChildren(...storeOptions(all, s.id));
    newStoreBox.classList.add('hidden');
    renderStoreAdmin();
  }));
  const storeById = (id) => (storesCache || stores).find((s) => String(s.id) === String(id));

  const orderRef = h('input', { id: 'order_ref', autocomplete: 'off', maxLength: 60, 'aria-label': 'Ordre-/fakturanummer' });
  // Leveringsdato: felles for hele ruten, og huskes til neste registrering samme dag.
  const date = h('input', {
    type: 'date', id: 'delivery_date', 'aria-label': 'Leveringsdato',
    value: deliveryDateMemo?.day === today() ? deliveryDateMemo.value : today(),
  });
  const dateHint = h('div', { class: 'hint' });
  function updDate() {
    if (date.value) deliveryDateMemo = { day: today(), value: date.value };
    dateHint.textContent = !date.value || date.value === today() ? '' : `Obs: datoen er ikke i dag (${fmtDate(today())}).`;
    dateHint.classList.toggle('warn', !!dateHint.textContent);
  }
  date.addEventListener('change', updDate);
  updDate();

  /** Leser leveringen som fylles ut nå. Tom = null. Ufullstendig = feilmelding. */
  function currentLine() {
    const c = chosen();
    const started = c.length || storeSel.value || orderRef.value.trim();
    if (!started) return { line: null };
    const errs = [];
    if (!c.length) errs.push('Velg minst én pall.');
    if (!storeSel.value) errs.push('Velg butikk.');
    if (!orderRef.value.trim()) errs.push('Skriv inn ordre-/fakturanummer.');
    if (errs.length) return { error: errs.join(' ') };
    return { line: { pallets: c, store: storeById(storeSel.value), orderRef: orderRef.value.trim() } };
  }

  function clearCurrent() {
    for (const t of tileEls) {
      if (t._cb.checked) { t._cb.checked = false; t.classList.remove('sel'); }
    }
    selected.clear();
    storeSel.value = '';
    orderRef.value = '';
  }

  const routeBox = h('div');
  function renderRoute() {
    if (!route.length) return routeBox.replaceChildren();
    const all = route.flatMap((l) => l.pallets);
    routeBox.replaceChildren(h('div', { class: 'card', id: 'route' },
      h('h2', { style: 'margin-top:0' }, `Rute: ${count(route.length, 'butikk', 'butikker')} · ${count(all.length, 'pall', 'paller')}`),
      h('ul', { class: 'route-list' }, route.map((l, i) => h('li', {},
        h('div', {},
          h('b', {}, l.store.name), ` · ordre ${l.orderRef}`,
          h('div', { class: 'small muted' }, `Pall ${l.pallets.map((p) => p.pallet_no).join(', ')} · ${num(trayTotal(l.pallets))} brett`)),
        h('button', { type: 'button', class: 'btn-link', 'aria-label': `Fjern ${l.store.name} fra ruten`, onclick: () => {
          for (const p of l.pallets) inRoute.delete(p.id);
          route.splice(i, 1);
          renderRoute();
          showTiles();
          updSum();
        } }, 'Fjern')))),
      h('p', { class: 'hint' }, 'Ingenting er lagret ennå. Ruten lagres samlet når du trykker «Registrer rute».')));
  }

  const submit = h('button', { type: 'button', class: 'btn-primary' });
  const addBtn = h('button', { type: 'button', id: 'add_stop', onclick: () => {
    setMsg(result, null);
    const { line, error } = currentLine();
    if (error || !line) return setMsg(result, msg('err', error || 'Velg paller, butikk og ordre-/fakturanummer før du legger til neste butikk.'));
    route.push(line);
    for (const p of line.pallets) inRoute.add(p.id);
    clearCurrent();
    renderRoute();
    showTiles();
    updSum();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } }, '+ Flere butikker');

  function updSum() {
    const c = chosen();
    sumText.textContent = c.length ? `${count(c.length, 'pall', 'paller')} valgt · ${eggs(trayTotal(c))}` : 'Ingen paller valgt';
    const n = route.length + (c.length ? 1 : 0);
    submit.textContent = route.length ? `Registrer rute (${count(n, 'levering', 'leveringer')})` : 'Registrer levering';
  }

  submit.addEventListener('click', () => {
    setMsg(result, null);
    const { line, error } = currentLine();
    if (error) return setMsg(result, msg('err', error));
    const lines = line ? [...route, line] : [...route];
    if (!lines.length) return setMsg(result, msg('err', 'Velg minst én pall.'));
    if (!date.value) return setMsg(result, msg('err', 'Velg leveringsdato.'));
    confirmDelivery(lines);
  });

  function confirmDelivery(lines) {
    const all = lines.flatMap((l) => l.pallets);
    const errBox = h('div');
    const ok = h('button', { class: 'btn-primary', onclick: async () => {
      await busy(ok, 'Lagrer …', async () => {
        try {
          const r = await api('POST', '/api/deliveries/batch', {
            delivery_date: date.value,
            deliveries: lines.map((l) => ({ store_id: l.store.id, order_ref: l.orderRef, pallet_ids: l.pallets.map((p) => p.id) })),
          });
          closeDialog();
          const d = r.deliveries;
          const saved = d.flatMap((x) => x.pallets);
          viewDelivery(msg('ok', d.length === 1 ? 'Levering registrert' : `${d.length} leveringer registrert`,
            `${count(saved.length, 'pall', 'paller')} · ${eggs(trayTotal(saved))} · ${fmtDate(d[0].delivery.delivery_date)} · ` +
            d.map((x) => `${x.delivery.store_name}, ordre ${x.delivery.order_ref} (${x.pallets.map((p) => p.pallet_no).join(', ')})`).join(' · ')));
        } catch (err) {
          setMsg(errBox, msg('err', err.message));
        }
      });
    } }, lines.length === 1 ? 'Bekreft levering' : `Bekreft ${lines.length} leveringer`);
    openDialog(
      h('h2', { style: 'margin-top:0' }, lines.length === 1 ? 'Bekreft levering' : 'Bekreft rute'),
      h('dl', { class: 'facts' },
        h('dt', {}, 'Leveringsdato'), h('dd', {}, fmtDate(date.value), date.value === today() ? '' : ' (ikke i dag)')),
      lines.map((l) => h('div', { class: 'confirm-stop' },
        h('div', {}, h('b', {}, l.store.name), ` · ordre ${l.orderRef}`),
        h('ul', { class: 'confirm-list' }, l.pallets.map((p) => h('li', {}, h('b', {}, `Pall ${p.pallet_no}`), h('span', {}, `${num(p.trays)} brett`)))))),
      h('p', {}, h('b', {}, `Totalt ${count(all.length, 'pall', 'paller')} · ${eggs(trayTotal(all))}`)),
      errBox,
      h('div', { class: 'actions' }, ok, h('button', { onclick: closeDialog }, 'Avbryt')),
    );
    ok.focus();
  }

  const storeAdmin = h('details', { class: 'card' });
  function renderStoreAdmin() {
    const list = storesCache || stores;
    storeAdmin.replaceChildren(
      h('summary', { style: 'font-weight:700;cursor:pointer;min-height:44px;display:flex;align-items:center' }, `Butikker (${list.length})`),
      list.length ? h('ul', { class: 'history', style: 'margin-top:10px' }, list.map((s) => {
        const li = h('li', {},
          h('div', { class: 'what' }, s.name),
          h('div', { class: 'small muted' }, [s.phone, s.email].filter(Boolean).join(' · ') || 'Ingen kontaktinfo'),
          h('button', { class: 'btn-link', onclick: () => {
            li.replaceChildren(storeForm(s, async () => {
              await loadStores(true);
              viewDelivery(msg('ok', 'Butikken er oppdatert'));
            }, () => renderStoreAdmin()));
          } }, 'Endre'));
        return li;
      })) : h('p', { class: 'muted' }, 'Ingen butikker ennå. Bruk «+ Ny butikk».'),
    );
  }
  renderStoreAdmin();
  showTiles();
  updSum();

  render(
    h('h1', {}, 'Levering'),
    result,
    routeBox,
    h('div', { class: 'card' },
      stockTitle,
      pallets.length > 8 ? h('div', { style: 'margin-bottom:12px' }, filter) : null,
      pallets.length ? [tiles, noStock] : h('p', { class: 'muted' }, 'Ingen paller på lager.')),
    h('div', { class: 'card narrow' },
      h('h2', { style: 'margin-top:0' }, '2. Butikk og ordre'),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Butikk'), storeSel),
      newStoreBtn, newStoreBox,
      h('div', { style: 'height:12px' }),
      field('Ordre-/fakturanummer', orderRef),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Leveringsdato'), date, dateHint)),
    h('div', { class: 'sumbar' }, sumText, h('div', { class: 'actions', style: 'margin:0' }, addBtn, submit)),
    storeAdmin,
  );
}

function storeForm(s, onSaved, onCancel) {
  const name = h('input', { value: s?.name || '', maxLength: 100, autocomplete: 'off' });
  const phone = h('input', { type: 'tel', value: s?.phone || '', maxLength: 40 });
  const email = h('input', { type: 'email', value: s?.email || '', maxLength: 120 });
  const reason = h('input', { maxLength: 300, placeholder: 'f.eks. skrivefeil i navnet' });
  const out = h('div');
  const btn = h('button', { type: 'submit', class: 'btn-primary btn-sm' }, s ? 'Lagre endring' : 'Lagre butikk');
  return h('form', { class: 'card', style: 'margin-top:10px', onsubmit: async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await busy(btn, 'Lagrer …', async () => {
      try {
        const body = { name: name.value, phone: phone.value, email: email.value };
        const r = s
          ? await api('PUT', `/api/stores/${s.id}`, { ...body, reason: reason.value })
          : await api('POST', '/api/stores', body);
        setMsg(out, msg('ok', `Butikken «${r.store.name}» er lagret`));
        await onSaved(r.store);
      } catch (err) {
        setMsg(out, msg('err', err.message));
      }
    });
  } },
  field('Butikknavn', name),
  h('div', { class: 'row stack-sm' }, field('Telefon (valgfritt)', phone), field('E-post (valgfritt)', email)),
  s ? field('Årsak til endringen', reason) : null,
  out,
  h('div', { class: 'actions' }, btn, onCancel ? h('button', { type: 'button', class: 'btn-sm', onclick: onCancel }, 'Avbryt') : null));
}

// ---------------------------------------------------------------------------
// 3. Oversikt og søk
// ---------------------------------------------------------------------------

async function viewOverview(params) {
  const q = new URLSearchParams(params || '');
  const result = h('div');
  const stores = await loadStores(true).catch(() => []);

  const no = h('input', { value: q.get('no') || '', inputMode: 'numeric', autocomplete: 'off' });
  const order = h('input', { value: q.get('order') || '', autocomplete: 'off' });
  const storeSel = h('select', {}, storeOptions(stores, q.get('store'), 'Alle butikker'));
  const from = h('input', { type: 'date', value: q.get('from') || '' });
  const to = h('input', { type: 'date', value: q.get('to') || '' });
  const dfrom = h('input', { type: 'date', id: 'q_dfrom', value: q.get('dfrom') || '' });
  const dto = h('input', { type: 'date', id: 'q_dto', value: q.get('dto') || '' });
  const statusSel = h('select', { id: 'q_status' },
    [['', 'Alle'], ['lager', 'På lager'], ['levert', 'Levert'], ['sperret', 'Sperret'], ['annullert', 'Annullert']]
      .map(([v, t]) => h('option', { value: v, selected: v === (q.get('status') || '') }, t)));

  const form = h('form', { class: 'card', onsubmit: (e) => {
    e.preventDefault();
    const p = new URLSearchParams();
    if (no.value.trim()) p.set('no', no.value.trim());
    if (order.value.trim()) p.set('order', order.value.trim());
    if (storeSel.value) p.set('store', storeSel.value);
    if (from.value) p.set('from', from.value);
    if (to.value) p.set('to', to.value);
    if (dfrom.value) p.set('dfrom', dfrom.value);
    if (dto.value) p.set('dto', dto.value);
    if (statusSel.value) p.set('status', statusSel.value);
    const hash = `#oversikt?${p}`;
    if (location.hash === hash) viewOverview(p.toString());
    else location.hash = hash;
  } },
  h('div', { class: 'row' }, field('Pallnummer', no), field('Ordre-/fakturanr', order)),
  h('div', { class: 'row' }, field('Butikk', storeSel), field('Status', statusSel)),
  h('div', { class: 'row' }, field('Verpedato fra', from), field('Verpedato til', to)),
  h('p', { class: 'hint', style: 'margin-top:-8px' }, 'Datosøk finner alle paller der verpeperioden overlapper søkeperioden.'),
  h('div', { class: 'row' }, field('Levert fra', dfrom), field('Levert til', dto)),
  h('div', { class: 'actions' },
    h('button', { type: 'submit', class: 'btn-primary' }, 'Søk'),
    h('button', { type: 'button', onclick: () => { location.hash = '#oversikt'; } }, 'Nullstill')));

  const recallsBox = h('div');
  render(h('h1', {}, 'Oversikt og søk'), form, result, recallsBox);
  renderRecallList(recallsBox);

  let data;
  try {
    data = await api('GET', `/api/pallets?${q}&limit=500`);
  } catch (err) {
    return setMsg(result, msg('err', err.message));
  }
  const pallets = data.pallets;
  const selected = new Set();
  const selText = h('span', { class: 'sumtext' });
  const recallBtn = h('button', { class: 'btn-danger', disabled: true, onclick: () => markAffected(pallets.filter((p) => selected.has(p.id))) }, 'Merk som berørt …');
  const bar = h('div', { class: 'sumbar hidden' }, selText, recallBtn);
  const updSel = () => {
    selText.textContent = `${selected.size} valgt`;
    recallBtn.disabled = !selected.size;
    bar.classList.toggle('hidden', !selected.size);
  };

  const rows = pallets.map((p) => {
    const cb = h('input', { type: 'checkbox', 'aria-label': `Velg pall ${p.pallet_no}` });
    const tr = h('tr', {},
      h('td', { class: 'chk' }, cb),
      h('td', { 'data-l': 'Pall' }, h('a', { class: 'pno', href: `#pall/${p.id}` }, p.pallet_no)),
      h('td', { 'data-l': 'Verpet' }, period(p.lay_from, p.lay_to)),
      h('td', { class: 'num', 'data-l': 'Brett' }, num(p.trays)),
      h('td', {}, badges(p)),
      h('td', { 'data-l': 'Butikk' }, p.store_name || '–'),
      h('td', { 'data-l': 'Ordre' }, p.order_ref || '–'),
      h('td', { 'data-l': 'Levert' }, fmtDate(p.delivery_date) || '–'));
    cb.addEventListener('change', () => {
      cb.checked ? selected.add(p.id) : selected.delete(p.id);
      tr.classList.toggle('sel', cb.checked);
      updSel();
    });
    tr._cb = cb;
    tr._p = p;
    return tr;
  });

  const all = h('input', { type: 'checkbox', 'aria-label': 'Velg alle' });
  all.addEventListener('change', () => {
    for (const tr of rows) {
      tr._cb.checked = all.checked;
      all.checked ? selected.add(tr._p.id) : selected.delete(tr._p.id);
      tr.classList.toggle('sel', all.checked);
    }
    updSel();
  });

  const searched = [...q.keys()].length > 0;
  const exportLink = h('a', { class: 'btn btn-sm', href: `/api/pallets.csv?${q}`, download: '' },
    searched ? '⬇ Eksporter treffet til Excel' : '⬇ Eksporter alle paller til Excel');
  const totalTrays = pallets.reduce((n, p) => n + p.trays, 0);
  result.replaceChildren(
    h('h2', {}, searched ? `Treff: ${pallets.length} paller` : `Siste registrerte paller (${pallets.length})`),
    pallets.length ? h('p', { class: 'muted' }, `Totalt ${eggs(totalTrays)}`,
      data.truncated ? ' – viser de 500 nyeste, avgrens søket for å se flere (eksporten tar med alle).' : '') : null,
    pallets.length ? h('div', { class: 'actions', style: 'margin-bottom:12px' }, exportLink) : null,
    pallets.length
      ? h('div', {},
          h('label', { class: 'radio' }, all, 'Velg alle i treffet'),
          h('table', { class: 'list selectable' },
            h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Pall'), h('th', {}, 'Verpeperiode'), h('th', { class: 'num' }, 'Brett'),
              h('th', {}, 'Status'), h('th', {}, 'Butikk'), h('th', {}, 'Ordre/faktura'), h('th', {}, 'Levert'))),
            h('tbody', {}, rows)))
      : h('p', { class: 'muted' }, 'Ingen paller funnet.'),
    bar,
  );
}

async function renderRecallList(box) {
  try {
    const { recalls } = await api('GET', '/api/recalls');
    if (!recalls.length) return;
    box.replaceChildren(
      h('h2', {}, 'Tilbakekallinger'),
      h('ul', {}, recalls.map((r) => h('li', {}, h('a', { href: `#tilbake/${r.id}` }, r.title), ` · ${fmtDate(r.opened_date)} · ${r.pallets} paller`))),
    );
  } catch {
    /* vises ikke */
  }
}

async function markAffected(chosen) {
  let recalls = [];
  try {
    recalls = (await api('GET', '/api/recalls')).recalls;
  } catch { /* bare ny */ }
  const title = h('input', { maxLength: 120, placeholder: `Tilbakekalling ${fmtDate(today())}` });
  const rNew = h('input', { type: 'radio', name: 'rc', checked: true });
  const rOld = h('input', { type: 'radio', name: 'rc' });
  const oldSel = h('select', { onchange: () => { rOld.checked = true; } }, recalls.map((r) => h('option', { value: r.id }, `${r.title} (${fmtDate(r.opened_date)})`)));
  title.addEventListener('focus', () => { rNew.checked = true; });
  const errBox = h('div');
  const ok = h('button', { class: 'btn-danger', onclick: async () => {
    await busy(ok, 'Lagrer …', async () => {
      try {
        const body = { pallet_ids: chosen.map((p) => p.id) };
        if (rOld.checked && oldSel.value) body.recall_id = Number(oldSel.value);
        else body.title = title.value;
        const r = await api('POST', '/api/recalls', body);
        closeDialog();
        location.hash = `#tilbake/${r.recall_id}`;
      } catch (err) {
        setMsg(errBox, msg('err', err.message));
      }
    });
  } }, `Merk ${chosen.length} ${chosen.length === 1 ? 'pall' : 'paller'} som berørt`);
  openDialog(
    h('h2', { style: 'margin-top:0' }, 'Tilbakekalling'),
    h('p', {}, `Valgte paller: ${chosen.map((p) => p.pallet_no).join(', ')}`),
    h('label', { class: 'radio' }, rNew, 'Ny tilbakekalling'),
    field('Kort beskrivelse (valgfritt)', title),
    recalls.length ? [h('label', { class: 'radio' }, rOld, 'Legg til i eksisterende'), oldSel] : null,
    h('p', { class: 'hint', style: 'margin-top:12px' }, 'Leveringshistorikken endres ikke. Sperring og varsling gjøres i neste steg.'),
    errBox,
    h('div', { class: 'actions' }, ok, h('button', { onclick: closeDialog }, 'Avbryt')),
  );
}

// ---------------------------------------------------------------------------
// Pall – detaljer, rettelser og historikk
// ---------------------------------------------------------------------------

const FIELD_LABELS = {
  pallet_no: 'Pallnummer', lay_from: 'Verpet fra', lay_to: 'Verpet til', trays: 'Antall brett',
  packed_date: 'Pakkedato', delivery_id: 'Levering', blocked: 'Sperret', voided: 'Annullert',
  store_id: 'Butikk', order_ref: 'Ordre-/fakturanr', delivery_date: 'Leveringsdato', recall_id: 'Tilbakekalling',
  name: 'Navn', phone: 'Telefon', email: 'E-post',
};

async function viewPallet(id, flash) {
  render(h('p', { class: 'muted' }, 'Laster …'));
  let data;
  try {
    data = await api('GET', `/api/pallets/${id}`);
  } catch (err) {
    return render(msg('err', err.message));
  }
  const { pallet: p, history, deliveries, recalls, stores } = data;
  const dMap = new Map(deliveries.map((d) => [d.id, d]));
  const sMap = new Map(stores.map((s) => [s.id, s.name]));
  const rMap = new Map(recalls.map((r) => [r.id, r]));

  const fmtVal = (k, v) => {
    if (v == null || v === '') return '–';
    if (k === 'delivery_id') {
      const d = dMap.get(v);
      return d ? `${d.store_name}, ordre ${d.order_ref}` : `#${v}`;
    }
    if (k === 'store_id') return sMap.get(v) || `#${v}`;
    if (k === 'recall_id') return rMap.get(v)?.title || `#${v}`;
    if (k === 'blocked' || k === 'voided') return v ? 'Ja' : 'Nei';
    if (/date|lay_/.test(k)) return fmtDate(v);
    return String(v);
  };

  const hist = h('ul', { class: 'history' }, history.map((a) => {
    const oldV = a.old_values ? JSON.parse(a.old_values) : null;
    const newV = a.new_values ? JSON.parse(a.new_values) : {};
    const prefix = a.entity === 'levering' ? 'Levering ' : '';
    let changes;
    if (oldV) {
      changes = Object.keys(newV).filter((k) => JSON.stringify(oldV[k]) !== JSON.stringify(newV[k]))
        .map((k) => `${FIELD_LABELS[k] || k}: ${fmtVal(k, oldV[k])} → ${fmtVal(k, newV[k])}`);
    } else {
      changes = Object.entries(newV).filter(([k, v]) => v != null && !['blocked', 'voided', 'delivery_id'].includes(k) || (k === 'delivery_id' && v))
        .map(([k, v]) => `${FIELD_LABELS[k] || k}: ${fmtVal(k, v)}`);
    }
    return h('li', {},
      h('div', { class: 'when' }, `${fmtTime(a.at)} · ${a.user}`),
      h('div', { class: 'what' }, prefix + a.action),
      changes.map((c) => h('div', { class: 'chg' }, c)),
      a.reason ? h('div', { class: 'why' }, `Årsak: ${a.reason}`) : null);
  }));

  const panel = h('div');
  const out = h('div');
  if (flash) out.append(flash);

  function reasonForm(title, fields, submitLabel, send, danger) {
    const reason = h('input', { maxLength: 300, required: true });
    const err = h('div');
    const btn = h('button', { type: 'submit', class: danger ? 'btn-danger' : 'btn-primary' }, submitLabel);
    panel.replaceChildren(h('form', { class: 'card narrow', onsubmit: async (e) => {
      e.preventDefault();
      if (!reason.value.trim()) return setMsg(err, msg('err', 'Skriv en kort årsak til endringen.'));
      await busy(btn, 'Lagrer …', async () => {
        try {
          await send(reason.value);
          viewPallet(id, msg('ok', 'Endringen er lagret', 'Tidligere verdier er bevart i historikken.'));
        } catch (ex) {
          setMsg(err, msg('err', ex.message));
        }
      });
    } },
    h('h2', { style: 'margin-top:0' }, title),
    fields,
    field('Årsak (påkrevd)', reason),
    err,
    h('div', { class: 'actions' }, btn, h('button', { type: 'button', onclick: () => panel.replaceChildren() }, 'Avbryt'))));
    panel.scrollIntoView({ behavior: 'smooth' });
  }

  const actions = [];
  if (p.status !== 'annullert') {
    actions.push(h('button', { class: 'btn-sm', onclick: () => {
      const from = h('input', { type: 'date', value: p.lay_from, max: today() });
      const to = h('input', { type: 'date', value: p.lay_to, max: today() });
      const trays = h('input', { inputMode: 'numeric', value: p.trays });
      reasonForm('Rett verpedato / antall brett',
        [h('div', { class: 'row' }, field('Verpedato fra', from), field('Verpedato til', to)), field('Antall brett', trays)],
        'Lagre rettelse',
        (reason) => api('PUT', `/api/pallets/${id}`, { lay_from: from.value, lay_to: to.value, trays: Number(trays.value), reason }));
    } }, 'Rett verpedato / brett'));
  }
  if (p.status === 'levert') {
    actions.push(h('button', { class: 'btn-sm', onclick: async () => {
      const stores2 = await loadStores(true);
      const st = h('select', {}, storeOptions(stores2, p.store_id));
      const order = h('input', { value: p.order_ref, maxLength: 60 });
      const date = h('input', { type: 'date', value: p.delivery_date });
      reasonForm('Rett levering',
        [h('p', { class: 'hint' }, 'Gjelder hele leveringen, også andre paller på samme levering.'),
          field('Butikk', st), field('Ordre-/fakturanummer', order), field('Leveringsdato', date)],
        'Lagre rettelse',
        (reason) => api('PUT', `/api/deliveries/${p.delivery_id}`, { store_id: Number(st.value), order_ref: order.value, delivery_date: date.value, reason }));
    } }, 'Rett levering'));
    actions.push(h('button', { class: 'btn-sm', onclick: () => reasonForm('Fjern fra levering',
      [h('p', {}, 'Bruk dette bare hvis pallen er ført på feil levering. Pallen blir «på lager» igjen, og den opprinnelige leveringen står i historikken.')],
      'Fjern fra levering', (reason) => api('POST', `/api/pallets/${id}/undeliver`, { reason }), true) }, 'Fjern fra levering'));
  }
  if (p.blocked) {
    actions.push(h('button', { class: 'btn-sm', onclick: () => reasonForm('Opphev sperre', [],
      'Opphev sperre', (reason) => api('POST', `/api/pallets/${id}/unblock`, { reason })) }, 'Opphev sperre'));
  }
  if (p.status === 'lager') {
    actions.push(h('button', { class: 'btn-sm', onclick: () => reasonForm('Annuller pall',
      [h('p', {}, 'Bruk dette for feilregistreringer, f.eks. feil pallnummer. Pallen slettes ikke, og pallnummeret kan ikke brukes igjen. Registrer deretter riktig pall på nytt.')],
      'Annuller pall', (reason) => api('POST', `/api/pallets/${id}/void`, { reason }), true) }, 'Annuller (feilregistrering)'));
  }
  if (p.status === 'annullert') {
    actions.push(h('button', { class: 'btn-sm', onclick: () => reasonForm('Opphev annullering', [],
      'Opphev annullering', (reason) => api('POST', `/api/pallets/${id}/unvoid`, { reason })) }, 'Opphev annullering'));
  }

  render(
    h('p', {}, h('a', { href: 'javascript:history.back()' }, '← Tilbake')),
    h('h1', {}, `Pall ${p.pallet_no} `, badges(p)),
    out,
    h('div', { class: 'card' },
      h('dl', { class: 'facts' },
        h('dt', {}, 'Verpeperiode'), h('dd', {}, period(p.lay_from, p.lay_to)),
        h('dt', {}, 'Antall'), h('dd', {}, eggs(p.trays)),
        h('dt', {}, 'Pakket'), h('dd', {}, `${fmtDate(p.packed_date)} av ${p.created_by}`),
        h('dt', {}, 'Butikk'), h('dd', {}, p.store_name || '–'),
        h('dt', {}, 'Ordre/faktura'), h('dd', {}, p.order_ref || '–'),
        h('dt', {}, 'Leveringsdato'), h('dd', {}, fmtDate(p.delivery_date) || '–'),
        p.recall_ids.length ? [h('dt', {}, 'Tilbakekalling'),
          h('dd', {}, p.recall_ids.map((rid, i) => [i ? ', ' : '', h('a', { href: `#tilbake/${rid}` }, rMap.get(rid)?.title || `#${rid}`)]))] : null),
      actions.length ? h('div', { class: 'actions', style: 'margin-top:16px' }, actions) : null),
    panel,
    h('h2', {}, 'Historikk'),
    hist,
  );
}

// ---------------------------------------------------------------------------
// Tilbakekalling
// ---------------------------------------------------------------------------

async function viewRecall(id, flash) {
  render(h('p', { class: 'muted' }, 'Laster …'));
  let o;
  try {
    o = await api('GET', `/api/recalls/${id}`);
  } catch (err) {
    return render(msg('err', err.message));
  }
  const { recall, pallets, stores, summary: s } = o;
  const out = h('div');
  if (flash) out.append(flash);

  const blockBtn = s.in_stock_unblocked
    ? h('button', { class: 'btn-danger btn-block', onclick: async () => {
        if (!confirm(`Sperre ${s.in_stock_unblocked} paller på lager? De kan da ikke leveres.`)) return;
        await busy(blockBtn, 'Sperrer …', async () => {
          try {
            const r = await api('POST', `/api/recalls/${id}/block`, {});
            viewRecall(id, msg('ok', `${r.blocked} ${r.blocked === 1 ? 'pall er' : 'paller er'} sperret`));
          } catch (err) {
            setMsg(out, msg('err', err.message));
          }
        });
      } }, `Sperr ${s.in_stock_unblocked} ${s.in_stock_unblocked === 1 ? 'pall' : 'paller'} på lager`)
    : null;

  const stock = pallets.filter((p) => p.status === 'lager');

  const storeCards = stores.map((st) => {
    const noticeBox = h('div');
    function renderNotice(editing) {
      const n = st.notice;
      if (n && !editing) {
        noticeBox.replaceChildren(
          msg('ok', `Butikk varslet ${fmtDate(n.notified_date)}`,
            [n.note ? `Oppfølging: ${n.note}` : null, `Registrert av ${n.updated_by || n.created_by}`].filter(Boolean).join(' · ')),
          h('button', { class: 'btn-link', onclick: () => renderNotice(true) }, 'Endre varsling'));
        return;
      }
      const date = h('input', { type: 'date', value: n?.notified_date || today(), max: today() });
      const note = h('textarea', { maxLength: 500, placeholder: 'f.eks. Snakket med butikksjef, varer tatt ut av hylla' }, n?.note || '');
      const err = h('div');
      const btn = h('button', { type: 'submit', class: 'btn-primary' }, 'Registrer «Butikk varslet»');
      noticeBox.replaceChildren(h('form', { onsubmit: async (e) => {
        e.preventDefault();
        await busy(btn, 'Lagrer …', async () => {
          try {
            await api('POST', `/api/recalls/${id}/notices`, { store_id: st.id, notified_date: date.value, note: note.value });
            viewRecall(id, msg('ok', `Varsling av ${st.name} er registrert`));
          } catch (ex) {
            setMsg(err, msg('err', ex.message));
          }
        });
      } },
      n ? null : h('p', {}, h('span', { class: 'badge b-sperret' }, 'Ikke varslet')),
      h('div', { class: 'row stack-sm' }, field('Dato varslet', date), h('div')),
      field('Kort notat om oppfølging', note),
      err,
      h('div', { class: 'actions' }, btn, editing ? h('button', { type: 'button', onclick: () => renderNotice(false) }, 'Avbryt') : null)));
    }
    renderNotice(false);
    return h('div', { class: 'card store-card' },
      h('h3', {}, st.name),
      h('p', { class: 'small' },
        st.phone ? h('a', { href: `tel:${st.phone}` }, st.phone) : null,
        st.phone && st.email ? ' · ' : null,
        st.email ? h('a', { href: `mailto:${st.email}` }, st.email) : null,
        !st.phone && !st.email ? h('span', { class: 'muted' }, 'Ingen kontaktinfo registrert') : null),
      h('p', {}, h('b', {}, `${st.pallets} ${st.pallets === 1 ? 'pall' : 'paller'} · ${eggs(st.trays)}`)),
      h('table', { class: 'list', style: 'margin-bottom:12px' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Leveringsdato'), h('th', {}, 'Ordre/faktura'), h('th', {}, 'Paller'), h('th', { class: 'num' }, 'Brett'))),
        h('tbody', {}, st.deliveries.map((d) => h('tr', {},
          h('td', { 'data-l': 'Levert' }, fmtDate(d.delivery_date)),
          h('td', { 'data-l': 'Ordre' }, d.order_ref),
          h('td', { 'data-l': 'Paller' }, d.pallets.join(', ')),
          h('td', { class: 'num', 'data-l': 'Brett' }, num(d.trays)))))),
      noticeBox);
  });

  const notified = stores.filter((st) => st.notice).length;
  render(
    h('p', {}, h('a', { href: '#oversikt' }, '← Oversikt')),
    h('h1', {}, recall.title),
    h('p', { class: 'muted' }, `Opprettet ${fmtDate(recall.opened_date)} av ${recall.created_by}`),
    out,
    h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('b', {}, s.pallets), 'berørte paller'),
      h('div', { class: 'kpi' }, h('b', {}, s.in_stock), `på lager (${s.in_stock - s.in_stock_unblocked} sperret)`),
      h('div', { class: 'kpi' }, h('b', {}, s.delivered), `levert til ${stores.length} ${stores.length === 1 ? 'butikk' : 'butikker'}`),
      h('div', { class: 'kpi' }, h('b', {}, `${notified}/${stores.length}`), 'butikker varslet')),
    h('div', { class: 'actions', style: 'margin-bottom:16px' },
      h('a', { class: 'btn', href: `/api/recalls/${id}/csv`, download: '' }, '⬇ Eksporter CSV')),
    h('p', { class: 'msg msg-warn' }, 'Appen sender ingen meldinger. Kontakt butikkene selv, og registrer varslingen her.'),

    h('h2', {}, `Paller på lager (${stock.length})`),
    blockBtn,
    stock.length
      ? h('ul', {}, stock.map((p) => h('li', {}, h('a', { href: `#pall/${p.id}` }, `Pall ${p.pallet_no}`), ` · ${period(p.lay_from, p.lay_to)} · ${num(p.trays)} brett `, badges(p))))
      : h('p', { class: 'muted' }, 'Ingen berørte paller på lager.'),

    h('h2', {}, `Butikker som har mottatt berørte paller (${stores.length})`),
    stores.length ? h('div', {}, storeCards) : h('p', { class: 'muted' }, 'Ingen berørte paller er levert.'),

    h('h2', {}, 'Alle berørte paller'),
    h('table', { class: 'list' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Pall'), h('th', {}, 'Verpeperiode'), h('th', { class: 'num' }, 'Brett'), h('th', {}, 'Status'), h('th', {}, 'Butikk'), h('th', {}, 'Ordre'), h('th', {}, 'Levert'))),
      h('tbody', {}, pallets.map((p) => h('tr', {},
        h('td', { 'data-l': 'Pall' }, h('a', { class: 'pno', href: `#pall/${p.id}` }, p.pallet_no)),
        h('td', { 'data-l': 'Verpet' }, period(p.lay_from, p.lay_to)),
        h('td', { class: 'num', 'data-l': 'Brett' }, num(p.trays)),
        h('td', {}, badges(p)),
        h('td', { 'data-l': 'Butikk' }, p.store_name || '–'),
        h('td', { 'data-l': 'Ordre' }, p.order_ref || '–'),
        h('td', { 'data-l': 'Levert' }, fmtDate(p.delivery_date) || '–'))))),
  );
}

// ---------------------------------------------------------------------------
// Ruting
// ---------------------------------------------------------------------------

async function router() {
  const hash = location.hash.slice(1) || 'ny';
  const [path, query] = hash.split('?');
  const [name, arg] = path.split('/');
  const tab = { ny: 'ny', levering: 'levering', oversikt: 'oversikt', pall: 'oversikt', tilbake: 'oversikt' }[name] || 'ny';
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  if (dialog.open) closeDialog();
  window.scrollTo(0, 0);
  renderedDay = today();
  if (name === 'levering') return viewDelivery();
  if (name === 'oversikt') return viewOverview(query);
  if (name === 'pall' && arg) return viewPallet(Number(arg));
  if (name === 'tilbake' && arg) return viewRecall(Number(arg));
  return viewNew();
}

async function start() {
  try {
    me = await api('GET', '/api/me');
    document.getElementById('who').textContent = me.user;
  } catch (err) {
    render(msg('err', err.message));
    return;
  }
  window.addEventListener('hashchange', router);
  // Ny dag siden skjermbildet ble tegnet (appen har stått åpen over natten): tegn på nytt med dagens dato.
  const newDay = () => { if (!document.hidden && renderedDay !== today()) router(); };
  document.addEventListener('visibilitychange', newDay);
  window.addEventListener('focus', newDay);
  router();
}

start();
