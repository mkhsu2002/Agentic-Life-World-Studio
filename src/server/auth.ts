import { SignJWT, jwtVerify } from "jose";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Context } from "hono";
import type { Env } from "./env";
import { DomainError, sha256 } from "./domain";
type C = Context<{ Bindings: Env }>;
const cookie = "world_studio_session";
export async function authenticated(c: C) {
  const token = getCookie(c, cookie);
  if (!token || !c.env.SESSION_SECRET) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(c.env.SESSION_SECRET), {
      issuer: "world-studio",
      audience: "studio-owner",
    });
    return true;
  } catch {
    return false;
  }
}
export async function login(c: C, password: string) {
  if (!c.env.STUDIO_PASSWORD || !c.env.SESSION_SECRET)
    throw new DomainError(
      "STUDIO_NOT_CONFIGURED",
      "Studio access is not configured",
      503,
    );
  const ip = c.req.header("CF-Connecting-IP") || "local";
  const bucket = await sha256(ip + ":" + Math.floor(Date.now() / 900000));
  const stamp = Date.now();
  await c.env.DB.prepare(
    "INSERT INTO auth_attempts(bucket,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1",
  )
    .bind(bucket, stamp + 1800000)
    .run();
  const record = await c.env.DB.prepare(
    "SELECT attempts FROM auth_attempts WHERE bucket=?",
  )
    .bind(bucket)
    .first<{ attempts: number }>();
  if ((record?.attempts || 0) > 8)
    throw new DomainError(
      "LOGIN_RATE_LIMIT",
      "Too many attempts. Try again in 15 minutes.",
      429,
    );
  const expected = await sha256(c.env.STUDIO_PASSWORD),
    received = await sha256(password);
  let diff = 0;
  for (let i = 0; i < expected.length; i++)
    diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  if (diff)
    throw new DomainError(
      "LOGIN_FAILED",
      "The access password is incorrect",
      401,
    );
  const token = await new SignJWT({ sub: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("world-studio")
    .setAudience("studio-owner")
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(new TextEncoder().encode(c.env.SESSION_SECRET));
  setCookie(c, cookie, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Strict",
    path: "/",
    maxAge: 28800,
  });
  await c.env.DB.prepare("DELETE FROM auth_attempts WHERE expires_at<?")
    .bind(stamp)
    .run();
}
export function logout(c: C) {
  deleteCookie(c, cookie, { path: "/" });
}
export function validateOrigin(c: C) {
  const origin = c.req.header("Origin");
  if (origin && origin !== new URL(c.req.url).origin)
    throw new DomainError(
      "ORIGIN_FORBIDDEN",
      "Cross-site operation rejected",
      403,
    );
}
