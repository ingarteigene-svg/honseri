-- Pallsporing – Klokkargarden
-- Grunnskjema. Alle tidspunkt lagres i UTC (ISO 8601). Datoer (verpe-, pakke-,
-- leveringsdato) lagres som ÅÅÅÅ-MM-DD og tolkes som norsk dato.
--
-- Prinsipper:
--  * Ingenting slettes. Sletting er blokkert med triggere på alle tabeller.
--  * Hver innsetting/endring skrives automatisk til audit_log med gamle og nye
--    verdier, hvem og når (triggere). Workeren setter «hvem/hvorfor» i tabellen
--    ctx først i hver transaksjon.
--  * Leveringsstatus (delivery_id) og tilbakekallingsstatus (blocked,
--    recall_pallets) er adskilt.

CREATE TABLE ctx (
  id     INTEGER PRIMARY KEY CHECK (id = 1),
  user   TEXT,
  action TEXT,
  reason TEXT
);
INSERT INTO ctx (id) VALUES (1);

CREATE TABLE stores (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL CHECK (length(trim(name)) > 0),
  name_key   TEXT NOT NULL UNIQUE,
  phone      TEXT,
  email      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by TEXT NOT NULL,
  updated_at TEXT,
  updated_by TEXT
);

CREATE TABLE deliveries (
  id            INTEGER PRIMARY KEY,
  uid           TEXT NOT NULL UNIQUE,
  store_id      INTEGER NOT NULL REFERENCES stores (id),
  order_ref     TEXT NOT NULL CHECK (length(trim(order_ref)) > 0),
  delivery_date TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by    TEXT NOT NULL,
  updated_at    TEXT,
  updated_by    TEXT
);

CREATE TABLE pallets (
  id          INTEGER PRIMARY KEY,
  pallet_no   TEXT NOT NULL UNIQUE,
  lay_from    TEXT NOT NULL,
  lay_to      TEXT NOT NULL,
  trays       INTEGER NOT NULL CHECK (typeof(trays) = 'integer' AND trays > 0),
  packed_date TEXT NOT NULL,
  delivery_id INTEGER REFERENCES deliveries (id),
  blocked     INTEGER NOT NULL DEFAULT 0 CHECK (blocked IN (0, 1)),
  voided      INTEGER NOT NULL DEFAULT 0 CHECK (voided IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by  TEXT NOT NULL,
  updated_at  TEXT,
  updated_by  TEXT,
  CHECK (lay_from <= lay_to)
);
CREATE INDEX pallets_lay ON pallets (lay_from, lay_to);
CREATE INDEX pallets_delivery ON pallets (delivery_id);

CREATE TABLE recalls (
  id          INTEGER PRIMARY KEY,
  title       TEXT NOT NULL CHECK (length(trim(title)) > 0),
  opened_date TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by  TEXT NOT NULL
);

CREATE TABLE recall_pallets (
  recall_id  INTEGER NOT NULL REFERENCES recalls (id),
  pallet_id  INTEGER NOT NULL REFERENCES pallets (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by TEXT NOT NULL,
  PRIMARY KEY (recall_id, pallet_id)
);

CREATE TABLE recall_notices (
  id            INTEGER PRIMARY KEY,
  recall_id     INTEGER NOT NULL REFERENCES recalls (id),
  store_id      INTEGER NOT NULL REFERENCES stores (id),
  notified_date TEXT NOT NULL,
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by    TEXT NOT NULL,
  updated_at    TEXT,
  updated_by    TEXT,
  UNIQUE (recall_id, store_id)
);

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

-- ---------------------------------------------------------------------------
-- Forretningsregler håndhevet i databasen (gjelder også ved samtidige brukere)
-- ---------------------------------------------------------------------------

-- Pallnummer kan aldri endres (feil nummer rettes ved å annullere og registrere på nytt).
CREATE TRIGGER pallets_no_renumber BEFORE UPDATE OF pallet_no ON pallets
WHEN NEW.pallet_no IS NOT OLD.pallet_no
BEGIN
  SELECT RAISE(ABORT, 'PALLNUMMER_LAAST');
END;

-- Nye paller registreres alltid som «på lager».
CREATE TRIGGER pallets_new_in_stock BEFORE INSERT ON pallets
WHEN NEW.delivery_id IS NOT NULL OR NEW.blocked <> 0 OR NEW.voided <> 0
BEGIN
  SELECT RAISE(ABORT, 'NY_PALL_MAA_VAERE_PAA_LAGER');
END;

-- En pall kan bare knyttes til en levering hvis den er på lager, ikke sperret og ikke annullert.
CREATE TRIGGER pallets_guard_delivery BEFORE UPDATE OF delivery_id ON pallets
WHEN NEW.delivery_id IS NOT NULL AND NEW.delivery_id IS NOT OLD.delivery_id
BEGIN
  SELECT RAISE(ABORT, 'ALLEREDE_LEVERT') WHERE OLD.delivery_id IS NOT NULL;
  SELECT RAISE(ABORT, 'PALL_SPERRET') WHERE OLD.blocked = 1;
  SELECT RAISE(ABORT, 'PALL_ANNULLERT') WHERE OLD.voided = 1;
END;

-- Bare paller på lager kan sperres.
CREATE TRIGGER pallets_guard_block BEFORE UPDATE OF blocked ON pallets
WHEN NEW.blocked = 1 AND OLD.blocked = 0
BEGIN
  SELECT RAISE(ABORT, 'KAN_IKKE_SPERRE_LEVERT') WHERE OLD.delivery_id IS NOT NULL;
  SELECT RAISE(ABORT, 'PALL_ANNULLERT') WHERE OLD.voided = 1;
END;

-- En levert pall kan ikke annulleres (fjern den fra leveringen først).
CREATE TRIGGER pallets_guard_void BEFORE UPDATE OF voided ON pallets
WHEN NEW.voided = 1 AND OLD.voided = 0
BEGIN
  SELECT RAISE(ABORT, 'KAN_IKKE_ANNULLERE_LEVERT') WHERE OLD.delivery_id IS NOT NULL;
END;

-- Ingen sletting noe sted, og revisjonsloggen kan ikke endres.
CREATE TRIGGER stores_no_delete BEFORE DELETE ON stores BEGIN SELECT RAISE(ABORT, 'SLETTING_IKKE_TILLATT'); END;
CREATE TRIGGER deliveries_no_delete BEFORE DELETE ON deliveries BEGIN SELECT RAISE(ABORT, 'SLETTING_IKKE_TILLATT'); END;
CREATE TRIGGER pallets_no_delete BEFORE DELETE ON pallets BEGIN SELECT RAISE(ABORT, 'SLETTING_IKKE_TILLATT'); END;
CREATE TRIGGER recalls_no_delete BEFORE DELETE ON recalls BEGIN SELECT RAISE(ABORT, 'SLETTING_IKKE_TILLATT'); END;
CREATE TRIGGER recall_pallets_no_delete BEFORE DELETE ON recall_pallets BEGIN SELECT RAISE(ABORT, 'SLETTING_IKKE_TILLATT'); END;
CREATE TRIGGER recall_notices_no_delete BEFORE DELETE ON recall_notices BEGIN SELECT RAISE(ABORT, 'SLETTING_IKKE_TILLATT'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'SLETTING_IKKE_TILLATT'); END;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'LOGG_KAN_IKKE_ENDRES'); END;

-- ---------------------------------------------------------------------------
-- Revisjonslogg (automatisk). Direkte endringer utenom appen logges som
-- «database-konsoll».
-- ---------------------------------------------------------------------------

CREATE TRIGGER stores_audit_ins AFTER INSERT ON stores BEGIN
  INSERT INTO audit_log (user, entity, entity_id, action, old_values, new_values, reason)
  VALUES (COALESCE((SELECT user FROM ctx WHERE id = 1), 'database-konsoll'), 'butikk', NEW.id,
          COALESCE((SELECT action FROM ctx WHERE id = 1), 'opprettet'), NULL,
          json_object('name', NEW.name, 'phone', NEW.phone, 'email', NEW.email),
          (SELECT reason FROM ctx WHERE id = 1));
END;
CREATE TRIGGER stores_audit_upd AFTER UPDATE ON stores BEGIN
  INSERT INTO audit_log (user, entity, entity_id, action, old_values, new_values, reason)
  VALUES (COALESCE((SELECT user FROM ctx WHERE id = 1), 'database-konsoll'), 'butikk', NEW.id,
          COALESCE((SELECT action FROM ctx WHERE id = 1), 'endret'),
          json_object('name', OLD.name, 'phone', OLD.phone, 'email', OLD.email),
          json_object('name', NEW.name, 'phone', NEW.phone, 'email', NEW.email),
          (SELECT reason FROM ctx WHERE id = 1));
END;

CREATE TRIGGER deliveries_audit_ins AFTER INSERT ON deliveries BEGIN
  INSERT INTO audit_log (user, entity, entity_id, action, old_values, new_values, reason)
  VALUES (COALESCE((SELECT user FROM ctx WHERE id = 1), 'database-konsoll'), 'levering', NEW.id,
          COALESCE((SELECT action FROM ctx WHERE id = 1), 'opprettet'), NULL,
          json_object('store_id', NEW.store_id, 'order_ref', NEW.order_ref, 'delivery_date', NEW.delivery_date),
          (SELECT reason FROM ctx WHERE id = 1));
END;
CREATE TRIGGER deliveries_audit_upd AFTER UPDATE ON deliveries BEGIN
  INSERT INTO audit_log (user, entity, entity_id, action, old_values, new_values, reason)
  VALUES (COALESCE((SELECT user FROM ctx WHERE id = 1), 'database-konsoll'), 'levering', NEW.id,
          COALESCE((SELECT action FROM ctx WHERE id = 1), 'endret'),
          json_object('store_id', OLD.store_id, 'order_ref', OLD.order_ref, 'delivery_date', OLD.delivery_date),
          json_object('store_id', NEW.store_id, 'order_ref', NEW.order_ref, 'delivery_date', NEW.delivery_date),
          (SELECT reason FROM ctx WHERE id = 1));
END;

CREATE TRIGGER pallets_audit_ins AFTER INSERT ON pallets BEGIN
  INSERT INTO audit_log (user, entity, entity_id, action, old_values, new_values, reason)
  VALUES (COALESCE((SELECT user FROM ctx WHERE id = 1), 'database-konsoll'), 'pall', NEW.id,
          COALESCE((SELECT action FROM ctx WHERE id = 1), 'opprettet'), NULL,
          json_object('pallet_no', NEW.pallet_no, 'lay_from', NEW.lay_from, 'lay_to', NEW.lay_to,
                      'trays', NEW.trays, 'packed_date', NEW.packed_date, 'delivery_id', NEW.delivery_id,
                      'blocked', NEW.blocked, 'voided', NEW.voided),
          (SELECT reason FROM ctx WHERE id = 1));
END;
CREATE TRIGGER pallets_audit_upd AFTER UPDATE ON pallets BEGIN
  INSERT INTO audit_log (user, entity, entity_id, action, old_values, new_values, reason)
  VALUES (COALESCE((SELECT user FROM ctx WHERE id = 1), 'database-konsoll'), 'pall', NEW.id,
          COALESCE((SELECT action FROM ctx WHERE id = 1), 'endret'),
          json_object('pallet_no', OLD.pallet_no, 'lay_from', OLD.lay_from, 'lay_to', OLD.lay_to,
                      'trays', OLD.trays, 'packed_date', OLD.packed_date, 'delivery_id', OLD.delivery_id,
                      'blocked', OLD.blocked, 'voided', OLD.voided),
          json_object('pallet_no', NEW.pallet_no, 'lay_from', NEW.lay_from, 'lay_to', NEW.lay_to,
                      'trays', NEW.trays, 'packed_date', NEW.packed_date, 'delivery_id', NEW.delivery_id,
                      'blocked', NEW.blocked, 'voided', NEW.voided),
          (SELECT reason FROM ctx WHERE id = 1));
END;

CREATE TRIGGER recalls_audit_ins AFTER INSERT ON recalls BEGIN
  INSERT INTO audit_log (user, entity, entity_id, action, old_values, new_values, reason)
  VALUES (COALESCE((SELECT user FROM ctx WHERE id = 1), 'database-konsoll'), 'tilbakekalling', NEW.id,
          'opprettet', NULL, json_object('title', NEW.title, 'opened_date', NEW.opened_date),
          (SELECT reason FROM ctx WHERE id = 1));
END;

CREATE TRIGGER recall_pallets_audit_ins AFTER INSERT ON recall_pallets BEGIN
  INSERT INTO audit_log (user, entity, entity_id, action, old_values, new_values, reason)
  VALUES (COALESCE((SELECT user FROM ctx WHERE id = 1), 'database-konsoll'), 'pall', NEW.pallet_id,
          'merket berørt', NULL, json_object('recall_id', NEW.recall_id),
          (SELECT reason FROM ctx WHERE id = 1));
END;

CREATE TRIGGER recall_notices_audit_ins AFTER INSERT ON recall_notices BEGIN
  INSERT INTO audit_log (user, entity, entity_id, action, old_values, new_values, reason)
  VALUES (COALESCE((SELECT user FROM ctx WHERE id = 1), 'database-konsoll'), 'varsel', NEW.id,
          'butikk varslet', NULL,
          json_object('recall_id', NEW.recall_id, 'store_id', NEW.store_id,
                      'notified_date', NEW.notified_date, 'note', NEW.note),
          (SELECT reason FROM ctx WHERE id = 1));
END;
CREATE TRIGGER recall_notices_audit_upd AFTER UPDATE ON recall_notices BEGIN
  INSERT INTO audit_log (user, entity, entity_id, action, old_values, new_values, reason)
  VALUES (COALESCE((SELECT user FROM ctx WHERE id = 1), 'database-konsoll'), 'varsel', NEW.id,
          'varsel endret',
          json_object('recall_id', OLD.recall_id, 'store_id', OLD.store_id,
                      'notified_date', OLD.notified_date, 'note', OLD.note),
          json_object('recall_id', NEW.recall_id, 'store_id', NEW.store_id,
                      'notified_date', NEW.notified_date, 'note', NEW.note),
          (SELECT reason FROM ctx WHERE id = 1));
END;
