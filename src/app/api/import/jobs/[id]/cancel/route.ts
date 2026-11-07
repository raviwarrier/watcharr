import { NextResponse } from "next/server";
import { cancelJob } from "@/lib/importer";

type RouteContext = { params: Promise<{ id: string }> };

/** POST /api/import/jobs/[id]/cancel - stops a job; books already added stay on the watchlist. */
export async function POST(_req: Request, ctx: RouteContext) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid job." }, { status: 400 });
  if (!cancelJob(id)) {
    return NextResponse.json({ error: "This import is already finished." }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
