import { NextResponse } from "next/server";
import { setSetting } from "@/lib/db";

/**
 * POST /api/security/set-calendar-token  { token }  (signed in only, enforced by the proxy).
 * Used by the install script to store the calendar token it generated, so the app can show the
 * subscription link later. Only a 64-character hex token is accepted.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!/^[0-9a-f]{64}$/.test(token)) {
    return NextResponse.json({ error: "Expected a 64-character hex token." }, { status: 400 });
  }
  await setSetting("calendarToken", token);
  return NextResponse.json({ ok: true });
}
