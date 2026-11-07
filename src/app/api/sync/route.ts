import { NextResponse } from "next/server";
import { HardcoverError, HardcoverNotConfiguredError } from "@/lib/hardcover";
import { syncAllAuthorWatches } from "@/lib/watch";

/** POST /api/sync - refresh upcoming books for every watched author */
export async function POST() {
  try {
    return NextResponse.json(await syncAllAuthorWatches());
  } catch (err) {
    if (err instanceof HardcoverNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof HardcoverError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
