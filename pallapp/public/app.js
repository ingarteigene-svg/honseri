// Pallsporing – Klokkargarden. Grensesnitt (ingen rammeverk, ingen byggesteg).
// Data lagres i Excel-filen i OneDrive for Business (se excel.js og core.js).
// Nettleseren husker bare sist brukte verpedato og pallstørrelse for å spare tasting.

import {
  EGG_PER_TRAY, T, UserError, cmd, search, palletView, palletHistory, recallOverview, recallCsv,
  recallList, storeList, osloToday, normalizePalletNo,
} from './core.js';
import { Workbook, DataStore, AuthExpiredError } from './excel.js';
import { initAuth } from './auth.js';

const PALLET_SIZES = [200, 228];
const cfg = window.PALL_CONFIG || {};
const view = document.getElementById('view');
const dialog = document.getElementById('dialog');
let auth;
let data;

// ---------------------------------------------------------------------------
// Hjelpere
// ---------------------------------------------------------------------------

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
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
const clean = (children) => children.flat(Infinity).filter((c) => c != null && c !== false);
const render = (...children) => view.replaceChildren(...clean(children));

const nf = new Intl.NumberFormat('nb-NO');
const num = (n) => nf.format(n);
const fmtDate = (s) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '');
const period = (a, b) => (a === b ? fmtDate(a) : `${fmtDate(a)} – ${fmtDate(b)}`);
const fmtTs = (ts) => (ts ? `${fmtDate(ts.slice(0, 10))} ${ts.slice(11, 16)}` : '');
const eggs = (trays) => `${num(trays)} brett (${num(trays * EGG_PER_TRAY)} egg)`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const today = () => osloToday();

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
  if (p.recalls?.length) out.push(h('span', { class: 'badge b-berort' }, 'Berørt'));
  return out;
}
const local = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignorer */ } },
};

/** Feilmelding for brukeren. Ukjente feil sier alltid at ingenting ble lagret. */
function errorText(e, writing = true) {
  if (e instanceof AuthExpiredError) {
    showLoginExpired();
    return `Innloggingen må fornyes.${writing ? ' Ingenting ble lagret.' : ''}`;
  }
  if (e instanceof UserError) return e.message;
  return `${e.message}${writing && !/lagret|Lagring|bekrefte/.test(e.message) ? ' Ingenting ble lagret.' : ''}`;
}

function showLoginExpired() {
  if (document.getElementById('login-expired')) return;
  document.body.prepend(h('div', { id: 'login-expired', class: 'msg msg-warn', style: 'margin:12px' },
    'Innloggingen må fornyes. ',
    h('button', { class: 'btn-primary btn-sm', onclick: () => auth.login() }, 'Logg inn på nytt')));
}

async function busy(button, text, fn) {
  const old = button.textContent;
  button.disabled = true;
  button.textContent = text;
  try { return await fn(); } finally { button.disabled = false; button.textContent = old; }
}

function openDialog(...children) { dialog.replaceChildren(...clean(children)); dialog.showModal(); }
function closeDialog() { dialog.close(); }

function storeOptions(stores, selected, emptyLabel = 'Velg butikk …') {
  return [h('option', { value: '' }, emptyLabel),
    ...stores.map((s) => h('option', { value: s.id, selected: s.id === selected }, s.name))];
}

/** Leser Excel på nytt. Viser feil i visningen hvis det ikke går. */
async function loadOrFail(title) {
  try {
    await data.load();
    return true;
  } catch (e) {
    render(h('h1', {}, title), msg('err', errorText(e, false)),
      h('button', { class: 'btn-primary', onclick: () => router() }, 'Prøv igjen'));
    return false;
  }
}

function loading(title) {
  render(h('h1', {}, title), h('p', { class: 'muted' }, 'Henter data fra Excel …'));
}

function tamperWarning() {
  const t = data.tampered;
  if (data.outOfOrder) {
    return msg('warn', 'Advarsel: Rekkefølgen i Excel-arket «Hendelser» ser ut til å være endret (sortert)',
      'Rekkefølgen avgjør hvem som registrerte først. Gjenopprett forrige versjon av filen via versjonsloggen i OneDrive. Bruk filter – ikke sortering – i arket.');
  }
  if (!t.length) return null;
  return msg('warn', `Advarsel: ${plural(t.length, 'rad', 'rader')} i Excel-arket er endret eller lagt inn utenfor appen`,
    `Rad ${t.slice(0, 10).map((x) => x.row).join(', ')}${t.length > 10 ? ' …' : ''}. Kontroller versjonsloggen for filen i OneDrive.`);
}

// ---------------------------------------------------------------------------
// 1. Ny pall
// ---------------------------------------------------------------------------

function viewNew() {
  const last = local.get('pall.sist') || {};
  const sameDay = last.dato === today();
  const result = h('div');
  const todayList = h('div');

  const no = h('input', {
    class: 'big', id: 'pallet_no', inputMode: 'numeric', autocomplete: 'off', autocapitalize: 'characters',
    enterKeyHint: 'done', maxLength: 20, 'aria-label': 'Pallnummer',
  });
  const from = h('input', { type: 'date', id: 'lay_from', max: today(), value: sameDay && last.fra ? last.fra : today() });
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
    onclick: () => { trays = n; otherWrap.classList.add('hidden'); other.value = ''; upd(); },
  }, h('b', {}, String(n)), h('span', {}, 'brett')));
  const otherBtn = h('button', { type: 'button', class: 'btn-link', onclick: () => {
    trays = 'annet'; otherWrap.classList.remove('hidden'); other.focus(); upd();
  } }, 'Annet antall');
  other.addEventListener('input', upd);
  if (Number.isInteger(last.brett) && !PALLET_SIZES.includes(last.brett)) { trays = 'annet'; other.value = last.brett; otherWrap.classList.remove('hidden'); }
  const trayValue = () => (trays === 'annet' ? Number(other.value) : trays);
  function upd() {
    sizeBtns.forEach((b) => {
      const on = Number(b.dataset.size) === trays;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const n = trayValue();
    eggHint.textContent = Number.isInteger(n) && n > 0 ? `= ${num(n * EGG_PER_TRAY)} egg` : 'Velg pallstørrelse';
  }
  upd();

  const save = h('button', { type: 'submit', class: 'btn-primary btn-block' }, 'Lagre pall');
  const form = h('form', { class: 'card narrow', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    setMsg(result, null);
    await busy(save, 'Lagrer i Excel …', async () => {
      try {
        const input = {
          pallet_no: no.value, lay_from: from.value,
          lay_to: toWrap.classList.contains('hidden') ? from.value : to.value, trays: trayValue(),
        };
        const events = cmd.registerPallet(data.state, input, data.ctx());
        await data.commit(events);
        const ev = events[0];
        local.set('pall.sist', { dato: today(), fra: ev.lay_from, til: ev.lay_to, brett: ev.trays });
        setMsg(result, msg('ok', `Pall ${ev.pallet} er lagret`,
          `Verpet ${period(ev.lay_from, ev.lay_to)} · ${eggs(ev.trays)} · pakket ${fmtDate(ev.packed)} av ${ev.user}`));
        navigator.vibrate?.(60);
        no.value = '';
        no.focus();
        renderToday(todayList);
      } catch (err) {
        setMsg(result, msg('err', errorText(err)));
      }
    });
  } },
  field('Pallnummer (fra kortet)', no),
  h('div', { class: 'row stack-sm' }, field('Verpedato', from), toWrap),
  toggle,
  h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Pallstørrelse'),
    h('div', { class: 'sizes' }, sizeBtns), otherBtn, otherWrap, eggHint),
  save);

  render(h('h1', {}, 'Ny pall'), result, form, todayList);
  no.focus();
  // Hent data i bakgrunnen (forhåndskontroll av pallnummer + dagens liste)
  data.load().then(() => renderToday(todayList)).catch(() => {});
}

function renderToday(container) {
  if (!data.state) return;
  const list = search(data.state).filter((p) => p.packed === today());
  if (!list.length) return container.replaceChildren();
  container.replaceChildren(
    h('h2', {}, `Pakket i dag (${list.length})`),
    h('p', { class: 'muted small' }, `Totalt ${eggs(list.reduce((n, p) => n + p.trays, 0))}`),
    h('ul', { class: 'small' }, list.slice(0, 15).map((p) =>
      h('li', {}, h('a', { href: `#pall/${encodeURIComponent(p.no)}` }, `Pall ${p.no}`), ` · ${period(p.lay_from, p.lay_to)} · ${num(p.trays)} brett · ${p.created_by}`))),
  );
}

// ---------------------------------------------------------------------------
// 2. Levering
// ---------------------------------------------------------------------------

async function viewDelivery(flash) {
  loading('Levering');
  if (!(await loadOrFail('Levering'))) return;
  const state = data.state;
  const result = h('div');
  if (flash) result.append(flash);

  const pallets = search(state, { status: 'lager' }).sort((a, b) => a.no.localeCompare(b.no, 'nb', { numeric: true }));
  const selected = new Set();
  const sumText = h('span', { class: 'sumtext' });
  const tileEls = pallets.map((p) => {
    const cb = h('input', { type: 'checkbox', 'aria-label': `Pall ${p.no}` });
    const tile = h('label', { class: 'tile' }, cb,
      h('div', {}, h('b', {}, `Pall ${p.no}`), h('small', {}, `Verpet ${period(p.lay_from, p.lay_to)} · ${num(p.trays)} brett`)));
    cb.addEventListener('change', () => {
      cb.checked ? selected.add(p.no) : selected.delete(p.no);
      tile.classList.toggle('sel', cb.checked);
      updSum();
    });
    tile.dataset.no = p.no;
    return tile;
  });
  const filter = h('input', { type: 'search', placeholder: 'Finn pallnummer …', inputMode: 'numeric', 'aria-label': 'Finn pall' });
  filter.addEventListener('input', () => {
    const q = normalizePalletNo(filter.value);
    for (const t of tileEls) t.classList.toggle('hidden', !!q && !t.dataset.no.includes(q));
  });
  const chosen = () => pallets.filter((p) => selected.has(p.no));
  function updSum() {
    const c = chosen();
    sumText.textContent = c.length ? `${plural(c.length, 'pall', 'paller')} valgt · ${eggs(c.reduce((n, p) => n + p.trays, 0))}` : 'Ingen paller valgt';
  }
  updSum();

  const stores = storeList(state);
  const storeSel = h('select', { id: 'store', 'aria-label': 'Butikk' }, storeOptions(stores));
  const newStoreBox = h('div', { class: 'hidden' });
  const newStoreBtn = h('button', { type: 'button', class: 'btn-sm', onclick: () => {
    newStoreBox.classList.toggle('hidden');
    if (!newStoreBox.classList.contains('hidden')) newStoreBox.querySelector('input').focus();
  } }, '+ Ny butikk');
  newStoreBox.append(storeForm(null, (storeId) => {
    storeSel.replaceChildren(...storeOptions(storeList(data.state), storeId));
    newStoreBox.classList.add('hidden');
    renderStoreAdmin();
  }));

  const orderRef = h('input', { id: 'order_ref', autocomplete: 'off', maxLength: 60, 'aria-label': 'Ordre-/fakturanummer' });
  const date = h('input', { type: 'date', id: 'delivery_date', value: today(), 'aria-label': 'Leveringsdato' });

  const submit = h('button', { type: 'button', class: 'btn-primary', onclick: () => {
    setMsg(result, null);
    const c = chosen();
    try {
      // Validering før bekreftelse (samme regler som ved lagring)
      cmd.deliver(data.state, { pallets: c.map((p) => p.no), store_id: storeSel.value, order: orderRef.value, date: date.value }, data.ctx());
    } catch (err) {
      return setMsg(result, msg('err', errorText(err, false)));
    }
    confirmDelivery(c, data.state.stores.get(storeSel.value));
  } }, 'Registrer levering');

  function confirmDelivery(c, st) {
    const total = c.reduce((n, p) => n + p.trays, 0);
    const errBox = h('div');
    const ok = h('button', { class: 'btn-primary', onclick: async () => {
      await busy(ok, 'Lagrer i Excel …', async () => {
        try {
          const events = cmd.deliver(data.state, { pallets: c.map((p) => p.no), store_id: st.id, order: orderRef.value, date: date.value }, data.ctx());
          await data.commit(events);
          closeDialog();
          const e0 = events[0];
          viewDelivery(msg('ok', 'Levering registrert',
            `${plural(events.length, 'pall', 'paller')} (${events.map((e) => e.pallet).join(', ')}) · ${eggs(total)} til ${st.name}, ordre ${e0.order}, ${fmtDate(e0.delivery_date)}`));
        } catch (err) {
          setMsg(errBox, msg('err', errorText(err)));
        }
      });
    } }, 'Bekreft levering');
    openDialog(
      h('h2', { style: 'margin-top:0' }, 'Bekreft levering'),
      h('dl', { class: 'facts' },
        h('dt', {}, 'Butikk'), h('dd', {}, st.name),
        h('dt', {}, 'Ordre/faktura'), h('dd', {}, orderRef.value.trim()),
        h('dt', {}, 'Leveringsdato'), h('dd', {}, fmtDate(date.value))),
      h('ul', { class: 'confirm-list' }, c.map((p) => h('li', {}, h('b', {}, `Pall ${p.no}`), h('span', {}, `${num(p.trays)} brett`)))),
      h('p', {}, h('b', {}, `Totalt ${plural(c.length, 'pall', 'paller')} · ${eggs(total)}`)),
      errBox,
      h('div', { class: 'actions' }, ok, h('button', { onclick: closeDialog }, 'Avbryt')),
    );
    ok.focus();
  }

  const storeAdmin = h('details', { class: 'card' });
  function renderStoreAdmin() {
    const list = storeList(data.state);
    storeAdmin.replaceChildren(
      h('summary', { style: 'font-weight:700;cursor:pointer;min-height:44px;display:flex;align-items:center' }, `Butikker (${list.length})`),
      list.length ? h('ul', { class: 'history', style: 'margin-top:10px' }, list.map((s) => {
        const li = h('li', {},
          h('div', { class: 'what' }, s.name),
          h('div', { class: 'small muted' }, [s.phone, s.email].filter(Boolean).join(' · ') || 'Ingen kontaktinfo'),
          h('button', { class: 'btn-link', onclick: () => {
            li.replaceChildren(storeForm(s, () => viewDelivery(msg('ok', 'Butikken er oppdatert')), () => renderStoreAdmin()));
          } }, 'Endre'));
        return li;
      })) : h('p', { class: 'muted' }, 'Ingen butikker ennå. Bruk «+ Ny butikk».'),
    );
  }
  renderStoreAdmin();

  render(
    h('h1', {}, 'Levering'),
    result,
    h('div', { class: 'card' },
      h('h2', { style: 'margin-top:0' }, `1. Velg paller på lager (${pallets.length})`),
      pallets.length > 8 ? h('div', { style: 'margin-bottom:12px' }, filter) : null,
      pallets.length ? h('div', { class: 'tiles' }, tileEls) : h('p', { class: 'muted' }, 'Ingen paller på lager.')),
    h('div', { class: 'card narrow' },
      h('h2', { style: 'margin-top:0' }, '2. Butikk og ordre'),
      field('Butikk', storeSel),
      newStoreBtn, newStoreBox,
      h('div', { style: 'height:12px' }),
      field('Ordre-/fakturanummer', orderRef),
      field('Leveringsdato', date)),
    h('div', { class: 'sumbar' }, sumText, submit),
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
        const input = { name: name.value, phone: phone.value, email: email.value, reason: reason.value };
        const events = s ? cmd.correctStore(data.state, s.id, input, data.ctx()) : cmd.createStore(data.state, input, data.ctx());
        await data.commit(events);
        setMsg(out, msg('ok', `Butikken «${events[0].store}» er lagret`));
        onSaved(events[0].store_id);
      } catch (err) {
        setMsg(out, msg('err', errorText(err)));
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
  loading('Oversikt og søk');
  if (!(await loadOrFail('Oversikt og søk'))) return;
  const state = data.state;
  const q = new URLSearchParams(params || '');
  const result = h('div');

  const no = h('input', { value: q.get('no') || '', inputMode: 'numeric', autocomplete: 'off' });
  const order = h('input', { value: q.get('order') || '', autocomplete: 'off' });
  const storeSel = h('select', {}, storeOptions(storeList(state), q.get('store'), 'Alle butikker'));
  const from = h('input', { type: 'date', value: q.get('from') || '' });
  const to = h('input', { type: 'date', value: q.get('to') || '' });

  const form = h('form', { class: 'card', onsubmit: (e) => {
    e.preventDefault();
    const p = new URLSearchParams();
    if (no.value.trim()) p.set('no', no.value.trim());
    if (order.value.trim()) p.set('order', order.value.trim());
    if (storeSel.value) p.set('store', storeSel.value);
    if (from.value) p.set('from', from.value);
    if (to.value) p.set('to', to.value);
    const hash = `#oversikt?${p}`;
    if (location.hash === hash) viewOverview(p.toString());
    else location.hash = hash;
  } },
  h('div', { class: 'row' }, field('Pallnummer', no), field('Ordre-/fakturanr', order)),
  field('Butikk', storeSel),
  h('div', { class: 'row' }, field('Verpedato fra', from), field('Verpedato til', to)),
  h('p', { class: 'hint', style: 'margin-top:-8px' }, 'Datosøk finner alle paller der verpeperioden overlapper søkeperioden.'),
  h('div', { class: 'actions' },
    h('button', { type: 'submit', class: 'btn-primary' }, 'Søk'),
    h('button', { type: 'button', onclick: () => { location.hash = '#oversikt'; } }, 'Nullstill')));

  const recalls = recallList(state);
  const recallsBox = recalls.length
    ? [h('h2', {}, 'Tilbakekallinger'), h('ul', {}, recalls.map((r) => h('li', {},
        h('a', { href: `#tilbake/${encodeURIComponent(r.id)}` }, r.title), ` · ${fmtDate(r.date)} · ${plural(r.count, 'pall', 'paller')}`)))]
    : null;

  let hits;
  try {
    hits = search(state, { no: q.get('no'), order: q.get('order'), store: q.get('store'), from: q.get('from'), to: q.get('to') });
  } catch (err) {
    render(h('h1', {}, 'Oversikt og søk'), form, msg('err', errorText(err, false)));
    return;
  }
  const searched = [...q.keys()].length > 0;
  const LIMIT = 500;
  const shown = hits.slice(0, LIMIT);

  const selected = new Set();
  const selText = h('span', { class: 'sumtext' });
  const recallBtn = h('button', { class: 'btn-danger', onclick: () => markAffected(shown.filter((p) => selected.has(p.no))) }, 'Merk som berørt …');
  const bar = h('div', { class: 'sumbar hidden' }, selText, recallBtn);
  const updSel = () => {
    selText.textContent = `${selected.size} valgt`;
    bar.classList.toggle('hidden', !selected.size);
  };
  const rows = shown.map((p) => {
    const cb = h('input', { type: 'checkbox', 'aria-label': `Velg pall ${p.no}` });
    const tr = h('tr', {},
      h('td', { class: 'chk' }, cb),
      h('td', { 'data-l': 'Pall' }, h('a', { class: 'pno', href: `#pall/${encodeURIComponent(p.no)}` }, p.no)),
      h('td', { 'data-l': 'Verpet' }, period(p.lay_from, p.lay_to)),
      h('td', { class: 'num', 'data-l': 'Brett' }, num(p.trays)),
      h('td', {}, badges(p)),
      h('td', { 'data-l': 'Butikk' }, p.store_name || '–'),
      h('td', { 'data-l': 'Ordre' }, p.order || '–'),
      h('td', { 'data-l': 'Levert' }, fmtDate(p.delivery_date) || '–'));
    cb.addEventListener('change', () => {
      cb.checked ? selected.add(p.no) : selected.delete(p.no);
      tr.classList.toggle('sel', cb.checked);
      updSel();
    });
    tr._cb = cb;
    tr._no = p.no;
    return tr;
  });
  const all = h('input', { type: 'checkbox', 'aria-label': 'Velg alle' });
  all.addEventListener('change', () => {
    for (const tr of rows) {
      tr._cb.checked = all.checked;
      all.checked ? selected.add(tr._no) : selected.delete(tr._no);
      tr.classList.toggle('sel', all.checked);
    }
    updSel();
  });

  result.append(
    h('h2', {}, searched ? `Treff: ${plural(hits.length, 'pall', 'paller')}` : `Alle paller (${hits.length})`),
    hits.length ? h('p', { class: 'muted' }, `Totalt ${eggs(hits.reduce((n, p) => n + p.trays, 0))}`,
      hits.length > LIMIT ? ` – viser de ${LIMIT} nyeste, avgrens søket for å se flere.` : '') : null,
    hits.length
      ? h('div', {},
          h('label', { class: 'radio' }, all, 'Velg alle i treffet'),
          h('table', { class: 'list selectable' },
            h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Pall'), h('th', {}, 'Verpeperiode'), h('th', { class: 'num' }, 'Brett'),
              h('th', {}, 'Status'), h('th', {}, 'Butikk'), h('th', {}, 'Ordre/faktura'), h('th', {}, 'Levert'))),
            h('tbody', {}, rows)))
      : h('p', { class: 'muted' }, 'Ingen paller funnet.'),
    bar,
  );
  render(h('h1', {}, 'Oversikt og søk'), tamperWarning(), form, result, recallsBox);
}

function markAffected(chosen) {
  const recalls = recallList(data.state);
  const title = h('input', { maxLength: 120, placeholder: `Tilbakekalling ${fmtDate(today())}` });
  const rNew = h('input', { type: 'radio', name: 'rc', checked: true });
  const rOld = h('input', { type: 'radio', name: 'rc' });
  const oldSel = h('select', { onchange: () => { rOld.checked = true; } }, recalls.map((r) => h('option', { value: r.id }, `${r.title} (${fmtDate(r.date)})`)));
  title.addEventListener('focus', () => { rNew.checked = true; });
  const errBox = h('div');
  const ok = h('button', { class: 'btn-danger', onclick: async () => {
    await busy(ok, 'Lagrer i Excel …', async () => {
      try {
        const input = { pallets: chosen.map((p) => p.no) };
        if (rOld.checked && oldSel.value) input.recall_id = oldSel.value;
        else input.title = title.value;
        const { recallId, events } = cmd.markAffected(data.state, input, data.ctx());
        await data.commit(events);
        closeDialog();
        location.hash = `#tilbake/${encodeURIComponent(recallId)}`;
      } catch (err) {
        setMsg(errBox, msg('err', errorText(err)));
      }
    });
  } }, `Merk ${plural(chosen.length, 'pall', 'paller')} som berørt`);
  openDialog(
    h('h2', { style: 'margin-top:0' }, 'Tilbakekalling'),
    h('p', {}, `Valgte paller: ${chosen.map((p) => p.no).join(', ')}`),
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

function eventLines(e, state) {
  const store = (id, fallback) => state.stores.get(id)?.name || fallback || id;
  switch (e.type) {
    case T.REGISTERED: return [`Verpet ${period(e.lay_from, e.lay_to)} · ${num(e.trays)} brett · pakket ${fmtDate(e.packed)}`];
    case T.CORRECTED: return [`Ny verdi: verpet ${period(e.lay_from, e.lay_to)} · ${num(e.trays)} brett`, `Tidligere: ${e.previous}`];
    case T.DELIVERED: return [`${store(e.store_id, e.store)} · ordre ${e.order} · levert ${fmtDate(e.delivery_date)}`];
    case T.UNDELIVERED: return [`Tidligere: ${e.previous}`];
    case T.DELIVERY_CORRECTED: return [`Ny verdi: ${e.store} · ordre ${e.order} · levert ${fmtDate(e.delivery_date)}`, `Tidligere: ${e.previous}`];
    case T.AFFECTED: return [`Tilbakekalling: ${state.recalls.get(e.recall_id)?.title || e.recall_id}`];
    case T.REJECTED: return [e.text];
    default: return [];
  }
}

async function viewPallet(no, flash) {
  loading(`Pall ${no}`);
  if (!(await loadOrFail(`Pall ${no}`))) return;
  const state = data.state;
  const raw = state.pallets.get(no);
  if (!raw) return render(h('h1', {}, `Pall ${no}`), msg('err', 'Fant ikke pallen.'));
  const p = palletView(state, raw);
  const out = h('div');
  if (flash) out.append(flash);
  const panel = h('div');

  const hist = h('ul', { class: 'history' }, palletHistory(state, no).map((e) => h('li', { class: e.result?.ok === false ? 'rejected' : '' },
    h('div', { class: 'when' }, `${fmtTs(e.ts)} · ${e.user} · rad ${e.row}`),
    h('div', { class: 'what' }, e.type === T.DELIVERY_CORRECTED ? 'LEVERING RETTET (hele leveringen)' : e.type),
    eventLines(e, state).map((l) => h('div', { class: 'chg' }, l)),
    e.reason ? h('div', { class: 'why' }, `Årsak: ${e.reason}`) : null,
    e.result?.ok === false ? h('div', { class: 'why' }, `Ikke gjeldende – avvist: ${e.result.reason}`) : null)));

  function reasonForm(title, fields, submitLabel, build, danger) {
    const reason = h('input', { maxLength: 300 });
    const err = h('div');
    const btn = h('button', { type: 'submit', class: danger ? 'btn-danger' : 'btn-primary' }, submitLabel);
    panel.replaceChildren(h('form', { class: 'card narrow', onsubmit: async (e) => {
      e.preventDefault();
      await busy(btn, 'Lagrer i Excel …', async () => {
        try {
          await data.commit(build(reason.value));
          viewPallet(no, msg('ok', 'Endringen er lagret', 'Tidligere verdier er bevart i historikken og i Excel.'));
        } catch (ex) {
          setMsg(err, msg('err', errorText(ex)));
        }
      });
    } },
    h('h2', { style: 'margin-top:0' }, title), fields, field('Årsak (påkrevd)', reason), err,
    h('div', { class: 'actions' }, btn, h('button', { type: 'button', onclick: () => panel.replaceChildren() }, 'Avbryt'))));
    panel.scrollIntoView({ behavior: 'smooth' });
  }
  const action = (a) => (reason) => cmd.palletAction(data.state, no, a, reason, data.ctx());

  const actions = [];
  if (p.status !== 'annullert') {
    actions.push(h('button', { class: 'btn-sm', onclick: () => {
      const f = h('input', { type: 'date', value: p.lay_from, max: p.packed });
      const t = h('input', { type: 'date', value: p.lay_to, max: p.packed });
      const tr = h('input', { inputMode: 'numeric', value: p.trays });
      reasonForm('Rett verpedato / antall brett',
        [h('div', { class: 'row' }, field('Verpedato fra', f), field('Verpedato til', t)), field('Antall brett', tr)],
        'Lagre rettelse',
        (reason) => cmd.correctPallet(data.state, no, { lay_from: f.value, lay_to: t.value, trays: Number(tr.value), reason }, data.ctx()));
    } }, 'Rett verpedato / brett'));
  }
  if (p.status === 'levert') {
    actions.push(h('button', { class: 'btn-sm', onclick: () => {
      const st = h('select', {}, storeOptions(storeList(data.state), p.store_id));
      const order = h('input', { value: p.order, maxLength: 60 });
      const date = h('input', { type: 'date', value: p.delivery_date });
      reasonForm('Rett levering',
        [h('p', { class: 'hint' }, 'Gjelder hele leveringen, også andre paller på samme levering.'),
          field('Butikk', st), field('Ordre-/fakturanummer', order), field('Leveringsdato', date)],
        'Lagre rettelse',
        (reason) => cmd.correctDelivery(data.state, p.delivery_id, { store_id: st.value, order: order.value, date: date.value, reason }, data.ctx()));
    } }, 'Rett levering'));
    actions.push(h('button', { class: 'btn-sm', onclick: () => reasonForm('Fjern fra levering',
      [h('p', {}, 'Bruk dette bare hvis pallen er ført på feil levering. Pallen blir «på lager» igjen, og den opprinnelige leveringen står i historikken.')],
      'Fjern fra levering', action('undeliver'), true) }, 'Fjern fra levering'));
  }
  if (p.blocked) actions.push(h('button', { class: 'btn-sm', onclick: () => reasonForm('Opphev sperre', [], 'Opphev sperre', action('unblock')) }, 'Opphev sperre'));
  if (p.status === 'lager') {
    actions.push(h('button', { class: 'btn-sm', onclick: () => reasonForm('Annuller pall',
      [h('p', {}, 'Bruk dette for feilregistreringer, f.eks. feil pallnummer. Pallen slettes ikke, og pallnummeret kan ikke brukes igjen. Registrer deretter riktig pall på nytt.')],
      'Annuller pall', action('void'), true) }, 'Annuller (feilregistrering)'));
  }
  if (p.status === 'annullert') actions.push(h('button', { class: 'btn-sm', onclick: () => reasonForm('Opphev annullering', [], 'Opphev annullering', action('unvoid')) }, 'Opphev annullering'));

  render(
    h('p', {}, h('a', { href: 'javascript:history.back()' }, '← Tilbake')),
    h('h1', {}, `Pall ${p.no} `, badges(p)),
    out,
    h('div', { class: 'card' },
      h('dl', { class: 'facts' },
        h('dt', {}, 'Verpeperiode'), h('dd', {}, period(p.lay_from, p.lay_to)),
        h('dt', {}, 'Antall'), h('dd', {}, eggs(p.trays)),
        h('dt', {}, 'Pakket'), h('dd', {}, `${fmtDate(p.packed)} av ${p.created_by}`),
        h('dt', {}, 'Butikk'), h('dd', {}, p.store_name || '–'),
        h('dt', {}, 'Ordre/faktura'), h('dd', {}, p.order || '–'),
        h('dt', {}, 'Leveringsdato'), h('dd', {}, fmtDate(p.delivery_date) || '–'),
        p.recalls.length ? [h('dt', {}, 'Tilbakekalling'), h('dd', {}, p.recalls.map((rid, i) => [i ? ', ' : '',
          h('a', { href: `#tilbake/${encodeURIComponent(rid)}` }, state.recalls.get(rid)?.title || rid)]))] : null),
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
  loading('Tilbakekalling');
  if (!(await loadOrFail('Tilbakekalling'))) return;
  let o;
  try { o = recallOverview(data.state, id); } catch (err) { return render(msg('err', errorText(err, false))); }
  const { recall, pallets, stores, summary: s } = o;
  const out = h('div');
  if (flash) out.append(flash);

  const blockBtn = s.in_stock_unblocked
    ? h('button', { class: 'btn-danger btn-block', onclick: async () => {
        if (!confirm(`Sperre ${plural(s.in_stock_unblocked, 'pall', 'paller')} på lager? De kan da ikke leveres.`)) return;
        await busy(blockBtn, 'Sperrer …', async () => {
          try {
            const r = await data.commit(cmd.blockRecall(data.state, id, data.ctx()), { allowPartial: true });
            viewRecall(id, msg('ok', `${plural(r.accepted, 'pall er', 'paller er')} sperret`,
              r.rejected ? `${r.rejected} kunne ikke sperres fordi de ikke lenger var på lager.` : null));
          } catch (err) {
            setMsg(out, msg('err', errorText(err)));
          }
        });
      } }, `Sperr ${plural(s.in_stock_unblocked, 'pall', 'paller')} på lager`)
    : null;

  const stock = pallets.filter((p) => p.status === 'lager');
  const storeCards = stores.map((st) => {
    const box = h('div');
    function renderNotice(editing) {
      const n = st.notice;
      if (n && !editing) {
        box.replaceChildren(
          msg('ok', `Butikk varslet ${fmtDate(n.date)}`, [n.note ? `Oppfølging: ${n.note}` : null, `Registrert av ${n.by}`].filter(Boolean).join(' · ')),
          h('button', { class: 'btn-link', onclick: () => renderNotice(true) }, 'Endre varsling'));
        return;
      }
      const date = h('input', { type: 'date', value: n?.date || today(), max: today() });
      const note = h('textarea', { maxLength: 500, placeholder: 'f.eks. Snakket med butikksjef, varer tatt ut av hylla' }, n?.note || '');
      const err = h('div');
      const btn = h('button', { type: 'submit', class: 'btn-primary' }, 'Registrer «Butikk varslet»');
      box.replaceChildren(h('form', { onsubmit: async (e) => {
        e.preventDefault();
        await busy(btn, 'Lagrer i Excel …', async () => {
          try {
            await data.commit(cmd.notify(data.state, { recall_id: id, store_id: st.id, date: date.value, note: note.value }, data.ctx()));
            viewRecall(id, msg('ok', `Varsling av ${st.name} er registrert`));
          } catch (ex) {
            setMsg(err, msg('err', errorText(ex)));
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
      h('p', {}, h('b', {}, `${plural(st.pallets, 'pall', 'paller')} · ${eggs(st.trays)}`)),
      h('table', { class: 'list', style: 'margin-bottom:12px' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Leveringsdato'), h('th', {}, 'Ordre/faktura'), h('th', {}, 'Paller'), h('th', { class: 'num' }, 'Brett'))),
        h('tbody', {}, st.deliveries.map((d) => h('tr', {},
          h('td', { 'data-l': 'Levert' }, fmtDate(d.date)),
          h('td', { 'data-l': 'Ordre' }, d.order),
          h('td', { 'data-l': 'Paller' }, d.pallets.join(', ')),
          h('td', { class: 'num', 'data-l': 'Brett' }, num(d.trays)))))),
      box);
  });

  const csvBtn = h('button', { onclick: () => {
    const blob = new Blob([recallCsv(o)], { type: 'text/csv;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `tilbakekalling-${id}-${today()}.csv` });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  } }, '⬇ Eksporter CSV');

  const notified = stores.filter((st) => st.notice).length;
  render(
    h('p', {}, h('a', { href: '#oversikt' }, '← Oversikt')),
    h('h1', {}, recall.title),
    h('p', { class: 'muted' }, `Opprettet ${fmtDate(recall.date)} av ${recall.created_by}`),
    out,
    h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('b', {}, s.pallets), 'berørte paller'),
      h('div', { class: 'kpi' }, h('b', {}, s.in_stock), `på lager (${s.in_stock - s.in_stock_unblocked} sperret)`),
      h('div', { class: 'kpi' }, h('b', {}, s.delivered), `levert til ${plural(stores.length, 'butikk', 'butikker')}`),
      h('div', { class: 'kpi' }, h('b', {}, `${notified}/${stores.length}`), 'butikker varslet')),
    h('div', { class: 'actions', style: 'margin-bottom:16px' }, csvBtn),
    h('p', { class: 'msg msg-warn' }, 'Appen sender ingen meldinger. Kontakt butikkene selv, og registrer varslingen her.'),
    h('h2', {}, `Paller på lager (${stock.length})`),
    blockBtn,
    stock.length
      ? h('ul', {}, stock.map((p) => h('li', {}, h('a', { href: `#pall/${encodeURIComponent(p.no)}` }, `Pall ${p.no}`), ` · ${period(p.lay_from, p.lay_to)} · ${num(p.trays)} brett `, badges(p))))
      : h('p', { class: 'muted' }, 'Ingen berørte paller på lager.'),
    h('h2', {}, `Butikker som har mottatt berørte paller (${stores.length})`),
    stores.length ? h('div', {}, storeCards) : h('p', { class: 'muted' }, 'Ingen berørte paller er levert.'),
    h('h2', {}, 'Alle berørte paller'),
    h('table', { class: 'list' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Pall'), h('th', {}, 'Verpeperiode'), h('th', { class: 'num' }, 'Brett'), h('th', {}, 'Status'), h('th', {}, 'Butikk'), h('th', {}, 'Ordre'), h('th', {}, 'Levert'))),
      h('tbody', {}, pallets.map((p) => h('tr', {},
        h('td', { 'data-l': 'Pall' }, h('a', { class: 'pno', href: `#pall/${encodeURIComponent(p.no)}` }, p.no)),
        h('td', { 'data-l': 'Verpet' }, period(p.lay_from, p.lay_to)),
        h('td', { class: 'num', 'data-l': 'Brett' }, num(p.trays)),
        h('td', {}, badges(p)),
        h('td', { 'data-l': 'Butikk' }, p.store_name || '–'),
        h('td', { 'data-l': 'Ordre' }, p.order || '–'),
        h('td', { 'data-l': 'Levert' }, fmtDate(p.delivery_date) || '–'))))),
  );
}

// ---------------------------------------------------------------------------
// Ruting og oppstart
// ---------------------------------------------------------------------------

function router() {
  const hash = location.hash.slice(1) || 'ny';
  const [path, query] = hash.split('?');
  const [name, rawArg] = path.split('/');
  const arg = rawArg ? decodeURIComponent(rawArg) : '';
  const tab = { ny: 'ny', levering: 'levering', oversikt: 'oversikt', pall: 'oversikt', tilbake: 'oversikt' }[name] || 'ny';
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  if (dialog.open) closeDialog();
  window.scrollTo(0, 0);
  if (name === 'levering') return viewDelivery();
  if (name === 'oversikt') return viewOverview(query);
  if (name === 'pall' && arg) return viewPallet(arg);
  if (name === 'tilbake' && arg) return viewRecall(arg);
  return viewNew();
}

async function start() {
  if (!cfg.dev && !(cfg.clientId && cfg.tenantId && cfg.fileUrl)) {
    render(h('h1', {}, 'Appen er ikke satt opp ennå'),
      msg('warn', 'Mangler innstillinger for Microsoft 365 og Excel-filen.', 'Se pallapp/README.md, avsnittet «Oppsett».'));
    return;
  }
  try {
    auth = await initAuth(cfg);
    document.getElementById('who').textContent = auth.user;
    const wb = new Workbook({ graphBase: cfg.graphBase, fileUrl: cfg.fileUrl, getToken: auth.getToken });
    data = new DataStore(wb, { user: auth.user });
    await wb.ensureTable();
  } catch (err) {
    render(h('h1', {}, 'Pallsporing'), msg('err', errorText(err, false)),
      h('button', { class: 'btn-primary', onclick: () => location.reload() }, 'Prøv igjen'));
    return;
  }
  window.addEventListener('hashchange', router);
  router();
}

start();
