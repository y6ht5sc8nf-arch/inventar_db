import { AccessError, verifyAccess, type AccessUser } from "./access";
import type { Env } from "./env";

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

type Handler = (req: Request, env: Env, user: AccessUser, ctx: ExecutionContext) => Promise<Response>;

const routes: Record<string, Handler> = {
  "GET /api/health": async (_req, env) => {
    const checks: Record<string, string> = {};
    try {
      const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM settings").first<{ n: number }>();
      checks.d1 = row && row.n >= 0 ? "ok" : "leer";
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
  },

  "GET /api/me": async (_req, _env, user) => json({ email: user.email }),
};

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    let user: AccessUser;
    try {
      user = await verifyAccess(request, env);
    } catch (e) {
      if (e instanceof AccessError) return json({ error: e.message }, e.status);
      throw e;
    }

    const handler = routes[`${request.method} ${url.pathname}`];
    if (!handler) return json({ error: "Nicht gefunden" }, 404);
    try {
      return await handler(request, env, user, ctx);
    } catch (e) {
      console.error(e);
      return json({ error: "Interner Fehler" }, 500);
    }
  },

  async scheduled(_event, _env, _ctx): Promise<void> {
    // Phase 3: offene Message Batches abfragen und Ergebnisse übernehmen.
  },
} satisfies ExportedHandler<Env>;
