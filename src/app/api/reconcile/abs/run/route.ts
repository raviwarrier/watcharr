import { NextResponse } from "next/server";
import { AbsError } from "@/lib/audiobookshelf";
import { absSettings, reconcileAll } from "@/lib/reconcile";

/** POST /api/reconcile/abs/run. Matches the whole watchlist against the Audiobookshelf library. */
export async function POST() {
  if (!absSettings()) {
    return NextResponse.json({ error: "Connect Audiobookshelf first." }, { status: 400 });
  }
  try {
    return NextResponse.json(await reconcileAll());
  } catch (err) {
    if (err instanceof AbsError) return NextResponse.json({ error: err.message }, { status: 502 });
    return NextResponse.json({ error: "Reconciliation failed." }, { status: 500 });
  }
}
