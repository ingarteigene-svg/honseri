-- Hønseri – dagleg eggregistrering. Grunnskjema.
-- Alle tidspunkt lagrast i UTC (ISO 8601). Datoar lagrast som ÅÅÅÅ-MM-DD (norsk dato).
--
-- Prinsipp:
--  * Registreringar blir aldri sletta for godt. «Slett» i appen merkjer dei som
--    sletta (deleted = 1), og kan angrast. Hard sletting er blokkert med trigger.
--  * Kvar ny registrering og kvar endring blir skriven til audit_log med gamle og
--    nye verdiar, kven og når (triggerar). Workeren set «kven» i ctx først i kvar
--    transaksjon. Direkte endringar utanom appen blir logga som «database-konsoll».

CREATE TABLE ctx (
  id     INTEGER PRIMARY KEY CHECK (id = 1),
  user   TEXT,
  action TEXT,
  reason TEXT
);
INSERT INTO ctx (id) VALUES (1);

CREATE TABLE entries (
  id         INTEGER PRIMARY KEY,
  uid        TEXT NOT NULL UNIQUE CHECK (length(uid) BETWEEN 1 AND 64),
  navn       TEXT NOT NULL DEFAULT '',
  dato       TEXT NOT NULL CHECK (dato GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  egg        INTEGER NOT NULL DEFAULT 0 CHECK (egg >= 0),
  store      INTEGER NOT NULL DEFAULT 0 CHECK (store >= 0),
  vanlige    INTEGER NOT NULL DEFAULT 0 CHECK (vanlige >= 0),
  kartonger  INTEGER NOT NULL DEFAULT 0 CHECK (kartonger >= 0),
  klink      INTEGER NOT NULL DEFAULT 0 CHECK (klink >= 0),
  pall200    INTEGER NOT NULL DEFAULT 0 CHECK (pall200 >= 0),
  pall228    INTEGER NOT NULL DEFAULT 0 CHECK (pall228 >= 0),
  silo       REAL    NOT NULL DEFAULT 0 CHECK (silo >= 0),
  vann       REAL    NOT NULL DEFAULT 0 CHECK (vann >= 0),
  dode       INTEGER NOT NULL DEFAULT 0 CHECK (dode >= 0),
  timer      REAL    NOT NULL DEFAULT 0 CHECK (timer >= 0 AND timer <= 24),
  kommentar  TEXT,
  deleted    INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by TEXT NOT NULL,
  updated_at TEXT,
  updated_by TEXT,
  -- Ei registrering kan ikkje vere heilt tom
  CHECK (egg + store + vanlige + kartonger + klink + pall200 + pall228 + silo + vann + dode + timer > 0)
);
CREATE INDEX entries_dato ON entries (dato);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY,
  at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  user       TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  INTEGER NOT NULL,
  action     TEXT NOT NULL,
  old_values TEXT,
  new_values TEXT,
  reason     TEXT
);
CREATE INDEX audit_entity ON audit_log (entity, entity_id);

-- Push-varsel: eitt abonnement per telefon (endpoint er unik per nettlesar/app).
CREATE TABLE push_subscriptions (
  id         INTEGER PRIMARY KEY,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  lang       TEXT NOT NULL DEFAULT 'no',
  navn       TEXT,
  user       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_ok_at TEXT,
  fails      INTEGER NOT NULL DEFAULT 0
);

-- Innstillingar som appen lagar sjølv (t.d. VAPID-nøkkelpar for push).
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Maks éi påminning per dag, sjølv om cron-jobben skulle køyre to gonger.
CREATE TABLE reminders_sent (
  dato       TEXT PRIMARY KEY,
  sent_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  recipients INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Reglar
-- ---------------------------------------------------------------------------

CREATE TRIGGER entries_no_delete BEFORE DELETE ON entries
BEGIN
  SELECT RAISE(ABORT, 'SLETTING_IKKE_TILLATT');
END;

CREATE TRIGGER entries_uid_locked BEFORE UPDATE OF uid ON entries
WHEN NEW.uid IS NOT OLD.uid
BEGIN
  SELECT RAISE(ABORT, 'ID_LAAST');
END;

CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'SLETTING_IKKE_TILLATT'); END;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'LOGG_KAN_IKKE_ENDRES'); END;

-- ---------------------------------------------------------------------------
-- Revisjonslogg (automatisk)
-- ---------------------------------------------------------------------------

CREATE TRIGGER entries_audit_ins AFTER INSERT ON entries BEGIN
  INSERT INTO audit_log (user, entity, entity_id, action, old_values, new_values, reason)
  VALUES (COALESCE((SELECT user FROM ctx WHERE id = 1), 'database-konsoll'), 'registrering', NEW.id,
          COALESCE((SELECT action FROM ctx WHERE id = 1), 'oppretta'), NULL,
          json_object('navn', NEW.navn, 'dato', NEW.dato, 'egg', NEW.egg, 'store', NEW.store,
                      'vanlige', NEW.vanlige, 'kartonger', NEW.kartonger, 'klink', NEW.klink,
                      'pall200', NEW.pall200, 'pall228', NEW.pall228, 'silo', NEW.silo, 'vann', NEW.vann,
                      'dode', NEW.dode, 'timer', NEW.timer, 'kommentar', NEW.kommentar, 'deleted', NEW.deleted),
          (SELECT reason FROM ctx WHERE id = 1));
END;

CREATE TRIGGER entries_audit_upd AFTER UPDATE ON entries BEGIN
  INSERT INTO audit_log (user, entity, entity_id, action, old_values, new_values, reason)
  VALUES (COALESCE((SELECT user FROM ctx WHERE id = 1), 'database-konsoll'), 'registrering', NEW.id,
          COALESCE((SELECT action FROM ctx WHERE id = 1), 'endra'),
          json_object('navn', OLD.navn, 'dato', OLD.dato, 'egg', OLD.egg, 'store', OLD.store,
                      'vanlige', OLD.vanlige, 'kartonger', OLD.kartonger, 'klink', OLD.klink,
                      'pall200', OLD.pall200, 'pall228', OLD.pall228, 'silo', OLD.silo, 'vann', OLD.vann,
                      'dode', OLD.dode, 'timer', OLD.timer, 'kommentar', OLD.kommentar, 'deleted', OLD.deleted),
          json_object('navn', NEW.navn, 'dato', NEW.dato, 'egg', NEW.egg, 'store', NEW.store,
                      'vanlige', NEW.vanlige, 'kartonger', NEW.kartonger, 'klink', NEW.klink,
                      'pall200', NEW.pall200, 'pall228', NEW.pall228, 'silo', NEW.silo, 'vann', NEW.vann,
                      'dode', NEW.dode, 'timer', NEW.timer, 'kommentar', NEW.kommentar, 'deleted', NEW.deleted),
          (SELECT reason FROM ctx WHERE id = 1));
END;
