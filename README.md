# Nachlass-Inventar

Web-App zur fotografischen Erfassung, Katalogisierung und vorläufigen Bewertung eines Hausrats.
Läuft vollständig auf Cloudflare: Worker (API und Oberfläche), D1 (Katalog), R2 (Fotos), Access (Anmeldung).
Die Auswertung macht Claude über die Anthropic-API, aufgerufen nur im Worker.

> Alle Werte sind vorläufige Schätzungen und kein Wertgutachten.

## Aufbau

```
public/          Oberfläche (installierbare Web-App, Service Worker)
src/index.ts     Worker: /api/*, Cron für Batch-Abholung
src/access.ts    Prüfung des Access-JWT und der erlaubten Adressen
migrations/      D1-Schema als Migrationen
test/            Tests (vitest)
```

Oberfläche und API liegen auf **derselben Adresse** (Worker mit statischen Dateien statt eines
getrennten Pages-Projekts). So schützt eine einzige Access-Anwendung beides, es gibt keine
CORS-Fragen, und der Cron-Trigger für die Batch-Auswertung läuft im selben Worker.

## Lokal entwickeln

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev            # http://localhost:8787
npm test
```

`DEV_ACCESS_EMAIL` in `.dev.vars` ersetzt die Anmeldung, wirkt aber nur bei Aufruf über `localhost`.

## Einrichtung bei Cloudflare (einmalig)

1. Datenbank und Bucket anlegen:
   ```bash
   npx wrangler d1 create inventar          # database_id in wrangler.jsonc eintragen
   npx wrangler r2 bucket create nachlass-fotos
   npm run db:migrate:remote
   ```
2. Secrets setzen (nie ins Repository):
   ```bash
   npx wrangler secret put ANTHROPIC_API_KEY
   npx wrangler secret put ALLOWED_EMAILS   # "a@…,b@…"
   ```
3. `npm run deploy`
4. Zero Trust → Access → Applications → *Self-hosted*: Domain des Workers, Richtlinie „Allow“ mit
   den zwei E-Mail-Adressen, Anmeldemethode *One-time PIN*.
5. Team-Domain und *Application Audience (AUD) Tag* in `wrangler.jsonc` unter `vars` eintragen,
   erneut bereitstellen. Ohne diese Werte lehnt der Worker jede API-Anfrage ab.

Der R2-Bucket bleibt privat; Fotos gibt nur der Worker nach Prüfung der Anmeldung heraus.
