// App-Hülle offline verfügbar halten. API-Aufrufe und Fotos gehen nie über diesen Cache.
// __BUILD__ und __FILES__ setzt scripts/bundle-public.mjs beim Bauen ein.
const CACHE = "shell-__BUILD__";
const SHELL = __FILES__;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  // Netz zuerst (neue Versionen kommen sofort an), ohne Netz die gespeicherte Hülle.
  // redirect: "manual" – eine Weiterleitung zur Anmeldung darf nicht im Cache landen.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(url.pathname === "/" ? "/index.html" : e.request, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request).then((r) => r || (e.request.mode === "navigate" ? caches.match("/index.html") : Response.error())),
      ),
  );
});
