import { PUBLIC_FILES, type PublicFile } from "./public.gen";

// Nur eigene Inhalte; Fotos kommen als blob:/data: aus der Kamera oder von /api.
const CSP = [
  "default-src 'self'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": CSP,
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(self), microphone=(), geolocation=()",
};

function body(file: PublicFile): BodyInit {
  if (file.text !== undefined) return file.text;
  return Uint8Array.from(atob(file.b64 ?? ""), (c) => c.charCodeAt(0));
}

/** Liefert die Oberfläche aus. Unbekannte Pfade bekommen index.html (Single-Page-App). */
export function serveStatic(request: Request): Response {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Methode nicht erlaubt", { status: 405 });
  }
  let path = new URL(request.url).pathname;
  if (path === "/") path = "/index.html";
  const file = PUBLIC_FILES[path] ?? PUBLIC_FILES["/index.html"];

  const headers = new Headers(SECURITY_HEADERS);
  headers.set("content-type", file.type);
  headers.set("etag", file.etag);
  // Immer beim Server nachfragen (ETag macht das billig), damit neue Versionen sofort ankommen.
  headers.set("cache-control", "no-cache");

  if (request.headers.get("if-none-match") === file.etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(request.method === "HEAD" ? null : body(file), { headers });
}
