import { describe, expect, it, beforeAll } from "vitest";
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK, type JWTVerifyGetKey } from "jose";
import { verifyAccess, AccessError } from "../src/access";
import type { Env } from "../src/env";

const TEAM = "team.cloudflareaccess.com";
const AUD = "aud-123";
const env = {
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUD,
  ALLOWED_EMAILS: "a@example.org, B@example.org",
} as unknown as Env;

let privateKey: CryptoKey;
let getKey: JWTVerifyGetKey;

beforeAll(async () => {
  const kp = await generateKeyPair("RS256");
  privateKey = kp.privateKey as CryptoKey;
  const jwk = { ...(await exportJWK(kp.publicKey)), kid: "k1", alg: "RS256" };
  getKey = createLocalJWKSet({ keys: [jwk] });
});

async function token(claims: Record<string, unknown>, opts: { iss?: string; aud?: string; exp?: string } = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.iss ?? `https://${TEAM}`)
    .setAudience(opts.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "1h")
    .sign(privateKey);
}

function req(jwt?: string, host = "inventar.example.org") {
  return new Request(`https://${host}/api/me`, { headers: jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {} });
}

async function status(p: Promise<unknown>) {
  try { await p; return 200; } catch (e) { return (e as AccessError).status; }
}

describe("verifyAccess", () => {
  it("akzeptiert gültiges Token einer erlaubten Adresse (Groß-/Kleinschreibung egal)", async () => {
    const u = await verifyAccess(req(await token({ email: "b@EXAMPLE.org" })), env, getKey);
    expect(u.email).toBe("b@example.org");
  });
  it("lehnt fehlendes Token ab", async () => {
    expect(await status(verifyAccess(req(), env, getKey))).toBe(401);
  });
  it("lehnt falsche Audience ab", async () => {
    expect(await status(verifyAccess(req(await token({ email: "a@example.org" }, { aud: "x" })), env, getKey))).toBe(401);
  });
  it("lehnt falschen Aussteller ab", async () => {
    expect(await status(verifyAccess(req(await token({ email: "a@example.org" }, { iss: "https://evil" })), env, getKey))).toBe(401);
  });
  it("lehnt abgelaufenes Token ab", async () => {
    expect(await status(verifyAccess(req(await token({ email: "a@example.org" }, { exp: "-1m" })), env, getKey))).toBe(401);
  });
  it("lehnt nicht freigegebene Adresse ab", async () => {
    expect(await status(verifyAccess(req(await token({ email: "c@example.org" })), env, getKey))).toBe(403);
  });
  it("Dev-Umgehung wirkt nicht außerhalb von localhost", async () => {
    const e = { ...env, DEV_ACCESS_EMAIL: "dev@example.org" } as Env;
    expect(await status(verifyAccess(req(), e, getKey))).toBe(401);
    expect((await verifyAccess(req(undefined, "localhost"), e, getKey)).email).toBe("dev@example.org");
  });
});
