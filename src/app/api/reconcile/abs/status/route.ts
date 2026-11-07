import { NextResponse } from "next/server";
import { absSettings } from "@/lib/reconcile";
import { getSettingSync, sqlite } from "@/lib/db";

/** GET /api/reconcile/abs/status. Never returns the API key or token. */
export async function GET() {
  const cfg = absSettings();
  const review = (sqlite.prepare("select count(*) as n from books where abs_match = 'review'").get() as { n: number }).n;
  const matched = (sqlite.prepare("select count(*) as n from books where abs_match = 'title_author'").get() as { n: number }).n;
  return NextResponse.json(
    {
      configured: cfg !== null,
      url: cfg?.url ?? null,
      mode: cfg?.mode ?? null,
      libraryId: cfg?.libraryId ?? null,
      lastRun: getSettingSync("absLastRun"),
      matched,
      review,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
