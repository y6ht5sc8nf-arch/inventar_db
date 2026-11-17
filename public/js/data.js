// Server-Aufrufe, Offline-Warteschlange (IndexedDB) und automatischer Upload.

export const events = new EventTarget();
const emit = (type, detail) => events.dispatchEvent(new CustomEvent(type, { detail }));

export const uid = () => crypto.randomUUID();

// ---------- Server ----------

export class AuthError extends Error {}
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    // 4xx (außer Zeitüberschreitung/Drosselung) wird durch Wiederholen nicht besser.
    this.permanent = status >= 400 && status < 500 && status !== 408 && status !== 429;
  }
}

export async function api(method, path, body) {
  const init = { method, credentials: "same-origin", redirect: "manual", headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init); // wirft TypeError, wenn kein Netz
  // Abgelaufene Access-Sitzung: Weiterleitung zur Anmeldeseite (nicht folgbar) oder 401/403.
  if (res.type === "opaqueredirect" || res.status === 401 || res.status === 403) {
    emit("auth", true);
    throw new AuthError("Anmeldung abgelaufen");
  }
  emit("auth", false);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || res.statusText);
  return data;
}

// ---------- IndexedDB ----------

let dbPromise;
function db() {
  return (dbPromise ??= new Promise((resolve, reject) => {
    const r = indexedDB.open("nachlass", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true });
      r.result.createObjectStore("cache", { keyPath: "key" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}
const done = (t) => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = t.onabort = () => rej(t.error); });
const result = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function cacheGet(key) {
  const d = await db();
  return (await result(d.transaction("cache").objectStore("cache").get(key)))?.value;
}
export async function cachePut(key, value) {
  const d = await db();
  const t = d.transaction("cache", "readwrite");
  t.objectStore("cache").put({ key, value });
  await done(t);
}

/** Mehrere Vorgänge in einer Transaktion: Gegenstand und seine Fotos landen ganz oder gar nicht. */
export async function enqueue(ops) {
  const d = await db();
  const t = d.transaction("outbox", "readwrite");
  for (const op of ops) t.objectStore("outbox").add({ ...op, attempts: 0, created: Date.now() });
  await done(t);
  navigator.storage?.persist?.().catch(() => {});
  emit("outbox");
  syncSoon();
}

export async function outbox() {
  const d = await db();
  return result(d.transaction("outbox").objectStore("outbox").getAll());
}
async function outboxDelete(seqs) {
  const d = await db();
  const t = d.transaction("outbox", "readwrite");
  for (const s of seqs) t.objectStore("outbox").delete(s);
  await done(t);
  emit("outbox");
}
async function outboxPut(op) {
  const d = await db();
  const t = d.transaction("outbox", "readwrite");
  t.objectStore("outbox").put(op);
  await done(t);
  emit("outbox");
}

/** Zusammenfassung für die Statusanzeige. */
export async function outboxSummary() {
  const ops = await outbox();
  const items = new Set(), failed = [];
  let photos = 0, other = 0;
  for (const op of ops) {
    if (op.failed) failed.push(op);
    if (op.kind === "photo") { photos++; items.add(op.itemId); }
    else if (op.path === "/api/items" && op.method === "POST") items.add(op.body.id);
    else other++;
  }
  return { total: ops.length, items: items.size, photos, other, failed };
}

/** Noch nicht hochgeladene Gegenstände für die Liste „Zuletzt erfasst“. */
export async function pendingItems() {
  const ops = await outbox();
  const list = [];
  for (const op of ops) {
    if (op.path === "/api/items" && op.method === "POST") {
      const firstPhoto = ops.find((p) => p.kind === "photo" && p.itemId === op.body.id);
      list.push({ ...op.body, pending: true, failed: !!op.failed, thumb: firstPhoto?.thumb });
    }
  }
  return list.reverse();
}

/** Noch nicht hochgeladenen Gegenstand samt Fotos aus der Warteschlange nehmen. */
export async function discardPendingItem(itemId) {
  const ops = await outbox();
  await outboxDelete(ops.filter((o) => (o.kind === "photo" && o.itemId === itemId) || o.body?.id === itemId).map((o) => o.seq));
}

export async function discardOp(seq) { await outboxDelete([seq]); }

export async function retryFailed() {
  for (const op of await outbox()) if (op.failed) await outboxPut({ ...op, failed: false, error: null });
  syncSoon();
}

// ---------- Upload ----------

let running = false;
let timer = null;

function syncSoon() {
  clearTimeout(timer);
  timer = setTimeout(sync, 50);
}

async function send(op) {
  if (op.kind === "photo") {
    const f = new FormData();
    f.set("id", op.photoId);
    f.set("slot", op.slot);
    f.set("width", String(op.width));
    f.set("height", String(op.height));
    f.set("full", new Blob([op.full], { type: "image/jpeg" }), "foto.jpg");
    if (op.thumb) f.set("thumb", new Blob([op.thumb], { type: "image/jpeg" }), "vorschau.jpg");
    return api("POST", `/api/items/${op.itemId}/photos`, f);
  }
  try {
    return await api(op.method, op.path, op.body);
  } catch (e) {
    if (op.method === "DELETE" && e instanceof ApiError && e.status === 404) return null; // schon weg
    throw e;
  }
}

/** Arbeitet die Warteschlange der Reihe nach ab (Gegenstand vor seinen Fotos). */
export async function sync() {
  if (running) return;
  running = true;
  emit("sync", true);
  try {
    for (;;) {
      const op = (await outbox()).find((o) => !o.failed);
      if (!op) break;
      try {
        const res = await send(op);
        await outboxDelete([op.seq]);
        if (op.path === "/api/items" && op.method === "POST") emit("uploaded", res);
      } catch (e) {
        if (e instanceof ApiError && e.permanent) {
          await outboxPut({ ...op, failed: true, error: e.message });
          continue; // die übrigen trotzdem versuchen
        }
        await outboxPut({ ...op, attempts: op.attempts + 1, error: e.message });
        break; // kein Netz / Server gestört / Anmeldung abgelaufen → später erneut
      }
    }
  } finally {
    running = false;
    emit("sync", false);
  }
}

export function startSync() {
  addEventListener("online", syncSoon);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) syncSoon(); });
  setInterval(() => { if (!document.hidden) sync(); }, 15000);
  syncSoon();
}
