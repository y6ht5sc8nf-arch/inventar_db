import { SECURITY_HEADERS } from "./static";

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...SECURITY_HEADERS,
    },
  });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const data = await req.json();
    if (data && typeof data === "object" && !Array.isArray(data)) return data as Record<string, unknown>;
  } catch {
    /* unten */
  }
  throw new HttpError(400, "Ungültige Daten");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuid(v: unknown, field = "id"): string {
  if (typeof v !== "string" || !UUID.test(v)) throw new HttpError(400, `Ungültige ${field}`);
  return v.toLowerCase();
}

export function optUuid(v: unknown, field: string): string | null {
  return v === null || v === undefined || v === "" ? null : uuid(v, field);
}

export function text(v: unknown, field: string, max: number, required = false): string | null {
  if (v === null || v === undefined || v === "") {
    if (required) throw new HttpError(400, `${field} fehlt`);
    return null;
  }
  if (typeof v !== "string") throw new HttpError(400, `${field} muss Text sein`);
  const s = v.normalize("NFC").trim();
  if (s.length > max) throw new HttpError(400, `${field} ist zu lang`);
  if (required && !s) throw new HttpError(400, `${field} fehlt`);
  return s || null;
}

export function int(v: unknown, field: string, min: number, max: number, fallback: number): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${field} ist ungültig`);
  return n;
}

export function oneOf<T extends string>(v: unknown, field: string, allowed: readonly T[], fallback?: T): T {
  if ((v === null || v === undefined || v === "") && fallback !== undefined) return fallback;
  if (typeof v === "string" && (allowed as readonly string[]).includes(v)) return v as T;
  throw new HttpError(400, `${field} ist ungültig`);
}

export function now(): string {
  return new Date().toISOString();
}
