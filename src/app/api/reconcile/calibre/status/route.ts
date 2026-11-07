import { NextResponse } from "next/server";
import { hasCalibreCopy } from "@/lib/calibre";
import { getSettingSync, sqlite } from "@/lib/db";

/** GET /api/reconcile/calibre/status */
export async function GET() {
  const count = (sql: string) => (sqlite.prepare(sql).get() as { n: number }).n;
  return NextResponse.json(
    {
      hasCopy: hasCalibreCopy(),
      uploadedAt: getSettingSync("calibreUploadedAt"),
      lastRun: getSettingSync("calibreLastRun"),
      matched: count("select count(*) as n from books where cal_match = 'title_author'"),
      review: count("select count(*) as n from books where cal_match = 'review'"),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
