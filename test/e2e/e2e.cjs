const { chromium } = require("playwright");
const B = "http://localhost:8787";
const out = (n) => `${__dirname}/${n}.png`;
(async () => {
  const browser = await chromium.launch({ args: [
    "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
    `--use-file-for-fake-video-capture=${__dirname}/cam.mjpeg`,
  ] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    permissions: ["camera"], locale: "de-DE" });
  const page = await ctx.newPage();
  const problems = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") problems.push(m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  const step = (s) => console.log("✔", s);

  await page.goto(B);
  await page.getByText("Noch kein Ort gewählt").waitFor();
  step("Start lädt");

  // Ort wählen
  await page.locator(".ortkarte").click();
  await page.getByRole("button", { name: "Wohnzimmer", exact: true }).click();
  await page.getByRole("button", { name: "Bücherregal 1" }).click();
  await page.getByRole("button", { name: "Fach 2" }).click();
  await page.screenshot({ path: out("2-ort") });
  await page.getByRole("button", { name: "Übernehmen" }).click();
  await page.getByText("Wohnzimmer › Bücherregal 1 › Fach 2").waitFor();
  step("Ort gewählt und angezeigt");
  await page.screenshot({ path: out("1-start") });

  // Buch aufnehmen
  await page.getByRole("button", { name: /^Buch/ }).click();
  await page.locator(".cam-video").waitFor();
  await page.getByText("Jetzt: Einband vorne (Pflicht)").waitFor();
  await page.locator(".isbn-chip", { hasText: "Goethe: Faust" }).waitFor({ timeout: 20000 });
  step("ISBN erkannt, Buchdaten: " + (await page.locator(".isbn-chip").textContent()));
  for (let i = 0; i < 4; i++) {
    await page.locator(".shutter").click();
    await page.waitForTimeout(400);
    if (await page.locator(".review").isVisible()) {
      console.log("  Qualitätshinweis:", await page.locator(".review p").first().textContent());
      await page.getByRole("button", { name: "Trotzdem behalten" }).click();
    }
    await page.waitForFunction((n) => document.querySelectorAll(".cam-bottom .strip img").length === n, i + 1);
  }
  await page.screenshot({ path: out("3-kamera") });
  const hint = await page.locator(".cam-hint strong").textContent();
  step("4 Pflichtfotos, Hinweis jetzt: " + hint);
  await page.getByRole("button", { name: /^Fertig \(4 Fotos\)/ }).click();

  // Angaben
  const isbnVal = await page.getByLabel("ISBN").inputValue();
  step("ISBN im Formular: " + isbnVal);
  const prefilled = await page.getByLabel(/Kurzbezeichnung/).inputValue();
  step("Titel vorbelegt: " + prefilled);
  await page.locator(".card.bib", { hasText: "Reclam" }).waitFor();
  step("Buchdaten-Karte: " + (await page.locator(".card.bib dl").innerText()).replace(/\n/g, " | "));
  await page.getByLabel(/Kurzbezeichnung/).fill("Testbuch");
  await page.screenshot({ path: out("4-angaben"), fullPage: true });
  await page.getByRole("button", { name: "Speichern & fertig" }).click();
  await page.locator(".item strong", { hasText: "Nr. 0001 · Testbuch" }).waitFor({ timeout: 15000 });
  await page.getByText("Alles hochgeladen").waitFor({ timeout: 15000 });
  await page.locator(".item img[src^='/api/photos/']").first().waitFor();
  step("hochgeladen: Nr. 0001 mit Vorschaubild");

  // Offline: Vermerk erfassen, dann wieder online
  await ctx.setOffline(true);
  await page.evaluate(() => dispatchEvent(new Event("offline")));
  await page.getByRole("button", { name: /^Vermerk ohne Foto/ }).click();
  await page.getByLabel("Was?").fill("Ordner Bankunterlagen");
  await page.getByRole("button", { name: "Vermerk speichern" }).click();
  await page.getByText("Offline · 1 warten").waitFor();
  await page.locator(".item.pending", { hasText: "Nr. folgt · Ordner Bankunterlagen" }).waitFor();
  await page.screenshot({ path: out("5-offline") });
  step("offline gespeichert, Status zeigt Warteschlange");
  await ctx.setOffline(false);
  await page.evaluate(() => dispatchEvent(new Event("online")));
  await page.getByText("Alles hochgeladen").waitFor({ timeout: 20000 });
  await page.locator(".item strong", { hasText: "Nr. 0002 · Ordner Bankunterlagen" }).waitFor({ timeout: 20000 });
  step("nach Wiederverbindung hochgeladen: Nr. 0002");

  // Schnellerfassung über Kategorie-Ansicht prüfen und Raumverwaltung öffnen
  await page.getByRole("button", { name: /^Einzelstück/ }).click();
  await page.getByRole("button", { name: /^Porzellan/ }).click();
  await page.getByText("Jetzt: Gesamtansicht (Pflicht)").waitFor();
  await page.getByRole("button", { name: "Abbrechen" }).click();
  await page.goto(B + "/#/raeume");
  await page.getByText("Schlafzimmerschrank 2").first().waitFor().catch(() => {});
  await page.screenshot({ path: out("6-raeume"), fullPage: true });
  step("Raumverwaltung");

  console.log(problems.length ? "Konsole:\n  " + problems.join("\n  ") : "Keine Fehler in der Konsole");
  await browser.close();
})().catch((e) => { console.error("FEHLER:", e.message); process.exit(1); });
