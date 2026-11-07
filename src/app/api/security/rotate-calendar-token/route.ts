import { NextResponse } from "next/server";
import { randomToken } from "@/lib/auth";
import { setSetting } from "@/lib/db";

/**
 * POST /api/security/rotate-calendar-token (signed in only, enforced by the proxy).
 * The old calendar URL stops working. Returns the new token.
 */
export async function POST() {
  const token = randomToken();
  await setSetting("calendarToken", token);
  return NextResponse.json({ token });
}
