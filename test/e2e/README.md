# Browser-Test (Erfassung)

Gegen `npm run dev` (lokale Datenbank, Anmeldung per `DEV_ACCESS_EMAIL`):

```bash
node test/e2e/barcode.cjs   # erzeugt cam.mjpeg: künstliches Kamerabild mit ISBN-Strichcode
node test/e2e/e2e.cjs       # Ort wählen, Buch mit ISBN-Scan aufnehmen, Upload, Offline-Warteschlange
```

Braucht Playwright mit Chromium. Bildschirmfotos landen als PNG in diesem Ordner.
