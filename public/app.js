const $ = (s) => document.querySelector(s);

function setNet() { $("#net").textContent = navigator.onLine ? "online" : "offline"; }
addEventListener("online", setNet); addEventListener("offline", setNet); setNet();

async function loadHealth() {
  const dl = $("#health");
  try {
    const res = await fetch("/api/health", { credentials: "same-origin" });
    const data = await res.json();
    if (!res.ok && !data.checks) throw new Error(data.error || res.statusText);
    const labels = { d1: "Datenbank", r2: "Fotospeicher", anthropic_key: "Claude-Schlüssel" };
    dl.innerHTML = "";
    for (const [k, v] of Object.entries(data.checks)) {
      const dt = document.createElement("dt"); dt.textContent = labels[k] || k;
      const dd = document.createElement("dd"); dd.textContent = v;
      dd.className = v === "ok" || v === "hinterlegt" ? "ok" : "err";
      dl.append(dt, dd);
    }
    const me = await fetch("/api/me").then((r) => r.ok ? r.json() : null);
    if (me) $("#who").textContent = "Angemeldet als " + me.email;
  } catch (e) {
    dl.innerHTML = "";
    const dt = document.createElement("dt"); dt.textContent = "Fehler";
    const dd = document.createElement("dd"); dd.textContent = e.message; dd.className = "err";
    dl.append(dt, dd);
  }
}
loadHealth();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
