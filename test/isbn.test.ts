import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { normalizeIsbn, parseDnb, parseOpenLibrary, shortTitle } from "../src/isbn";

describe("normalizeIsbn", () => {
  it("prüft ISBN-13", () => {
    expect(normalizeIsbn("978-3-15-000001-4")).toBe("9783150000014");
    expect(normalizeIsbn("9783150000015")).toBeNull();
    expect(normalizeIsbn("4006381333931")).toBeNull(); // EAN, aber keine ISBN
  });
  it("wandelt ISBN-10 um", () => {
    expect(normalizeIsbn("3-15-000001-7")).toBe("9783150000014");
    expect(normalizeIsbn("0-8044-2957-X")).toBe("9780804429573");
    expect(normalizeIsbn("3150000018")).toBeNull();
  });
});

describe("parseDnb (echte Antwort der DNB)", () => {
  const bib = parseDnb(readFileSync("test/fixtures/dnb-9783150000014.xml", "utf8"))!;
  it("liest Titel, Autor, Verlag, Ort, Jahr", () => {
    expect(bib.title).toBe("Faust. Teil 1. Der Tragödie erster Teil");
    expect(bib.authors).toEqual(["Goethe, Johann Wolfgang von"]);
    expect(bib.publisher).toBe("Reclam");
    expect(bib.place).toBe("Stuttgart");
    expect(bib.year).toBe("2012");
    expect(bib.pages).toBe("135 S.");
    expect(bib.language).toBe("Deutsch");
    expect(bib.url).toMatch(/^https:\/\/d-nb\.info\//);
  });
  it("vermerkt weitere Ausgaben mit derselben ISBN", () => {
    expect(bib.editions_total).toBe(25);
    expect(bib.other_editions?.map((e) => e.year)).toEqual(["2000", "1999"]);
  });
  it("Kurztitel", () => {
    expect(shortTitle(bib)).toBe("Goethe: Faust. Teil 1. Der Tragödie erster Teil");
  });
  it("leere Antwort → null", () => {
    expect(parseDnb("<searchRetrieveResponse><numberOfRecords>0</numberOfRecords></searchRetrieveResponse>")).toBeNull();
  });
});

describe("parseOpenLibrary (echte Antwort)", () => {
  it("liest die Grunddaten", () => {
    const data = JSON.parse(readFileSync("test/fixtures/openlibrary-9780140449136.json", "utf8"));
    const bib = parseOpenLibrary(data, "9780140449136")!;
    expect(bib.title.toLowerCase()).toContain("crime and punishment");
    expect(bib.authors.length).toBeGreaterThan(0);
    expect(bib.source).toBe("openlibrary");
  });
});
