import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Env } from "./env";

export interface AccessUser {
  email: string;
}

export class AccessError extends Error {
  constructor(message: string, readonly status = 403) {
    super(message);
  }
}

// Die öffentlichen Schlüssel von Access werden pro Isolate zwischengespeichert;
// jose lädt sie bei Schlüsselwechsel selbst neu.
const jwksCache = new Map<string, JWTVerifyGetKey>();

function jwksFor(teamDomain: string): JWTVerifyGetKey {
  let jwks = jwksCache.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    jwksCache.set(teamDomain, jwks);
  }
  return jwks;
}

export function allowedEmails(env: Env): Set<string> {
  return new Set(
    (env.ALLOWED_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Prüft das Access-JWT jeder Anfrage selbst (Signatur, Aussteller, Audience,
 * Ablauf) und zusätzlich die E-Mail gegen die Liste ALLOWED_EMAILS.
 * Verlässt sich also nicht allein darauf, dass Access davor konfiguriert ist.
 */
export async function verifyAccess(
  request: Request,
  env: Env,
  getKey?: JWTVerifyGetKey,
): Promise<AccessUser> {
  // Nur für `wrangler dev` auf dem eigenen Rechner: DEV_ACCESS_EMAIL steht
  // ausschließlich in .dev.vars und wirkt nur bei Aufruf über localhost.
  const host = new URL(request.url).hostname;
  if (env.DEV_ACCESS_EMAIL && (host === "localhost" || host === "127.0.0.1")) {
    return { email: env.DEV_ACCESS_EMAIL.toLowerCase() };
  }

  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    throw new AccessError("Access ist nicht konfiguriert", 500);
  }
  const allowed = allowedEmails(env);
  if (allowed.size === 0) {
    throw new AccessError("Keine erlaubten E-Mail-Adressen hinterlegt", 500);
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) throw new AccessError("Nicht angemeldet", 401);

  let payload;
  try {
    ({ payload } = await jwtVerify(token, getKey ?? jwksFor(env.ACCESS_TEAM_DOMAIN), {
      issuer: `https://${env.ACCESS_TEAM_DOMAIN}`,
      audience: env.ACCESS_AUD,
      algorithms: ["RS256"],
    }));
  } catch {
    throw new AccessError("Anmeldung ungültig oder abgelaufen", 401);
  }

  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  if (!email || !allowed.has(email)) {
    throw new AccessError("Kein Zugriff für diese Adresse", 403);
  }
  return { email };
}
