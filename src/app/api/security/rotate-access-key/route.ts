import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_DAYS, randomToken, sessionValueFor, sha256Hex } from "@/lib/auth";
import { setSetting } from "@/lib/db";

/**
 * POST /api/security/rotate-access-key (signed in only, enforced by the proxy).
 * Makes a new access key, stores its hash, and returns the key once.
 * Every other session stops working. This request's session is renewed.
 */
export async function POST() {
  const key = randomToken();
  const hash = sha256Hex(key);
  await setSetting("accessKeyHash", hash);

  const response = NextResponse.json({ key });
  response.cookies.set(SESSION_COOKIE, sessionValueFor(hash), {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  return response;
}
