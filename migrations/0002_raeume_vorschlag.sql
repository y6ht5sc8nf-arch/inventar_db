-- Startvorschlag nach Angaben der Nutzerin/des Nutzers (in der App umbenennen, verschieben, löschen).
-- Feste IDs, damit die Migration lokal und entfernt dasselbe ergibt.
INSERT INTO rooms (id, name, sort) VALUES
  ('5f0c0a01-0000-4000-8000-000000000001', 'Wohnzimmer',        10),
  ('5f0c0a01-0000-4000-8000-000000000002', 'Zweites Zimmer',    20),
  ('5f0c0a01-0000-4000-8000-000000000003', 'Schlafzimmer',      30),
  ('5f0c0a01-0000-4000-8000-000000000004', 'Küche',             40),
  ('5f0c0a01-0000-4000-8000-000000000005', 'Flur, Bad, Keller', 50);

INSERT INTO containers (id, room_id, name) VALUES
  ('5f0c0a02-0000-4000-8000-000000000001', '5f0c0a01-0000-4000-8000-000000000001', 'Wohnzimmerschrank'),
  ('5f0c0a02-0000-4000-8000-000000000002', '5f0c0a01-0000-4000-8000-000000000001', 'Sideboard'),
  ('5f0c0a02-0000-4000-8000-000000000003', '5f0c0a01-0000-4000-8000-000000000001', 'Bücherregal 1'),
  ('5f0c0a02-0000-4000-8000-000000000004', '5f0c0a01-0000-4000-8000-000000000002', 'Bücherregal 2'),
  ('5f0c0a02-0000-4000-8000-000000000005', '5f0c0a01-0000-4000-8000-000000000004', 'Küchenschränke'),
  ('5f0c0a02-0000-4000-8000-000000000006', '5f0c0a01-0000-4000-8000-000000000003', 'Schlafzimmerschrank 1'),
  ('5f0c0a02-0000-4000-8000-000000000007', '5f0c0a01-0000-4000-8000-000000000003', 'Schlafzimmerschrank 2');
