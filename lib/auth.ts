import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

export const SESSION_COOKIE = "rsf_session";
const SESSION_SECONDS = 60 * 60 * 12;

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
  return new TextEncoder().encode(value);
}

export async function createSession(username: string) {
  return new SignJWT({ username })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_SECONDS}s`)
    .sign(secret());
}

export async function sessionUsername(token?: string) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return typeof payload.username === "string" ? payload.username : null;
  } catch {
    return null;
  }
}

export async function requestUsername(request: NextRequest) {
  return sessionUsername(request.cookies.get(SESSION_COOKIE)?.value);
}

export async function currentUsername() {
  return sessionUsername((await cookies()).get(SESSION_COOKIE)?.value);
}

export function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return origin === new URL(request.url).origin;
}
