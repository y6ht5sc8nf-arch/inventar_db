// Packt die Dateien aus ./public (und mitgelieferte Bibliotheken) in ein Modul,
// das der Worker selbst ausliefert. Läuft automatisch vor `wrangler dev` und `wrangler deploy`.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, extname } from "node:path";

const ROOT = "public";
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const TEXT = new Set([".html", ".css", ".js", ".json", ".webmanifest", ".svg"]);

// Fremdbibliotheken mit fester Version, aus node_modules mitgebündelt (kein CDN).
const VENDOR = {
  "/vendor/zxing-0.23.0.min.js": "node_modules/@zxing/library/umd/index.min.js",
};

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = new Map();
for (const file of walk(ROOT).sort()) files.set("/" + relative(ROOT, file).split("\\").join("/"), readFileSync(file));
for (const [path, src] of Object.entries(VENDOR)) {
  // Verweis auf die (nicht mitgelieferte) Source-Map entfernen.
  files.set(path, Buffer.from(readFileSync(src, "utf8").replace(/\n\/\/# sourceMappingURL=.*$/m, "")));
}

// Service Worker: Dateiliste und Versionskennung einsetzen (neue Version = neuer Cache).
const build = createHash("sha256");
for (const [p, b] of [...files].filter(([p]) => p !== "/sw.js")) build.update(p).update(b);
const shell = ["/", ...[...files.keys()].filter((p) => p !== "/sw.js")];
files.set("/sw.js", Buffer.from(files.get("/sw.js").toString("utf8")
  .replace('"shell-__BUILD__"', JSON.stringify("shell-" + build.digest("hex").slice(0, 12)))
  .replace("= __FILES__;", "= " + JSON.stringify(shell) + ";")));

const entries = {};
for (const [path, buf] of files) {
  const ext = extname(path);
  const type = TYPES[ext];
  if (!type) throw new Error(`Unbekannter Dateityp: ${path}`);
  entries[path] = {
    type,
    etag: '"' + createHash("sha256").update(buf).digest("hex").slice(0, 16) + '"',
    ...(TEXT.has(ext) ? { text: buf.toString("utf8") } : { b64: buf.toString("base64") }),
  };
}

const OUT = "src/public.gen.ts";
const code =
  "// Automatisch erzeugt von scripts/bundle-public.mjs – nicht von Hand bearbeiten.\n" +
    "export interface PublicFile { type: string; etag: string; text?: string; b64?: string }\n" +
    "export const PUBLIC_FILES: Record<string, PublicFile> = " + JSON.stringify(entries) + ";\n";
// Nur bei Änderung schreiben – sonst löst `wrangler dev` endlos neue Builds aus.
if (!existsSync(OUT) || readFileSync(OUT, "utf8") !== code) writeFileSync(OUT, code);
console.log(`public: ${files.size} Dateien gebündelt`);
