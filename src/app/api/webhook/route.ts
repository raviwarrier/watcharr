import { NextResponse } from "next/server";
import { getSetting } from "@/lib/db";

/** POST /api/webhook - send a notification to configured webhook URL(s) */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { url, event, payload } = body;

    const targetUrl = url || (await getSetting("webhookUrl"));
    if (!targetUrl) {
      return NextResponse.json(
        { error: "No webhook URL configured" },
        { status: 400 },
      );
    }

    const res = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "watcharr/0.6.2",
      },
      body: JSON.stringify({
        event: event ?? "book-release",
        timestamp: new Date().toISOString(),
        ...payload,
      }),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Webhook returned ${res.status}` },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true, status: res.status });
  } catch (err) {
    return NextResponse.json(
      { error: "Webhook delivery failed", details: String(err) },
      { status: 500 },
    );
  }
}
