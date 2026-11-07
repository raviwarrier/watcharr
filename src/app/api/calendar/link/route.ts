import { NextResponse } from "next/server";
import { calendarToken, randomToken } from "@/lib/auth";
import { setSetting } from "@/lib/db";

/**
 * GET /api/calendar/link (signed in only, enforced by the proxy).
 * Returns the calendar token for the subscription link. Creates one if none exists yet
 * (for example, on an install made before tokens were stored).
 */
export async function GET() {
  let token = calendarToken();
  if (!token) {
    token = randomToken();
    await setSetting("calendarToken", token);
  }
  return NextResponse.json({ token }, { headers: { "Cache-Control": "no-store" } });
}
