import { NextResponse } from "next/server";
import { removeCalibreCopy } from "@/lib/calibre";
import { sqlite } from "@/lib/db";

/**
 * POST /api/reconcile/calibre/remove. Deletes the stored copy of metadata.db.
 * Books keep their ownership marks, since those are your data.
 */
export async function POST() {
  removeCalibreCopy();
  sqlite.prepare("delete from settings where key in ('calibreUploadedAt', 'calibreLastRun')").run();
  return NextResponse.json({ ok: true });
}
