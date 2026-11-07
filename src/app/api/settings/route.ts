import { NextResponse } from "next/server";
import { db, getSettingsStatus, setSetting } from "@/lib/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { RECHECK_INTERVALS } from "@/lib/prefs";

/** Only these keys can be written from the UI. */
const KNOWN_KEYS = [
  "hardcoverApiKey",
  "webhookUrl",
  "gotifyUrl",
  "gotifyToken",
  "recheckInterval",
  "alertEbook",
  "alertAudiobook",
  "alertScheduled",
  "reconcileAudiobooks",
  "reconcileEbooks",
  "authorIncludeTba",
  "authorIncludeReleased",
] as const;

const BOOLEAN_KEYS = [
  "alertEbook",
  "alertAudiobook",
  "alertScheduled",
  "reconcileAudiobooks",
  "reconcileEbooks",
  "authorIncludeTba",
  "authorIncludeReleased",
] as const;

const saveSchema = z
  .object({
    key: z.enum(KNOWN_KEYS),
    value: z.string().trim().min(1).max(2000),
  })
  .refine((v) => v.key !== "recheckInterval" || v.value in RECHECK_INTERVALS, {
    message: "Unknown interval",
    path: ["value"],
  })
  .refine((v) => !(BOOLEAN_KEYS as readonly string[]).includes(v.key) || v.value === "true" || v.value === "false", {
    message: "Expected true or false",
    path: ["value"],
  });

/** GET /api/settings - status only. Secret values are masked, never returned in full. */
export async function GET() {
  return NextResponse.json(await getSettingsStatus(), {
    headers: { "Cache-Control": "no-store" },
  });
}

/** POST /api/settings - set one setting { key, value } */
export async function POST(req: Request) {
  try {
    const parsed = saveSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid setting" }, { status: 400 });
    }
    await setSetting(parsed.data.key, parsed.data.value);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to save setting" }, { status: 500 });
  }
}

/** DELETE /api/settings?key=... - clear a saved setting */
export async function DELETE(req: Request) {
  const key = new URL(req.url).searchParams.get("key");
  if (!KNOWN_KEYS.includes(key as (typeof KNOWN_KEYS)[number])) {
    return NextResponse.json({ error: "Unknown setting" }, { status: 400 });
  }
  await db.delete(schema.settings).where(eq(schema.settings.key, key!));
  return NextResponse.json({ ok: true });
}
