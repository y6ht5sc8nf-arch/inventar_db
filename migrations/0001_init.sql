-- Grundschema des Nachlass-Inventars.
-- IDs sind TEXT (UUID). Gegenstände und Fotos erhalten ihre ID schon im Browser,
-- damit ein wiederholter Upload aus der Offline-Warteschlange nichts doppelt anlegt.

CREATE TABLE rooms (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE containers (
  id          TEXT PRIMARY KEY,
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_containers_room ON containers(room_id);

CREATE TABLE items (
  id               TEXT PRIMARY KEY,
  inv_no           INTEGER NOT NULL UNIQUE,          -- serverseitig vergeben
  room_id          TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  container_id     TEXT REFERENCES containers(id) ON DELETE SET NULL,
  position         TEXT,                             -- Fach/Schublade, Freitext
  kind             TEXT NOT NULL DEFAULT 'einzeln'
                   CHECK (kind IN ('einzeln','konvolut','set','vermerk')),
  category         TEXT,                             -- buch, porzellan, glas, silber, moebel, bild, schmuck, papiere, sonstiges
  title            TEXT,
  description      TEXT,
  maker            TEXT,
  marks            TEXT,                             -- wörtlich abgelesene Marken/Punzen
  material         TEXT,
  period           TEXT,
  dimensions       TEXT,
  quantity         INTEGER NOT NULL DEFAULT 1,
  set_parts        TEXT,                             -- JSON
  condition_grade  TEXT CHECK (condition_grade IS NULL OR condition_grade IN
                   ('wie_neu','sehr_gut','gut','befriedigend','ausreichend','stark_gebraucht')),
  condition_notes  TEXT,
  features         TEXT,                             -- JSON-Array
  inferred         TEXT,                             -- JSON-Array: nur erschlossen, nicht abgelesen
  meta             TEXT,                             -- JSON, kategoriespezifisch
  valuation        TEXT,                             -- JSON
  value_low        REAL,                             -- aus valuation.material, für Filter/Summen
  value_high       REAL,
  recommendation   TEXT CHECK (recommendation IS NULL OR recommendation IN
                   ('gutachten','institution','einzelverkauf','konvolut','spende','entsorgung')),
  market           TEXT,                             -- JSON
  silver           TEXT,                             -- JSON
  disposition      TEXT NOT NULL DEFAULT 'offen' CHECK (disposition IN
                   ('offen','behalten','auktion','haendler','kleinanzeigen','flohmarkt',
                    'spende','sperrmuell','elektroschrott','sondermuell')),
  disposition_note TEXT,
  volume_m3        REAL,
  note             TEXT,
  analysis_mode    TEXT NOT NULL DEFAULT 'nacht' CHECK (analysis_mode IN ('sofort','nacht','keine')),
  analysis_model   TEXT,                             -- Modellwahl pro Gegenstand, sonst Standard
  status           TEXT NOT NULL DEFAULT 'erfasst' CHECK (status IN
                   ('erfasst','wartet_auf_auswertung','ausgewertet','marktgeprueft','erledigt')),
  created_by       TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_items_room        ON items(room_id);
CREATE INDEX idx_items_container   ON items(container_id);
CREATE INDEX idx_items_status      ON items(status);
CREATE INDEX idx_items_disposition ON items(disposition);
CREATE INDEX idx_items_category    ON items(category);
CREATE INDEX idx_items_updated     ON items(updated_at);

CREATE TABLE photos (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  slot        TEXT NOT NULL,                         -- cover, boden_marke, punze, ...
  r2_key      TEXT NOT NULL,
  thumb_key   TEXT,
  width       INTEGER,
  height      INTEGER,
  bytes       INTEGER,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_photos_item ON photos(item_id);

CREATE TABLE jobs (
  id                 TEXT PRIMARY KEY,
  type               TEXT NOT NULL CHECK (type IN ('analyse','batch','markt','schnell')),
  item_ids           TEXT NOT NULL,                  -- JSON-Array
  model              TEXT,
  anthropic_batch_id TEXT,
  status             TEXT NOT NULL DEFAULT 'offen'
                     CHECK (status IN ('offen','laeuft','fertig','fehler','abgebrochen')),
  error              TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at        TEXT
);
CREATE INDEX idx_jobs_status ON jobs(status);

-- Verbrauch jeder Claude-Antwort, Grundlage der Kostenübersicht.
CREATE TABLE api_usage (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id                TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  item_id               TEXT REFERENCES items(id) ON DELETE SET NULL,
  model                 TEXT NOT NULL,
  batch                 INTEGER NOT NULL DEFAULT 0,
  input_tokens          INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens    INTEGER NOT NULL DEFAULT 0,
  cost_usd              REAL NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT
);

INSERT INTO settings (key, value) VALUES
  ('default_model',     'claude-opus-5-5'),
  ('quick_model',       'claude-opus-5-5'),
  ('silver_price_eur_g', NULL),
  ('budget_usd',        NULL);
