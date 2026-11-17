// Bibliografische Daten zu einer ISBN aus Bibliothekskatalogen (keine Verkaufsportale):
// 1. Deutsche Nationalbibliothek (SRU, MARC21-XML) – am besten für deutsche Bücher
// 2. Open Library – Rückfall für fremdsprachige Bücher
import type { Env } from "./env";

export interface Edition {
  year: string | null;
  edition: string | null;
  publisher: string | null;
}

export interface Bib {
  source: "dnb" | "openlibrary";
  url: string | null;
  title: string;
  authors: string[];
  publisher: string | null;
  place: string | null;
  year: string | null;
  edition: string | null;
  pages: string | null;
  language: string | null;
  series: string | null;
  /** Weitere Ausgaben mit derselben ISBN (z. B. Reclam-Nachdrucke). Welche vorliegt, zeigt das Impressum. */
  other_editions?: Edition[];
  editions_total?: number;
}

const UA = "Nachlass-Inventar/1.0";
const NEGATIVE_RETRY_DAYS = 7;

// ---------- ISBN ----------

export function normalizeIsbn(raw: string): string | null {
  const s = raw.replace(/[^0-9Xx]/g, "").toUpperCase();
  if (s.length === 13 && /^97[89]\d{10}$/.test(s)) {
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 ? 3 : 1);
    return (10 - (sum % 10)) % 10 === Number(s[12]) ? s : null;
  }
  if (s.length === 10 && /^\d{9}[\dX]$/.test(s)) {
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += (s[i] === "X" ? 10 : Number(s[i])) * (10 - i);
    if (sum % 11) return null;
    const base = "978" + s.slice(0, 9);
    let s13 = 0;
    for (let i = 0; i < 12; i++) s13 += Number(base[i]) * (i % 2 ? 3 : 1);
    return base + ((10 - (s13 % 10)) % 10);
  }
  return null;
}

// ---------- DNB (MARC21-XML) ----------

function decodeXml(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    // Nichtsortier-Zeichen der DNB (z. B. „¬Der¬ Prozess“, „Goethe, Johann Wolfgang \u0098von\u009c“)
    .replace(/[\u0098\u009c¬]/g, "")
    // Die DNB liefert Umlaute zerlegt („o“ + Trema) – für Suche und Sortierung zusammenfügen.
    .normalize("NFC")
    .trim();
}

/** ISBD-Satzzeichen am Feldende entfernen („Faust /“ → „Faust“). */
const tidy = (s: string | undefined | null) => (s ? s.replace(/\s*[/:;,=]\s*$/, "").replace(/\s+/g, " ").trim() || null : null);

type Field = { tag: string; ind2: string; sub: Record<string, string[]> };

function fields(record: string): Field[] {
  const out: Field[] = [];
  const re = /<datafield tag="(\d{3})" ind1="(.)" ind2="(.)">([\s\S]*?)<\/datafield>/g;
  for (let m; (m = re.exec(record)); ) {
    const sub: Record<string, string[]> = {};
    const sre = /<subfield code="(.)">([\s\S]*?)<\/subfield>/g;
    for (let s; (s = sre.exec(m[4])); ) (sub[s[1]] ??= []).push(decodeXml(s[2]));
    out.push({ tag: m[1], ind2: m[3], sub });
  }
  return out;
}

const LANG: Record<string, string> = {
  ger: "Deutsch", eng: "Englisch", fre: "Französisch", lat: "Latein", ita: "Italienisch", spa: "Spanisch",
  rus: "Russisch", pol: "Polnisch", dut: "Niederländisch", gre: "Griechisch", grc: "Altgriechisch", heb: "Hebräisch",
};

function parseDnbRecord(record: string): Bib | null {
  const f = fields(record);
  const get = (tag: string) => f.filter((x) => x.tag === tag);
  const first = (tag: string, code: string) => get(tag)[0]?.sub[code]?.[0] ?? null;

  const t = get("245")[0];
  if (!t) return null;
  let title = tidy(t.sub.a?.[0]) ?? "";
  if (t.sub.b) title += " : " + tidy(t.sub.b[0]);
  if (t.sub.n) title += ". " + tidy(t.sub.n.join(". "))!.replace(/\.$/, "");
  if (t.sub.p) title += ". " + tidy(t.sub.p.join(". "));
  if (!title) return null;

  const authors = [
    ...get("100").map((x) => tidy(x.sub.a?.[0])),
    ...get("700").filter((x) => x.sub["4"]?.includes("aut")).map((x) => tidy(x.sub.a?.[0])),
  ].filter((a): a is string => !!a);

  const pub = get("264").find((x) => x.ind2 === "1") ?? get("264")[0] ?? get("260")[0];
  const yearRaw = pub?.sub.c?.[0] ?? null;
  const idn = /<controlfield tag="001">([^<]+)<\/controlfield>/.exec(record)?.[1] ?? null;
  const series = get("490")[0];
  const lang = first("041", "a");

  return {
    source: "dnb",
    url: idn ? `https://d-nb.info/${idn}` : null,
    title,
    authors,
    publisher: tidy(pub?.sub.b?.[0]),
    place: tidy(pub?.sub.a?.[0]),
    year: yearRaw?.match(/\d{4}/)?.[0] ?? null,
    edition: tidy(first("250", "a")),
    pages: tidy(first("300", "a")),
    language: lang ? LANG[lang] ?? lang : null,
    series: series ? [tidy(series.sub.a?.[0]), series.sub.v?.[0]].filter(Boolean).join(" ; ") || null : null,
  };
}

export function parseDnb(xml: string): Bib | null {
  const total = Number(/<numberOfRecords>(\d+)<\/numberOfRecords>/.exec(xml)?.[1] ?? 0);
  const records = [...xml.matchAll(/<record xmlns="http:\/\/www\.loc\.gov\/MARC21\/slim"[^>]*>([\s\S]*?)<\/record>/g)]
    .map((m) => parseDnbRecord(m[1]))
    .filter((b): b is Bib => !!b);
  if (!records.length) return null;
  const [best, ...rest] = records;
  if (total > 1) {
    best.editions_total = total;
    best.other_editions = rest.map((r) => ({ year: r.year, edition: r.edition, publisher: r.publisher }));
  }
  return best;
}

// ---------- Open Library ----------

interface OlBook {
  url?: string; title?: string; subtitle?: string; authors?: { name: string }[];
  publishers?: { name: string }[]; publish_places?: { name: string }[]; publish_date?: string; number_of_pages?: number;
}

export function parseOpenLibrary(data: unknown, isbn: string): Bib | null {
  const raw = (data as Record<string, OlBook>)?.[`ISBN:${isbn}`];
  if (!raw?.title) return null;
  const b = JSON.parse(JSON.stringify(raw).normalize("NFC")) as OlBook;
  return {
    source: "openlibrary",
    url: b.url ?? null,
    title: b.subtitle ? `${b.title} : ${b.subtitle}` : raw.title.normalize("NFC"),
    authors: (b.authors ?? []).map((a) => a.name).filter(Boolean),
    publisher: b.publishers?.[0]?.name ?? null,
    place: b.publish_places?.[0]?.name ?? null,
    year: b.publish_date?.match(/\d{4}/)?.[0] ?? null,
    edition: null,
    pages: b.number_of_pages ? `${b.number_of_pages} S.` : null,
    language: null,
    series: null,
  };
}

// ---------- Abfrage mit Zwischenspeicher ----------

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(8000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

async function fetchBib(isbn: string): Promise<Bib | null> {
  const xml = await fetchText(
    `https://services.dnb.de/sru/dnb?version=1.1&operation=searchRetrieve&recordSchema=MARC21-xml&maximumRecords=10&query=num%3D${isbn}`,
  );
  const dnb = xml ? parseDnb(xml) : null;
  if (dnb) return dnb;
  const ol = await fetchText(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
  if (ol) {
    try { return parseOpenLibrary(JSON.parse(ol), isbn); } catch { /* ungültig */ }
  }
  return null;
}

/** Liefert die Buchdaten (aus dem Zwischenspeicher oder frisch abgefragt). */
export async function lookupIsbn(env: Env, raw: string): Promise<{ isbn: string; bib: Bib | null } | null> {
  const isbn = normalizeIsbn(raw);
  if (!isbn) return null;
  const cached = await env.DB.prepare(`SELECT found, data, fetched_at FROM isbn_cache WHERE isbn = ?`)
    .bind(isbn).first<{ found: number; data: string | null; fetched_at: string }>();
  if (cached?.found) return { isbn, bib: JSON.parse(cached.data!) as Bib };
  if (cached && Date.now() - Date.parse(cached.fetched_at) < NEGATIVE_RETRY_DAYS * 864e5) return { isbn, bib: null };

  const bib = await fetchBib(isbn);
  await env.DB.prepare(
    `INSERT INTO isbn_cache (isbn, found, source, data, fetched_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(isbn) DO UPDATE SET found = excluded.found, source = excluded.source, data = excluded.data, fetched_at = excluded.fetched_at`,
  ).bind(isbn, bib ? 1 : 0, bib?.source ?? null, bib ? JSON.stringify(bib) : null, new Date().toISOString()).run();
  return { isbn, bib };
}

/** „Goethe, Johann Wolfgang von“ + „Faust …“ → „Goethe: Faust …“ */
export function shortTitle(bib: Bib): string {
  const a = bib.authors[0];
  const name = a ? (a.includes(",") ? a.split(",")[0] : a.split(" ").at(-1) ?? a) : null;
  return (name ? `${name}: ${bib.title}` : bib.title).slice(0, 300);
}

/**
 * Ergänzt einen Gegenstand mit ISBN um die Katalogdaten (falls noch nicht vorhanden).
 * Titel und Hersteller (Autor) werden nur gesetzt, wenn sie leer sind.
 */
export async function enrichItem(env: Env, itemId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT json_extract(meta, '$.isbn') AS isbn FROM items WHERE id = ? AND json_extract(meta, '$.bib') IS NULL`,
  ).bind(itemId).first<{ isbn: string | null }>();
  if (!row?.isbn) return false;
  const r = await lookupIsbn(env, row.isbn);
  if (!r?.bib) return false;
  await env.DB.prepare(
    `UPDATE items SET meta = json_set(COALESCE(meta, '{}'), '$.bib', json(?)),
       title = COALESCE(title, ?), maker = COALESCE(maker, ?), updated_at = ?
     WHERE id = ?`,
  ).bind(JSON.stringify(r.bib), shortTitle(r.bib), r.bib.authors.join("; ") || null, new Date().toISOString(), itemId).run();
  return true;
}

/** Nachträglich: Bücher mit ISBN, aber ohne Katalogdaten (z. B. offline erfasst). */
export async function enrichPending(env: Env, limit = 20): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT id FROM items WHERE json_extract(meta, '$.isbn') IS NOT NULL AND json_extract(meta, '$.bib') IS NULL
       AND (json_extract(meta, '$.bib_tried') IS NULL OR json_extract(meta, '$.bib_tried') < ?)
     ORDER BY inv_no LIMIT ?`,
  ).bind(new Date(Date.now() - NEGATIVE_RETRY_DAYS * 864e5).toISOString(), limit).all<{ id: string }>();
  let n = 0;
  for (const { id } of results) {
    if (await enrichItem(env, id)) n++;
    else {
      await env.DB.prepare(`UPDATE items SET meta = json_set(meta, '$.bib_tried', ?) WHERE id = ?`)
        .bind(new Date().toISOString(), id).run();
    }
  }
  return n;
}
