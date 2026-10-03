-- Gårdsbutikk – selvbetjent salg med Vipps og kontant. Grunnskjema.
-- Alle tidspunkt lagres i UTC (ISO 8601). Beløp lagres i øre (heltall).
--
-- Prinsipp:
--  * Ingenting slettes. Feil ordrer annulleres (varene går tilbake på lager),
--    produkter deaktiveres. Sletting er blokkert med triggere.
--  * Lageret er summen av lagerbevegelser (salg, retur, påfyll, telling).
--    Bevegelser kan ikke endres i ettertid, bare motposteres.
--  * Et salg trekker lageret nøyaktig én gang, også om Vipps-bekreftelsen kommer
--    flere ganger (unik indeks på ordre + produkt + type).

CREATE TABLE products (
  id          INTEGER PRIMARY KEY,
  navn        TEXT NOT NULL CHECK (length(navn) BETWEEN 1 AND 60),
  beskrivelse TEXT NOT NULL DEFAULT '',
  emoji       TEXT NOT NULL DEFAULT '🥚',
  pris_ore    INTEGER NOT NULL CHECK (pris_ore > 0 AND pris_ore <= 1000000),
  mva_sats    INTEGER NOT NULL DEFAULT 15 CHECK (mva_sats IN (0, 12, 15, 25)),
  aktiv       INTEGER NOT NULL DEFAULT 1 CHECK (aktiv IN (0, 1)),
  sortering   INTEGER NOT NULL DEFAULT 0,
  lav_grense  INTEGER NOT NULL DEFAULT 3 CHECK (lav_grense >= 0),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT,
  updated_by  TEXT
);

INSERT INTO products (navn, beskrivelse, emoji, pris_ore, sortering) VALUES
  ('Vanlig eggbrett', 'Brett med egg', '🥚', 10000, 1),
  ('XL eggbrett', 'Brett med ekstra store egg', '🥚', 12000, 2),
  ('Klink', 'Brett med klinkegg – fint til baking', '🍳', 4000, 3),
  ('Kartong 10 pk', '10 egg i kartong', '📦', 4000, 4);

CREATE TABLE orders (
  id              INTEGER PRIMARY KEY,
  ref             TEXT NOT NULL UNIQUE CHECK (length(ref) BETWEEN 8 AND 64),
  metode          TEXT NOT NULL CHECK (metode IN ('vipps', 'kontant')),
  status          TEXT NOT NULL CHECK (status IN ('venter', 'betalt', 'avbrutt', 'annullert')),
  sum_ore         INTEGER NOT NULL CHECK (sum_ore > 0),
  mva_ore         INTEGER NOT NULL CHECK (mva_ore >= 0),
  vipps_state     TEXT,
  psp_ref         TEXT,
  ip_hash         TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  checked_at      TEXT,
  paid_at         TEXT,
  closed_at       TEXT,
  annullert_av    TEXT,
  annullert_grunn TEXT
);
CREATE INDEX orders_created ON orders (created_at);
CREATE INDEX orders_paid ON orders (paid_at);
CREATE INDEX orders_status ON orders (status);
CREATE INDEX orders_ip ON orders (ip_hash, created_at);

CREATE TABLE order_lines (
  id         INTEGER PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders (id),
  product_id INTEGER NOT NULL REFERENCES products (id),
  navn       TEXT NOT NULL,
  antall     INTEGER NOT NULL CHECK (antall BETWEEN 1 AND 50),
  pris_ore   INTEGER NOT NULL CHECK (pris_ore > 0),
  mva_sats   INTEGER NOT NULL,
  UNIQUE (order_id, product_id)
);

CREATE TABLE stock_moves (
  id         INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products (id),
  delta      INTEGER NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('salg', 'retur', 'påfyll', 'telling')),
  order_id   INTEGER REFERENCES orders (id),
  telt       INTEGER,
  kommentar  TEXT,
  user       TEXT NOT NULL,
  at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((type IN ('salg', 'retur')) = (order_id IS NOT NULL)),
  CHECK (type <> 'telling' OR telt >= 0),
  CHECK (type <> 'påfyll' OR delta > 0)
);
CREATE INDEX stock_product ON stock_moves (product_id, at);
CREATE UNIQUE INDEX stock_order_once ON stock_moves (order_id, product_id, type) WHERE order_id IS NOT NULL;

-- Kassaoppgjør: hver telling tømmer kassa. Forventet beløp er kontantsalg siden forrige telling.
CREATE TABLE cash_counts (
  id            INTEGER PRIMARY KEY,
  telt_ore      INTEGER NOT NULL CHECK (telt_ore >= 0),
  forventet_ore INTEGER NOT NULL,
  fra           TEXT,
  kommentar     TEXT,
  user          TEXT NOT NULL,
  at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES
  ('butikknavn', 'Klokkargarden gårdsbutikk'),
  ('adresse', 'Hareid'),
  ('orgnr', ''),
  ('kontakt', ''),
  ('melding', '');

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY,
  at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  user       TEXT NOT NULL,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  TEXT,
  old_values TEXT,
  new_values TEXT
);

-- ---------------------------------------------------------------------------
-- Regler
-- ---------------------------------------------------------------------------

CREATE TRIGGER products_no_delete BEFORE DELETE ON products BEGIN SELECT RAISE(ABORT, 'SLETTING_IKKE_TILLATT'); END;
CREATE TRIGGER orders_no_delete BEFORE DELETE ON orders BEGIN SELECT RAISE(ABORT, 'SLETTING_IKKE_TILLATT'); END;
CREATE TRIGGER lines_no_delete BEFORE DELETE ON order_lines BEGIN SELECT RAISE(ABORT, 'SLETTING_IKKE_TILLATT'); END;
CREATE TRIGGER lines_no_update BEFORE UPDATE ON order_lines BEGIN SELECT RAISE(ABORT, 'KAN_IKKE_ENDRES'); END;
CREATE TRIGGER stock_no_delete BEFORE DELETE ON stock_moves BEGIN SELECT RAISE(ABORT, 'SLETTING_IKKE_TILLATT'); END;
CREATE TRIGGER stock_no_update BEFORE UPDATE ON stock_moves BEGIN SELECT RAISE(ABORT, 'KAN_IKKE_ENDRES'); END;
CREATE TRIGGER cash_no_delete BEFORE DELETE ON cash_counts BEGIN SELECT RAISE(ABORT, 'SLETTING_IKKE_TILLATT'); END;
CREATE TRIGGER cash_no_update BEFORE UPDATE ON cash_counts BEGIN SELECT RAISE(ABORT, 'KAN_IKKE_ENDRES'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'SLETTING_IKKE_TILLATT'); END;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'KAN_IKKE_ENDRES'); END;

-- Beløp og referanse på en ordre kan ikke endres etter at den er opprettet.
CREATE TRIGGER orders_locked BEFORE UPDATE OF ref, metode, sum_ore, mva_ore, created_at ON orders
WHEN NEW.ref IS NOT OLD.ref OR NEW.metode IS NOT OLD.metode OR NEW.sum_ore IS NOT OLD.sum_ore
  OR NEW.mva_ore IS NOT OLD.mva_ore OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'ORDRE_LAAST');
END;

-- Lovlige statusendringer: venter → betalt/avbrutt, betalt → annullert.
CREATE TRIGGER orders_status_flow BEFORE UPDATE OF status ON orders
WHEN NEW.status IS NOT OLD.status AND NOT (
  (OLD.status = 'venter' AND NEW.status IN ('betalt', 'avbrutt')) OR
  (OLD.status = 'betalt' AND NEW.status = 'annullert'))
BEGIN
  SELECT RAISE(ABORT, 'ULOVLIG_STATUSENDRING');
END;
