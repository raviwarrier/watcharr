import { NextResponse } from "next/server";
import { sendGotify } from "@/lib/gotify";

/** POST /api/settings/test-gotify - sends a test message with the saved URL and token. */
export async function POST() {
  try {
    const result = await sendGotify({
      title: "Watcharr",
      message: "Test notification. Gotify is connected.",
      priority: 3,
    });
    if (result === "not-configured") {
      return NextResponse.json({ ok: false, message: "Save the Gotify URL and token first." });
    }
    return NextResponse.json({ ok: true, message: "Test message sent. Check your Gotify app." });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ ok: false, message: `Gotify test failed: ${reason}` });
  }
}
