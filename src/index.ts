import { AccessError, verifyAccess, type AccessUser } from "./access";
import type { Env } from "./env";
import { HttpError, json } from "./http";
import { serveStatic } from "./static";
import {
  createContainer, createRoom, deleteContainer, deleteRoom, listRooms, updateContainer, updateRoom,
} from "./rooms";
import { createItem, deleteItem, getPhoto, listItems, uploadPhoto } from "./items";

type Handler = (req: Request, env: Env, user: AccessUser, params: string[]) => Promise<Response>;

const routes: [string, RegExp, Handler][] = [
  ["GET", /^\/api\/health$/, async (_req, env) => health(env)],
  ["GET", /^\/api\/me$/, async (_req, _env, user) => json({ email: user.email })],

  ["GET", /^\/api\/rooms$/, (_r, env) => listRooms(env)],
  ["POST", /^\/api\/rooms$/, (r, env) => createRoom(r, env)],
  ["PATCH", /^\/api\/rooms\/([^/]+)$/, (r, env, _u, [id]) => updateRoom(r, env, id)],
  ["DELETE", /^\/api\/rooms\/([^/]+)$/, (_r, env, _u, [id]) => deleteRoom(env, id)],
  ["POST", /^\/api\/containers$/, (r, env) => createContainer(r, env)],
  ["PATCH", /^\/api\/containers\/([^/]+)$/, (r, env, _u, [id]) => updateContainer(r, env, id)],
  ["DELETE", /^\/api\/containers\/([^/]+)$/, (_r, env, _u, [id]) => deleteContainer(env, id)],

  ["GET", /^\/api\/items$/, (r, env) => listItems(r, env)],
  ["POST", /^\/api\/items$/, (r, env, u) => createItem(r, env, u)],
  ["DELETE", /^\/api\/items\/([^/]+)$/, (_r, env, _u, [id]) => deleteItem(env, id)],
  ["POST", /^\/api\/items\/([^/]+)\/photos$/, (r, env, _u, [id]) => uploadPhoto(r, env, id)],
  ["GET", /^\/api\/photos\/([^/]+)\/(thumb|full)$/, (r, env, _u, [id, size]) => getPhoto(r, env, id, size)],
];

async function health(env: Env): Promise<Response> {
  const checks: Record<string, string> = {};
  try {
    await env.DB.prepare("SELECT COUNT(*) AS n FROM settings").first();
    checks.d1 = "ok";
  } catch (e) {
    checks.d1 = "fehler: " + (e as Error).message;
  }
  try {
    await env.PHOTOS.head("__health");
    checks.r2 = "ok";
  } catch (e) {
    checks.r2 = "fehler: " + (e as Error).message;
  }
  checks.anthropic_key = env.ANTHROPIC_API_KEY ? "hinterlegt" : "fehlt";
  const ok = checks.d1 === "ok" && checks.r2 === "ok";
  return json({ ok, checks, time: new Date().toISOString() }, ok ? 200 : 503);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return serveStatic(request);

    let user: AccessUser;
    try {
      user = await verifyAccess(request, env);
    } catch (e) {
      if (e instanceof AccessError) return json({ error: e.message }, e.status);
      throw e;
    }

    let pathMatched = false;
    for (const [method, re, handler] of routes) {
      const m = re.exec(url.pathname);
      if (!m) continue;
      pathMatched = true;
      if (method !== request.method) continue;
      try {
        return await handler(request, env, user, m.slice(1).map(decodeURIComponent));
      } catch (e) {
        if (e instanceof HttpError) return json({ error: e.message }, e.status);
        console.error(e);
        return json({ error: "Interner Fehler" }, 500);
      }
    }
    return json({ error: pathMatched ? "Methode nicht erlaubt" : "Nicht gefunden" }, pathMatched ? 405 : 404);
  },

  async scheduled(): Promise<void> {
    // Phase 3: offene Message Batches abfragen und Ergebnisse übernehmen.
  },
} satisfies ExportedHandler<Env>;
