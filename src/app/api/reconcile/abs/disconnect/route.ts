import { NextResponse } from "next/server";
import { sqlite } from "@/lib/db";
import { clearAbsIndex } from "@/lib/reconcile";

/**
 * POST /api/reconcile/abs/disconnect. Removes the saved address and credentials.
 * Books keep their ownership marks and match links, since those are your data.
 */
export async function POST() {
  const keys = ["absUrl", "absSecret", "absAuthMode", "absLibraryId", "absLastRun"];
  sqlite.prepare(`delete from settings where key in (${keys.map(() => "?").join(", ")})`).run(...keys);
  clearAbsIndex();
  return NextResponse.json({ ok: true });
}
