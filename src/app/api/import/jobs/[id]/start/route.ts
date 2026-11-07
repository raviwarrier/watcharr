import { NextResponse } from "next/server";
import { startJob } from "@/lib/importer";

type RouteContext = { params: Promise<{ id: string }> };

/** POST /api/import/jobs/[id]/start - begins the paced import. */
export async function POST(_req: Request, ctx: RouteContext) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid job." }, { status: 400 });
  if (!startJob(id)) {
    return NextResponse.json({ error: "This import can't be started." }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
