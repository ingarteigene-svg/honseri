/**
 * Hønseri — synk-motor for Google Regneark
 * ----------------------------------------
 * Dette skriptet gjer regnearket ditt til felles database for Hønseri-appen.
 * Alle telefonar med synk-adressa sender registreringane sine hit, og hentar
 * fellesloggen tilbake. Sjå README.md i prosjektet for oppsett-steg.
 *
 * Arket «Data» blir oppretta automatisk med riktige kolonnar første gong.
 */

const SHEET_NAME = 'Data';
const HEADERS = ['id','navn','dato','egg','store','vanlige','kartonger','klink',
                 'pall200','pall228','for','vann','dode','timer','kommentar','updatedAt'];

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** GET → heile fellesloggen som JSON */
function doGet() {
  const sh = sheet_();
  const last = sh.getLastRow();
  const entries = [];
  if (last > 1) {
    const rows = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
    rows.forEach(r => {
      const e = {};
      HEADERS.forEach((h, i) => e[h] = r[i]);
      if (e.id !== '' && e.dato !== '') {
        // Dato kan kome tilbake som Date-objekt frå arket — normaliser til ÅÅÅÅ-MM-DD
        if (Object.prototype.toString.call(e.dato) === '[object Date]') {
          e.dato = Utilities.formatDate(e.dato, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        }
        entries.push(e);
      }
    });
  }
  return json_({ ok: true, entries: entries });
}

/** POST → upsert eller delete, éi endring per kall */
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const op = JSON.parse(e.postData.contents);
    if (op.action === 'upsert' && op.entry && op.entry.id != null) {
      upsert_(op.entry);
      return json_({ ok: true });
    }
    if (op.action === 'delete' && op.id != null) {
      remove_(op.id);
      return json_({ ok: true });
    }
    return json_({ ok: false, error: 'ukjend handling' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function findRow_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function upsert_(entry) {
  const sh = sheet_();
  const row = HEADERS.map(h => entry[h] != null ? entry[h] : '');
  const at = findRow_(sh, entry.id);
  if (at > 0) sh.getRange(at, 1, 1, HEADERS.length).setValues([row]);
  else sh.appendRow(row);
}

function remove_(id) {
  const sh = sheet_();
  const at = findRow_(sh, id);
  if (at > 0) sh.deleteRow(at);
}
