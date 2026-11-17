import type { Env } from "./env";
import type { AccessUser } from "./access";
import { HttpError, int, json, oneOf, optUuid, readJson, text, uuid } from "./http";
import { enrichItem, normalizeIsbn } from "./isbn";

export const CATEGORIES = [
  "buch", "porzellan", "glas", "silber", "moebel", "bild", "schmuck", "papiere", "sonstiges",
] as const;
export const KINDS = ["einzeln", "konvolut", "set", "vermerk"] as const;
export const ANALYSIS_MODES = ["sofort", "nacht", "keine"] as const;

const MAX_PHOTO = 12 * 1024 * 1024;
const MAX_THUMB = 1024 * 1024;
const SLOT = /^[a-z0-9_]{1,32}$/;

/**
 * Legt einen Gegenstand an. Die ID kommt vom Handy; ein zweiter Aufruf mit derselben ID
 * (Wiederholung aus der Offline-Warteschlange) ändert nichts und liefert dieselbe Nummer.
 * Die Inventarnummer vergibt die Datenbank in einer einzigen Anweisung – zwei Handys
 * können also nie dieselbe Nummer bekommen (zusätzlich UNIQUE auf inv_no).
 */
export async function createItem(req: Request, env: Env, user: AccessUser, ctx?: ExecutionContext): Promise<Response> {
  const b = await readJson(req);
  const id = uuid(b.id);
  const kind = oneOf(b.kind, "Art", KINDS, "einzeln");
  const category = b.category ? oneOf(b.category, "Kategorie", CATEGORIES) : null;
  const mode = kind === "vermerk" ? "keine" : oneOf(b.analysis_mode, "Auswertung", ANALYSIS_MODES, "nacht");
  const status = mode === "keine" ? "erfasst" : "wartet_auf_auswertung";
  const metaObj = b.meta && typeof b.meta === "object" && !Array.isArray(b.meta) ? { ...(b.meta as Record<string, unknown>) } : null;
  // ISBN einheitlich als ISBN-13 speichern; ungültige verwerfen. Katalogdaten ergänzt nur der Server.
  if (metaObj) {
    const isbn = typeof metaObj.isbn === "string" ? normalizeIsbn(metaObj.isbn) : null;
    if (isbn) metaObj.isbn = isbn; else delete metaObj.isbn;
    delete metaObj.bib;
  }
  const meta = metaObj ? JSON.stringify(metaObj) : null;
  if (meta && meta.length > 20000) throw new HttpError(400, "Zusatzangaben zu lang");
  const createdAt = typeof b.created_at === "string" && !isNaN(Date.parse(b.created_at))
    ? new Date(b.created_at).toISOString()
    : new Date().toISOString();

  const values = [
    id,
    optUuid(b.room_id, "Raum"),
    optUuid(b.container_id, "Behälter"),
    text(b.position, "Position", 120),
    kind,
    category,
    text(b.title, "Titel", 300),
    text(b.note, "Notiz", 4000),
    int(b.quantity, "Anzahl", 1, 100000, 1),
    mode,
    meta,
    status,
    user.email,
    createdAt,
    createdAt,
  ];

  const insert = env.DB.prepare(
    `INSERT INTO items (id, inv_no, room_id, container_id, position, kind, category, title, note,
                        quantity, analysis_mode, meta, status, created_by, created_at, updated_at)
     SELECT ?1, COALESCE(MAX(inv_no), 0) + 1,
            (SELECT id FROM rooms WHERE id = ?2),          -- unbekannter Raum → ohne Raum speichern
            (SELECT id FROM containers WHERE id = ?3),     -- statt den Gegenstand zu verlieren
            ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15
     FROM items WHERE true
     ON CONFLICT(id) DO NOTHING`,
  ).bind(...values);

  for (let attempt = 0; ; attempt++) {
    try {
      await insert.run();
      break;
    } catch (e) {
      // Sehr unwahrscheinlich, aber möglich: Nummernkollision → einfach neu vergeben.
      if (attempt < 3 && String(e).includes("UNIQUE") && String(e).includes("inv_no")) continue;
      throw e;
    }
  }
  // Buch mit ISBN, aber ohne Katalogdaten (z. B. offline erfasst): im Hintergrund ergänzen.
  if (metaObj?.isbn) ctx?.waitUntil(enrichItem(env, id).catch((e) => console.error("ISBN", e)));
  const row = await env.DB.prepare(`SELECT id, inv_no, status FROM items WHERE id = ?`).bind(id).first();
  return json(row, 201);
}

export async function listItems(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const limit = int(url.searchParams.get("limit"), "limit", 1, 200, 30);
  const { results } = await env.DB.prepare(
    `SELECT i.id, i.inv_no, i.kind, i.category, i.title, i.position, i.status, i.quantity,
            i.created_by, i.created_at, r.name AS room, c.name AS container,
            json_extract(i.meta, '$.isbn') AS isbn,
            (SELECT COUNT(*) FROM photos p WHERE p.item_id = i.id) AS photo_count,
            (SELECT p.id FROM photos p WHERE p.item_id = i.id ORDER BY p.created_at, p.id LIMIT 1) AS cover_id
     FROM items i
     LEFT JOIN rooms r ON r.id = i.room_id
     LEFT JOIN containers c ON c.id = i.container_id
     ORDER BY i.inv_no DESC
     LIMIT ?`,
  ).bind(limit).all();
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM items`).first<{ n: number }>();
  return json({ items: results, total: total?.n ?? 0 });
}

export async function deleteItem(env: Env, id: string): Promise<Response> {
  const iid = uuid(id);
  const { results } = await env.DB.prepare(`SELECT r2_key, thumb_key FROM photos WHERE item_id = ?`)
    .bind(iid)
    .all<{ r2_key: string; thumb_key: string | null }>();
  const keys = results.flatMap((p) => [p.r2_key, p.thumb_key].filter((k): k is string => !!k));
  if (keys.length) await env.PHOTOS.delete(keys);
  await env.DB.prepare(`DELETE FROM items WHERE id = ?`).bind(iid).run();
  return json({ ok: true });
}

function isJpeg(buf: ArrayBuffer): boolean {
  const b = new Uint8Array(buf, 0, Math.min(3, buf.byteLength));
  return b.length === 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

/** Foto hochladen (multipart: id, slot, width, height, full, thumb). Idempotent über die Foto-ID. */
export async function uploadPhoto(req: Request, env: Env, itemId: string): Promise<Response> {
  const iid = uuid(itemId);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, "Ungültige Daten");
  }
  const id = uuid(form.get("id"), "Foto-ID");
  const slot = String(form.get("slot") ?? "");
  if (!SLOT.test(slot)) throw new HttpError(400, "Ungültige Foto-Art");
  const width = int(form.get("width"), "Breite", 1, 10000, 0);
  const height = int(form.get("height"), "Höhe", 1, 10000, 0);
  const full = form.get("full");
  const thumb = form.get("thumb");
  if (!(full instanceof File)) throw new HttpError(400, "Foto fehlt");

  const existing = await env.DB.prepare(`SELECT id FROM photos WHERE id = ?`).bind(id).first();
  if (existing) return json({ id }, 200);
  if (!(await env.DB.prepare(`SELECT id FROM items WHERE id = ?`).bind(iid).first())) {
    throw new HttpError(404, "Gegenstand nicht gefunden");
  }

  const fullBuf = await full.arrayBuffer();
  if (fullBuf.byteLength > MAX_PHOTO || !isJpeg(fullBuf)) throw new HttpError(400, "Foto ungültig oder zu groß");
  let thumbBuf: ArrayBuffer | null = null;
  if (thumb instanceof File) {
    thumbBuf = await thumb.arrayBuffer();
    if (thumbBuf.byteLength > MAX_THUMB || !isJpeg(thumbBuf)) throw new HttpError(400, "Vorschaubild ungültig");
  }

  const key = `items/${iid}/${id}.jpg`;
  const thumbKey = thumbBuf ? `items/${iid}/${id}_t.jpg` : null;
  const meta = { httpMetadata: { contentType: "image/jpeg" } };
  await env.PHOTOS.put(key, fullBuf, meta);
  if (thumbKey && thumbBuf) await env.PHOTOS.put(thumbKey, thumbBuf, meta);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO photos (id, item_id, slot, r2_key, thumb_key, width, height, bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
    ).bind(id, iid, slot, key, thumbKey, width || null, height || null, fullBuf.byteLength),
    env.DB.prepare(`UPDATE items SET updated_at = ? WHERE id = ?`).bind(new Date().toISOString(), iid),
  ]);
  return json({ id }, 201);
}

/** Foto ausliefern – nur nach geprüfter Anmeldung, der Bucket selbst ist privat. */
export async function getPhoto(req: Request, env: Env, id: string, size: string): Promise<Response> {
  const row = await env.DB.prepare(`SELECT r2_key, thumb_key FROM photos WHERE id = ?`)
    .bind(uuid(id))
    .first<{ r2_key: string; thumb_key: string | null }>();
  if (!row) throw new HttpError(404, "Foto nicht gefunden");
  const key = size === "thumb" && row.thumb_key ? row.thumb_key : row.r2_key;
  const etag = `"${id}-${size}"`;
  const headers = new Headers({
    "content-type": "image/jpeg",
    // Fotos ändern sich nie (neue Aufnahme = neue ID). "private": kein geteilter Cache.
    "cache-control": "private, max-age=31536000, immutable",
    etag,
    "x-content-type-options": "nosniff",
  });
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  const obj = await env.PHOTOS.get(key);
  if (!obj) throw new HttpError(404, "Foto nicht gefunden");
  return new Response(obj.body, { headers });
}
