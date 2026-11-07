import { NextResponse } from "next/server";
import { hasCalibreCopy, reconcileCalibreAll } from "@/lib/calibre";

/** POST /api/reconcile/calibre/run. Matches the whole watchlist against the Calibre copy. */
export async function POST() {
  if (!hasCalibreCopy()) {
    return NextResponse.json({ error: "Upload your Calibre metadata.db first." }, { status: 400 });
  }
  try {
    return NextResponse.json(await reconcileCalibreAll());
  } catch {
    return NextResponse.json({ error: "Calibre reconciliation failed. Check the uploaded file is a valid metadata.db." }, { status: 500 });
  }
}
