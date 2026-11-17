import {
  api, cacheGet, cachePut, discardOp, discardPendingItem, enqueue, events, outbox, outboxSummary,
  pendingItems, retryFailed, startSync, sync, uid,
} from "./data.js";
import {
  CATEGORIES, CONTAINER_SUGGESTIONS, POSITION_SUGGESTIONS, STATUS_LABEL, categoryLabel, guideFor,
} from "./guides.js";
import { fromFile, fromVideo } from "./image.js";
import { formatIsbn, isIsbn13, openCamera, scanIsbn } from "./camera.js";

// ---------- kleine Helfer ----------

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== "string") el[k] = v;
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}
const $ = (s, root = document) => root.querySelector(s);
/** Inhalt ersetzen; verschachtelte Listen werden geglättet, null/false weggelassen. */
const clean = (kids) => kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false);
const fill = (el, ...kids) => el.replaceChildren(...clean(kids));
const add = (el, ...kids) => el.append(...clean(kids));
const invNo = (n) => (n ? "Nr. " + String(n).padStart(4, "0") : "Nr. folgt");

function toast(msg, ms = 2500) {
  const t = h("div", { class: "toast", role: "status" }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

/** Bestätigung in der Seite statt Browser-Dialog. */
function confirmInline(anchor, question, yesLabel, onYes) {
  anchor.parentElement?.querySelector(".confirm")?.remove();
  const box = h("div", { class: "confirm" },
    h("span", null, question),
    h("button", { class: "danger", type: "button", onclick: async () => { box.remove(); await onYes(); } }, yesLabel),
    h("button", { type: "button", onclick: () => box.remove() }, "Abbrechen"),
  );
  anchor.after(box);
}

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privat */ } },
};

// ---------- Räume und Behälter ----------

let rooms = [];

/** Noch nicht hochgeladene Änderungen auf die Serverliste anwenden. */
function applyPending(list, ops) {
  const r = structuredClone(list);
  for (const op of ops) {
    if (op.kind !== "json") continue;
    const [, , type, id] = op.path.split("/");
    if (type === "rooms") {
      if (op.method === "POST" && !r.some((x) => x.id === op.body.id)) r.push({ ...op.body, items: 0, containers: [] });
      if (op.method === "PATCH") Object.assign(r.find((x) => x.id === id) ?? {}, op.body);
      if (op.method === "DELETE") r.splice(r.findIndex((x) => x.id === id) >>> 0, 1);
    }
    if (type === "containers") {
      const all = r.flatMap((x) => x.containers);
      if (op.method === "POST" && !all.some((c) => c.id === op.body.id)) {
        r.find((x) => x.id === op.body.room_id)?.containers.push({ ...op.body, items: 0 });
      }
      if (op.method === "PATCH" || op.method === "DELETE") {
        const room = r.find((x) => x.containers.some((c) => c.id === id));
        const idx = room?.containers.findIndex((c) => c.id === id) ?? -1;
        if (idx >= 0 && op.method === "DELETE") room.containers.splice(idx, 1);
        if (idx >= 0 && op.method === "PATCH") {
          const c = Object.assign(room.containers[idx], op.body);
          if (op.body.room_id && op.body.room_id !== room.id) {
            room.containers.splice(idx, 1);
            r.find((x) => x.id === op.body.room_id)?.containers.push(c);
          }
        }
      }
    }
  }
  r.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "de"));
  for (const x of r) x.containers.sort((a, b) => a.name.localeCompare(b.name, "de"));
  return r;
}

async function loadRooms() {
  let server = await cacheGet("rooms");
  try {
    server = (await api("GET", "/api/rooms")).rooms;
    await cachePut("rooms", server);
  } catch { /* offline: zwischengespeicherte Liste */ }
  rooms = applyPending(server ?? [], await outbox());
  return rooms;
}

async function roomOp(method, path, body) {
  await enqueue([{ kind: "json", method, path, body }]);
  rooms = applyPending(rooms, [{ kind: "json", method, path, body }]);
}

// ---------- gewählter Ort ----------

const ort = {
  get: () => store.get("ort", {}),
  set: (v) => store.set("ort", v),
};
function ortParts(o = ort.get()) {
  const r = rooms.find((x) => x.id === o.room_id);
  const c = r?.containers.find((x) => x.id === o.container_id);
  return { room: r?.name, container: c?.name, position: o.position };
}
function ortText(o) {
  const p = ortParts(o);
  return [p.room, p.container, p.position].filter(Boolean).join(" › ") || "Noch kein Ort gewählt";
}

function locationCard(back = "") {
  return h("button", { class: "ortkarte", type: "button", onclick: () => go("ort" + (back ? "?zurueck=" + back : "")) },
    h("span", { class: "label" }, "Ort"),
    h("strong", null, ortText()),
    h("span", { class: "aendern" }, "ändern"),
  );
}

// ---------- Aufnahme-Sitzung ----------

let session = null; // { itemId, mode, photos: [{photoId, slot, full, thumb, width, height, url}], isbn }

function newSession(mode) {
  clearSession();
  session = { itemId: uid(), mode, photos: [], isbn: null };
}
function clearSession() {
  session?.photos.forEach((p) => URL.revokeObjectURL(p.url));
  session = null;
}
function startCapture(mode) {
  newSession(mode);
  go("aufnahme/" + mode);
}

// ---------- Router ----------

let cleanup = null;
const views = {
  "": viewStart,
  kategorie: viewKategorie,
  aufnahme: viewCapture,
  details: viewDetails,
  vermerk: viewVermerk,
  ort: viewOrt,
  raeume: viewRaeume,
  upload: viewUpload,
};

function go(path) {
  location.hash = "#/" + path;
}

async function route() {
  if (cleanup) { try { cleanup(); } catch { /* egal */ } cleanup = null; }
  const [path, query] = location.hash.replace(/^#\/?/, "").split("?");
  const [name, ...params] = path.split("/");
  const view = views[name] ?? viewStart;
  // Jede Ansicht bekommt einen eigenen Container. Wechselt die Ansicht, während eine
  // ältere noch lädt, zeichnet die ältere in einen abgehängten Container (unsichtbar).
  const main = h("div");
  const token = ++routeToken;
  $("#view").replaceChildren(main);
  document.body.classList.toggle("vollbild", name === "aufnahme");
  for (const a of document.querySelectorAll("nav a")) a.classList.toggle("aktiv", a.dataset.view === name);
  scrollTo(0, 0);
  const done = (await view(main, params, new URLSearchParams(query))) || null;
  if (token === routeToken) cleanup = done;
  else done?.(); // inzwischen überholt: sofort aufräumen (z. B. Kamera aus)
}
let routeToken = 0;

// ---------- Ansicht: Start ----------

async function viewStart(main) {
  await loadRooms();
  const recent = h("section", { class: "recent" });
  add(main, 
    locationCard(),
    session?.photos.length
      ? h("div", { class: "hinweis-box" },
          `Unfertige Aufnahme (${guideFor(session.mode)?.label}, ${session.photos.length} Fotos)`,
          h("div", { class: "row" },
            h("button", { class: "primary", type: "button", onclick: () => go("aufnahme/" + session.mode) }, "Fortsetzen"),
            h("button", { type: "button", onclick: (e) => confirmInline(e.target.parentElement, "Fotos verwerfen?", "Verwerfen", () => { clearSession(); route(); }) }, "Verwerfen")))
      : null,
    h("div", { class: "modes" },
      modeButton("Buch", "ISBN scannen, Foto-Leitfaden", () => startCapture("buch"), "primary"),
      modeButton("Einzelstück", "Kategorie wählen, Foto-Leitfaden", () => go("kategorie")),
      modeButton("Fach / Schublade", "1–3 Übersichtsfotos, Claude listet später den Inhalt", () => startCapture("schnell")),
      modeButton("Vermerk ohne Foto", "Private Unterlagen nur vermerken", () => go("vermerk")),
    ),
    recent,
  );
  const refresh = () => renderRecent(recent);
  await refresh();
  // Liste regelmäßig neu laden, solange die Seite sichtbar ist.
  const iv = setInterval(() => { if (!document.hidden) refresh(); }, 12000);
  const onUp = () => refresh();
  events.addEventListener("uploaded", onUp);
  events.addEventListener("outbox", onUp);
  return () => {
    clearInterval(iv);
    events.removeEventListener("uploaded", onUp);
    events.removeEventListener("outbox", onUp);
    recent._urls?.forEach(URL.revokeObjectURL);
  };
}

function modeButton(title, sub, onclick, cls = "") {
  return h("button", { class: "mode " + cls, type: "button", onclick }, h("strong", null, title), h("span", null, sub));
}

let recentBusy = false;
async function renderRecent(box) {
  if (recentBusy) return;
  recentBusy = true;
  try {
    const pending = await pendingItems();
    let server = await cacheGet("recent");
    try {
      server = await api("GET", "/api/items?limit=25");
      await cachePut("recent", server);
    } catch { /* offline */ }
    server ??= { items: [], total: 0 };
    const pendingIds = new Set(pending.map((p) => p.id));
    const items = [...pending, ...server.items.filter((i) => !pendingIds.has(i.id))];

    box._urls?.forEach(URL.revokeObjectURL);
    box._urls = [];
    const rows = items.map((it) => {
      let src = null;
      if (it.pending && it.thumb) {
        src = URL.createObjectURL(new Blob([it.thumb], { type: "image/jpeg" }));
        box._urls.push(src);
      } else if (it.cover_id) src = `/api/photos/${it.cover_id}/thumb`;
      const where = it.pending ? ortText({ room_id: it.room_id, container_id: it.container_id, position: it.position })
        : [it.room, it.container, it.position].filter(Boolean).join(" › ");
      const status = it.pending ? (it.failed ? "Upload-Fehler" : "wartet auf Upload") : STATUS_LABEL[it.status] ?? it.status;
      const del = h("button", { class: "klein", type: "button", "aria-label": "Löschen" }, "Löschen");
      const row = h("li", { class: "item" + (it.pending ? " pending" : "") },
        src ? h("img", { src, alt: "", loading: "lazy", width: 56, height: 56 }) : h("div", { class: "noimg" }, it.kind === "vermerk" ? "§" : "–"),
        h("div", { class: "txt" },
          h("strong", null, invNo(it.inv_no), " · ", it.title || (it.kind === "konvolut" ? "Fach/Schublade" : categoryLabel(it.category))),
          h("span", null, [where, it.isbn || it.meta?.isbn ? "ISBN " + formatIsbn(it.isbn || it.meta.isbn) : null].filter(Boolean).join(" · ")),
          h("span", { class: "status " + (it.pending ? "warte" : it.status) }, status)),
        del,
      );
      del.onclick = () => confirmInline(row, `${invNo(it.inv_no)} wirklich löschen?`, "Löschen", async () => {
        try {
          if (it.pending) await discardPendingItem(it.id);
          else await api("DELETE", `/api/items/${it.id}`);
          toast("Gelöscht");
          renderRecent(box);
        } catch (e) { toast("Löschen ging nicht: " + e.message); }
      });
      return row;
    });
    fill(box, 
      h("h2", null, "Zuletzt erfasst", h("span", { class: "muted" }, ` (${server.total + pending.length} insgesamt)`)),
      rows.length ? h("ul", { class: "items" }, rows) : h("p", { class: "muted" }, "Noch nichts erfasst."),
    );
  } finally {
    recentBusy = false;
  }
}

// ---------- Ansicht: Kategorie wählen ----------

async function viewKategorie(main) {
  await loadRooms();
  add(main, 
    h("h2", null, "Was wird erfasst?"),
    locationCard("kategorie"),
    h("div", { class: "grid" }, CATEGORIES.map((c) =>
      h("button", { class: "tile", type: "button", onclick: () => startCapture(c.id) },
        h("strong", null, c.label),
        h("span", null, c.slots.filter((s) => s.req).map((s) => s.label).join(", "))))),
  );
}

// ---------- Ansicht: Kamera ----------

async function viewCapture(main, [mode]) {
  const guide = guideFor(mode);
  if (!guide) return go("");
  if (!session || session.mode !== mode) newSession(mode);
  const s = session;
  const slots = guide.slots;
  const has = (slot) => s.photos.some((p) => p.slot === slot);
  const nextMissing = (from) => {
    for (let k = 1; k <= slots.length; k++) {
      const sl = slots[(from + k) % slots.length];
      if (!has(sl.id)) return sl.id;
    }
    return null;
  };
  let current = slots.find((sl) => !has(sl.id))?.id ?? null;
  let busy = false;

  const video = h("video", { class: "cam-video", playsinline: true, muted: true, autoplay: true });
  const chips = h("div", { class: "chips" });
  const hint = h("div", { class: "cam-hint", "aria-live": "polite" });
  const isbnChip = mode === "buch" ? h("div", { class: "isbn-chip" }, "ISBN: Strichcode ins Bild halten") : null;
  const strip = h("div", { class: "strip" });
  const fileInput = h("input", { type: "file", accept: "image/*", capture: "environment", hidden: true });
  const shutter = h("button", { class: "shutter", type: "button", "aria-label": "Foto aufnehmen" });
  const skip = h("button", { class: "ghost", type: "button" }, "Überspringen");
  const done = h("button", { class: "primary", type: "button" }, "Fertig");
  const cancel = h("button", { class: "ghost", type: "button" }, "Abbrechen");
  const fallback = h("div", { class: "cam-fallback", hidden: true });
  const review = h("div", { class: "review", hidden: true });
  const appCam = h("button", { class: "ghost klein", type: "button" }, "Kamera-App");

  add(main, h("div", { class: "cam" },
    h("div", { class: "cam-top" }, chips, hint, isbnChip),
    video, fallback, review,
    h("div", { class: "cam-bottom" },
      strip,
      h("div", { class: "cam-controls" }, cancel, shutter, h("div", { class: "stack" }, skip, appCam)),
      done),
    fileInput));

  function render() {
    fill(chips, ...slots.map((sl) => h("button", {
      type: "button",
      class: ["chip", sl.req ? "req" : "", has(sl.id) ? "ok" : "", sl.id === current ? "cur" : ""].join(" "),
      onclick: () => { current = sl.id; render(); },
    }, has(sl.id) ? "✓ " : "", sl.label, sl.req ? " *" : "")));
    chips.querySelector(".cur")?.scrollIntoView({ inline: "center", block: "nearest" });
    const sl = slots.find((x) => x.id === current);
    fill(hint, 
      sl ? h("strong", null, "Jetzt: ", sl.label, sl.req ? " (Pflicht)" : " (optional)") : h("strong", null, "Alle Fotos gemacht"),
      sl?.tip ? h("span", null, sl.tip) : null,
      sl && has(sl.id) ? h("span", null, "Neue Aufnahme ersetzt das vorhandene Foto.") : null,
    );
    skip.hidden = !sl || (sl.req && !has(sl.id));
    const missingReq = slots.filter((x) => x.req && !has(x.id)).length;
    done.disabled = s.photos.length === 0;
    done.textContent = s.photos.length === 0 ? "Fertig (ab 1 Foto)"
      : missingReq ? `Fertig (${s.photos.length} Fotos, ${missingReq} Pflicht fehlt)` : `Fertig (${s.photos.length} Fotos)`;
    fill(strip, ...s.photos.map((p) => h("img", {
      src: p.url, alt: slots.find((x) => x.id === p.slot)?.label ?? p.slot,
      onclick: () => { current = p.slot; render(); },
    })));
    if (isbnChip && s.isbn) { isbnChip.textContent = "ISBN " + formatIsbn(s.isbn) + " ✓"; isbnChip.classList.add("ok"); }
  }

  function accept(shot) {
    const old = s.photos.findIndex((p) => p.slot === current);
    if (old >= 0) { URL.revokeObjectURL(s.photos[old].url); s.photos.splice(old, 1); }
    const slot = current ?? "extra_" + (s.photos.length + 1);
    s.photos.push({ photoId: uid(), slot, ...shot, url: URL.createObjectURL(shot.thumb) });
    s.photos.sort((a, b) => slots.findIndex((x) => x.id === a.slot) - slots.findIndex((x) => x.id === b.slot));
    const idx = slots.findIndex((x) => x.id === slot);
    current = nextMissing(idx);
    navigator.vibrate?.(30);
    render();
  }

  function check(shot) {
    const q = shot.quality;
    if (!q.blurry && !q.dark) return accept(shot);
    const url = URL.createObjectURL(shot.thumb);
    review.hidden = false;
    fill(review, 
      h("img", { src: url, alt: "" }),
      h("p", null, q.dark && q.blurry ? "Das Foto ist zu dunkel und wirkt unscharf." : q.dark ? "Das Foto ist zu dunkel." : "Das Foto wirkt unscharf."),
      h("p", { class: "muted" }, q.dark ? "Mehr Licht oder näher ans Fenster." : "Ruhig halten, etwas Abstand, kurz scharf stellen lassen."),
      h("div", { class: "row" },
        h("button", { class: "primary", type: "button", onclick: () => { URL.revokeObjectURL(url); review.hidden = true; } }, "Neu aufnehmen"),
        h("button", { type: "button", onclick: () => { URL.revokeObjectURL(url); review.hidden = true; accept(shot); } }, "Trotzdem behalten")),
    );
  }

  async function take(producer) {
    if (busy || !review.hidden) return;
    busy = true;
    shutter.classList.add("blitz");
    try { check(await producer()); }
    catch (e) { toast("Foto fehlgeschlagen: " + e.message); }
    finally { busy = false; setTimeout(() => shutter.classList.remove("blitz"), 150); }
  }

  shutter.onclick = () => (stopCam ? take(() => fromVideo(video)) : fileInput.click());
  appCam.onclick = () => fileInput.click();
  fileInput.onchange = () => {
    const f = fileInput.files?.[0];
    fileInput.value = "";
    if (f) take(() => fromFile(f));
  };
  skip.onclick = () => { current = nextMissing(slots.findIndex((x) => x.id === current)); render(); };
  done.onclick = () => go("details");
  cancel.onclick = () => {
    if (!s.photos.length) { clearSession(); return go(""); }
    confirmInline(cancel.closest(".cam-controls"), "Aufnahme verwerfen?", "Verwerfen", () => { clearSession(); go(""); });
  };

  // Kamera starten; bei Fehler Rückfall auf die Kamera-App des Telefons.
  let stopCam = null, stopScan = null, active = true;
  async function startCam() {
    try {
      stopCam = await openCamera(video);
      if (!active) { stopCam(); stopCam = null; return; }
      fallback.hidden = true;
      video.hidden = false;
      if (mode === "buch") {
        stopScan = scanIsbn(video, (code) => {
          if (s.isbn !== code) { s.isbn = code; navigator.vibrate?.([40, 40, 40]); render(); }
        });
      }
    } catch (e) {
      stopCam = null;
      video.hidden = true;
      fallback.hidden = false;
      fill(fallback, 
        h("p", null, "Live-Kamera nicht verfügbar", h("br"), h("span", { class: "muted" }, e.name === "NotAllowedError" ? "Kamera-Zugriff wurde nicht erlaubt." : e.message)),
        h("button", { class: "primary", type: "button", onclick: () => fileInput.click() }, "Foto mit Kamera-App aufnehmen"),
      );
    }
  }
  function stopAll() {
    stopScan?.(); stopScan = null;
    stopCam?.(); stopCam = null;
  }
  const onVis = () => { if (document.hidden) stopAll(); else if (active && !stopCam) startCam(); };
  document.addEventListener("visibilitychange", onVis);

  render();
  startCam();
  return () => { active = false; stopAll(); document.removeEventListener("visibilitychange", onVis); };
}

// ---------- Ansicht: Angaben und Speichern ----------

async function viewDetails(main) {
  if (!session?.photos.length) return go("");
  await loadRooms();
  const s = session;
  const quick = s.mode === "schnell";
  const cat = quick ? null : CATEGORIES.find((c) => c.id === s.mode);
  const o = ort.get();

  const title = h("input", { type: "text", maxlength: 300, placeholder: (quick ? "z. B. Besteckschublade" : cat.hint) });
  const isbn = s.mode === "buch" ? h("input", { type: "text", inputmode: "numeric", maxlength: 17, value: s.isbn ? formatIsbn(s.isbn) : "", placeholder: "978-…" }) : null;
  const kind = cat?.setable || quick
    ? h("select", null, (quick ? [["konvolut", "Konvolut (gemischter Inhalt)"], ["set", "Set"]]
      : [["einzeln", "Einzelstück"], ["set", "Set / Service"], ["konvolut", "Konvolut"]]).map(([v, l]) => h("option", { value: v }, l)))
    : null;
  const quickCat = quick ? h("select", null, h("option", { value: "" }, "Gemischt"), CATEGORIES.map((c) => h("option", { value: c.id }, c.label))) : null;
  const qty = h("input", { type: "number", min: 1, max: 100000, value: "1", inputmode: "numeric" });
  const position = h("input", { type: "text", maxlength: 120, value: o.position ?? "", placeholder: "z. B. Fach 2" });
  const note = h("textarea", { rows: 3, maxlength: 4000, placeholder: "Auffälligkeiten, Herkunft, was die Familie weiß …" });
  let mode = store.get("analyse", "nacht");
  const seg = h("div", { class: "seg", role: "radiogroup" });
  const renderSeg = () => fill(seg, ...[["nacht", "Über Nacht"], ["sofort", "Sofort"], ["keine", "Nicht auswerten"]].map(([v, l]) =>
    h("button", { type: "button", role: "radio", "aria-checked": String(mode === v), class: mode === v ? "an" : "", onclick: () => { mode = v; store.set("analyse", v); renderSeg(); } }, l)));
  renderSeg();
  const err = h("p", { class: "fehler", hidden: true });

  async function save(next) {
    const isbnVal = isbn?.value.replace(/[^0-9Xx]/g, "") || null;
    if (isbnVal && !(isbnVal.length === 10 || isIsbn13(isbnVal))) {
      err.hidden = false; err.textContent = "Die ISBN sieht nicht gültig aus (13 Ziffern mit 978/979 oder 10 Ziffern)."; return;
    }
    const body = {
      id: s.itemId,
      kind: kind?.value ?? "einzeln",
      category: quick ? quickCat.value || null : s.mode,
      title: title.value.trim() || null,
      note: note.value.trim() || null,
      quantity: Number(qty.value) || 1,
      position: position.value.trim() || null,
      room_id: o.room_id ?? null,
      container_id: o.container_id ?? null,
      analysis_mode: mode,
      meta: { erfassung: quick ? "schnell" : "einzeln", ...(isbnVal ? { isbn: isbnVal } : {}) },
      created_at: new Date().toISOString(),
    };
    const ops = [{ kind: "json", method: "POST", path: "/api/items", body }];
    for (const p of s.photos) {
      ops.push({
        kind: "photo", itemId: s.itemId, photoId: p.photoId, slot: p.slot, width: p.width, height: p.height,
        full: await p.full.arrayBuffer(), thumb: await p.thumb.arrayBuffer(),
      });
    }
    try {
      await enqueue(ops);
    } catch (e) {
      err.hidden = false; err.textContent = "Speichern auf dem Gerät fehlgeschlagen: " + e.message; return;
    }
    const m = s.mode;
    clearSession();
    toast("Gespeichert" + (navigator.onLine ? " – wird hochgeladen" : " – Upload, sobald Netz da ist"));
    if (next) startCapture(m); else go("");
  }

  const nextLabel = s.mode === "buch" ? "Speichern & nächstes Buch" : quick ? "Speichern & nächstes Fach" : "Speichern & nächstes Stück";
  add(main, 
    h("h2", null, quick ? "Fach / Schublade" : cat.label),
    h("div", { class: "strip gross" }, s.photos.map((p) => h("img", { src: p.url, alt: p.slot }))),
    h("button", { class: "link", type: "button", onclick: () => go("aufnahme/" + s.mode) }, "Fotos ergänzen oder ersetzen"),
    locationCard("details"),
    h("form", { class: "form", onsubmit: (e) => { e.preventDefault(); save(true); } },
      h("label", null, "Kurzbezeichnung ", h("span", { class: "muted" }, "(optional, Claude ergänzt)"), title),
      isbn ? h("label", null, "ISBN", isbn) : null,
      quickCat ? h("label", null, "Überwiegend", quickCat) : null,
      kind ? h("label", null, "Art", kind) : null,
      h("label", null, "Anzahl", qty),
      h("label", null, "Position (Fach, Schublade)", position),
      h("label", null, "Notiz", note),
      h("div", { class: "label" }, "Auswertung durch Claude", seg),
      err,
      h("div", { class: "row sticky" },
        h("button", { class: "primary", type: "submit" }, nextLabel),
        h("button", { type: "button", onclick: () => save(false) }, "Speichern & fertig"))),
  );
}

// ---------- Ansicht: Vermerk ohne Foto ----------

async function viewVermerk(main) {
  await loadRooms();
  const o = ort.get();
  const title = h("input", { type: "text", required: true, maxlength: 300, placeholder: "z. B. Ordner Bankunterlagen" });
  const position = h("input", { type: "text", maxlength: 120, value: o.position ?? "", placeholder: "z. B. Flurschrank, oben" });
  const qty = h("input", { type: "number", min: 1, value: "1", inputmode: "numeric" });
  const note = h("textarea", { rows: 3, maxlength: 4000, placeholder: "Was ist drin, wer kümmert sich darum …" });
  add(main, 
    h("h2", null, "Vermerk ohne Foto"),
    h("p", { class: "hinweis-box" },
      "Ausweise, Kontoauszüge, Krankenunterlagen, Verträge und ähnliche Dokumente bitte ",
      h("strong", null, "nicht fotografieren"), ". Hier nur vermerken, was es gibt und wo es liegt."),
    locationCard("vermerk"),
    h("form", { class: "form", onsubmit: async (e) => {
      e.preventDefault();
      if (!title.value.trim()) return title.focus();
      await enqueue([{ kind: "json", method: "POST", path: "/api/items", body: {
        id: uid(), kind: "vermerk", category: "papiere", title: title.value.trim(), note: note.value.trim() || null,
        quantity: Number(qty.value) || 1, position: position.value.trim() || null,
        room_id: o.room_id ?? null, container_id: o.container_id ?? null, analysis_mode: "keine",
        meta: { erfassung: "vermerk" }, created_at: new Date().toISOString(),
      } }]);
      toast("Vermerk gespeichert");
      go("");
    } },
      h("label", null, "Was?", title),
      h("label", null, "Anzahl (Ordner, Kartons …)", qty),
      h("label", null, "Genauer Ort", position),
      h("label", null, "Notiz", note),
      h("div", { class: "row" }, h("button", { class: "primary", type: "submit" }, "Vermerk speichern"), h("button", { type: "button", onclick: () => go("") }, "Abbrechen"))),
  );
}

// ---------- Ansicht: Ort wählen ----------

async function viewOrt(main, _p, query) {
  await loadRooms();
  const back = query.get("zurueck") || "";
  const sel = { ...ort.get() };
  const box = h("div");
  add(main, h("h2", null, "Wo wird gerade erfasst?"), box);

  function render() {
    const room = rooms.find((r) => r.id === sel.room_id);
    const newRoom = h("input", { type: "text", maxlength: 80, placeholder: "Neuer Raum" });
    const newCont = h("input", { type: "text", maxlength: 80, placeholder: "Neuer Schrank, Regal …" });
    const pos = h("input", { type: "text", maxlength: 120, value: sel.position ?? "", placeholder: "z. B. Fach 2 (optional)",
      oninput: () => { sel.position = pos.value; } });
    fill(box, 
      h("h3", null, "Raum"),
      h("div", { class: "choices" },
        rooms.map((r) => h("button", { type: "button", class: r.id === sel.room_id ? "an" : "",
          onclick: () => { if (sel.room_id !== r.id) { sel.room_id = r.id; sel.container_id = null; } render(); } }, r.name))),
      h("form", { class: "inline", onsubmit: async (e) => {
        e.preventDefault();
        const name = newRoom.value.trim();
        if (!name) return;
        const id = uid();
        await roomOp("POST", "/api/rooms", { id, name, sort: (rooms.at(-1)?.sort ?? 0) + 10 });
        sel.room_id = id; sel.container_id = null; render();
      } }, newRoom, h("button", { type: "submit" }, "Anlegen")),

      room ? [
        h("h3", null, "Schrank, Regal, Behälter in ", room.name),
        h("div", { class: "choices" },
          h("button", { type: "button", class: !sel.container_id ? "an" : "", onclick: () => { sel.container_id = null; render(); } }, "– keiner –"),
          room.containers.map((c) => h("button", { type: "button", class: c.id === sel.container_id ? "an" : "",
            onclick: () => { sel.container_id = c.id; render(); } }, c.name))),
        h("form", { class: "inline", onsubmit: async (e) => {
          e.preventDefault();
          const name = newCont.value.trim();
          if (!name) return;
          const id = uid();
          await roomOp("POST", "/api/containers", { id, room_id: room.id, name });
          sel.container_id = id; render();
        } }, newCont, h("button", { type: "submit" }, "Anlegen")),
        h("div", { class: "chips klein" }, CONTAINER_SUGGESTIONS.map((n) => h("button", { type: "button", class: "chip",
          onclick: () => { newCont.value = n + " "; newCont.focus(); } }, n))),
      ] : null,

      h("h3", null, "Fach / Schublade"),
      pos,
      h("div", { class: "chips klein" }, POSITION_SUGGESTIONS.map((n) => h("button", { type: "button", class: "chip" + (sel.position === n ? " cur" : ""),
        onclick: () => { sel.position = n; render(); } }, n)),
        h("button", { type: "button", class: "chip", onclick: () => { sel.position = ""; render(); } }, "leeren")),

      h("div", { class: "row sticky" },
        h("button", { class: "primary", type: "button", onclick: () => { ort.set({ ...sel, position: (sel.position || "").trim() || null }); go(back); } }, "Übernehmen"),
        h("button", { type: "button", onclick: () => go(back) }, "Abbrechen")),
      h("p", { class: "muted" }, "Der Ort bleibt eingestellt, bis du ihn änderst. ", h("a", { href: "#/raeume" }, "Räume verwalten")),
    );
  }
  render();
}

// ---------- Ansicht: Räume verwalten ----------

async function viewRaeume(main) {
  await loadRooms();
  const box = h("div");
  add(main, h("h2", null, "Räume und Behälter"), box);

  const count = (n) => (n === 1 ? "1 Gegenstand" : `${n ?? 0} Gegenstände`);

  /** Name als Text; „Umbenennen“ blendet ein Eingabefeld ein. */
  function nameLine(tag, name, onSave, extra) {
    const line = h("div", { class: "name-line" },
      h(tag, null, name), ...extra,
      h("button", { class: "klein", type: "button", onclick: () => {
        const input = h("input", { type: "text", value: name, maxlength: 80 });
        line.replaceWith(h("form", { class: "inline", onsubmit: async (e) => {
          e.preventDefault();
          const v = input.value.trim();
          if (v && v !== name) { await onSave(v); toast("Umbenannt"); }
          render();
        } }, input, h("button", { class: "primary", type: "submit" }, "OK"), h("button", { type: "button", onclick: render }, "Abbrechen")));
        input.focus();
        input.select();
      } }, "Umbenennen"));
    return line;
  }

  function addForm(placeholder, onAdd) {
    const input = h("input", { type: "text", maxlength: 80, placeholder });
    return h("form", { class: "inline", onsubmit: async (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (v) { await onAdd(v); render(); }
    } }, input, h("button", { type: "submit" }, "Anlegen"));
  }

  function render() {
    fill(box,
      rooms.map((r) => {
        const sec = h("section", { class: "card" });
        const del = h("button", { class: "klein danger", type: "button", onclick: () => confirmInline(del.parentElement, r.items
          ? `${r.name} löschen? ${count(r.items)} behalten ihre Daten, verlieren aber die Raumangabe.`
          : `${r.name} löschen?`, "Löschen", async () => { await roomOp("DELETE", `/api/rooms/${r.id}`); render(); }) }, "Löschen");
        fill(sec,
          nameLine("h3", r.name, (name) => roomOp("PATCH", `/api/rooms/${r.id}`, { name }), [h("span", { class: "muted grow" }, count(r.items)), del]),
          h("ul", { class: "conts" }, r.containers.map((c) => {
            const li = h("li");
            const cdel = h("button", { class: "klein danger", type: "button", onclick: () => confirmInline(li.lastElementChild ?? li, c.items
              ? `${c.name} löschen? ${count(c.items)} verlieren die Behälterangabe.` : `${c.name} löschen?`, "Löschen",
              async () => { await roomOp("DELETE", `/api/containers/${c.id}`); render(); }) }, "Löschen");
            fill(li,
              nameLine("strong", c.name, (name) => roomOp("PATCH", `/api/containers/${c.id}`, { name }), [h("span", { class: "muted grow" }, count(c.items))]),
              h("div", { class: "name-line" },
                h("label", { class: "move grow" }, "steht in ",
                  h("select", { onchange: async (e) => { await roomOp("PATCH", `/api/containers/${c.id}`, { room_id: e.target.value }); toast("Verschoben"); render(); } },
                    rooms.map((x) => h("option", { value: x.id, selected: x.id === r.id }, x.name)))),
                cdel));
            return li;
          })),
          addForm(`Neuer Behälter in ${r.name}`, (name) => roomOp("POST", "/api/containers", { id: uid(), room_id: r.id, name })),
        );
        return sec;
      }),
      h("h3", null, "Neuer Raum"),
      addForm("z. B. Dachboden", (name) => roomOp("POST", "/api/rooms", { id: uid(), name, sort: (rooms.at(-1)?.sort ?? 0) + 10 })),
    );
  }
  render();
}

// ---------- Ansicht: Upload-Warteschlange ----------

async function viewUpload(main) {
  const box = h("div");
  add(main, h("h2", null, "Upload"), box);
  async function render() {
    const sum = await outboxSummary();
    const ops = await outbox();
    fill(box, 
      h("p", null, sum.total === 0 ? "Alles ist hochgeladen."
        : `${sum.items} Gegenstände mit ${sum.photos} Fotos warten auf Upload` + (sum.other ? `, dazu ${sum.other} weitere Änderungen.` : ".")),
      !navigator.onLine ? h("p", { class: "hinweis-box" }, "Gerade kein Netz. Der Upload startet automatisch, sobald wieder Verbindung besteht. Die App dabei geöffnet lassen.") : null,
      h("div", { class: "row" },
        h("button", { class: "primary", type: "button", onclick: async () => { await sync(); render(); } }, "Jetzt hochladen"),
        sum.failed.length ? h("button", { type: "button", onclick: async () => { await retryFailed(); render(); } }, "Fehler erneut versuchen") : null),
      sum.failed.length ? h("h3", null, "Fehlgeschlagen") : null,
      h("ul", { class: "items" }, ops.filter((o) => o.failed || o.error).map((o) => {
        const label = o.kind === "photo" ? `Foto (${o.slot})` : o.path === "/api/items" ? (o.body.title || "Gegenstand") : `${o.method} ${o.path}`;
        const li = h("li", { class: "item" },
          h("div", { class: "txt" }, h("strong", null, label), h("span", { class: o.failed ? "fehler" : "muted" }, o.error || ""),
            h("span", { class: "muted" }, `${o.attempts} Versuche`)),
          o.failed ? h("button", { class: "klein danger", type: "button", onclick: () => confirmInline(li, "Endgültig verwerfen?", "Verwerfen", async () => { await discardOp(o.seq); render(); }) }, "Verwerfen") : null);
        return li;
      })),
    );
  }
  await render();
  const on = () => render();
  events.addEventListener("outbox", on);
  return () => events.removeEventListener("outbox", on);
}

// ---------- Statusleiste ----------

let authExpired = false;
async function updateStatus() {
  const el = $("#sync");
  const sum = await outboxSummary();
  let text, cls = "";
  if (authExpired) { text = "Anmeldung abgelaufen"; cls = "err"; }
  else if (!navigator.onLine) { text = sum.items ? `Offline · ${sum.items} warten` : "Offline"; cls = "warn"; }
  else if (sum.failed.length) { text = `Fehler bei ${sum.failed.length} · antippen`; cls = "err"; }
  else if (sum.total) { text = sum.items ? `${sum.items} ${sum.items === 1 ? "Gegenstand wartet" : "Gegenstände warten"} auf Upload` : "Änderungen werden hochgeladen"; cls = "warn"; }
  else text = "Alles hochgeladen";
  el.textContent = text;
  el.className = "sync " + cls;
  $("#auth").hidden = !authExpired;
}

// ---------- Start ----------

function init() {
  $("#sync").onclick = () => go("upload");
  $("#relogin").onclick = () => location.reload();
  events.addEventListener("outbox", updateStatus);
  events.addEventListener("sync", updateStatus);
  events.addEventListener("auth", (e) => { if (authExpired !== e.detail) { authExpired = e.detail; updateStatus(); } });
  addEventListener("online", updateStatus);
  addEventListener("offline", updateStatus);
  addEventListener("hashchange", route);
  updateStatus();
  startSync();
  route();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
}
init();
