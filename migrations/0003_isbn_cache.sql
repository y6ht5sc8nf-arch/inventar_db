-- Zwischenspeicher für bibliografische Daten zu einer ISBN (DNB, Open Library).
-- Jede ISBN wird nur einmal abgefragt; „nicht gefunden“ wird nach einigen Tagen erneut versucht.
CREATE TABLE isbn_cache (
  isbn        TEXT PRIMARY KEY,         -- ISBN-13, nur Ziffern
  found       INTEGER NOT NULL,
  source      TEXT,
  data        TEXT,                     -- JSON
  fetched_at  TEXT NOT NULL
);
