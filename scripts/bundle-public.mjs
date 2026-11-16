// Packt die Dateien aus ./public in ein Modul, das der Worker selbst ausliefert.
// Läuft automatisch vor `wrangler dev` und `wrangler deploy` (siehe wrangler.jsonc → build).
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, extname } from "node:path";

const ROOT = "public";
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
};
const TEXT = new Set([".html", ".css", ".js", ".mjs", ".json", ".webmanifest", ".svg"]);

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const entries = {};
for (const file of walk(ROOT).sort()) {
  const ext = extname(file);
  const type = TYPES[ext];
  if (!type) throw new Error(`Unbekannter Dateityp: ${file}`);
  const buf = readFileSync(file);
  const path = "/" + relative(ROOT, file).split("\\").join("/");
  entries[path] = {
    type,
    etag: '"' + createHash("sha256").update(buf).digest("hex").slice(0, 16) + '"',
    ...(TEXT.has(ext) ? { text: buf.toString("utf8") } : { b64: buf.toString("base64") }),
  };
}

writeFileSync(
  "src/public.gen.ts",
  "// Automatisch erzeugt von scripts/bundle-public.mjs – nicht von Hand bearbeiten.\n" +
    "export interface PublicFile { type: string; etag: string; text?: string; b64?: string }\n" +
    "export const PUBLIC_FILES: Record<string, PublicFile> = " +
    JSON.stringify(entries, null, 1) +
    ";\n",
);
console.log(`public: ${Object.keys(entries).length} Dateien gebündelt`);
