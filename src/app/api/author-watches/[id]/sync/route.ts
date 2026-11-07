import { NextResponse } from "next/server";
import { HardcoverError, HardcoverNotConfiguredError } from "@/lib/hardcover";
import { syncAuthorWatch } from "@/lib/watch";

type RouteContext = { params: Promise<{ id: string }> };

/** POST /api/author-watches/[id]/sync - re-check one author now. */
export async function POST(_req: Request, ctx: RouteContext) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  try {
    const result = await syncAuthorWatch(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof HardcoverNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof HardcoverError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json({ error: "Author check failed" }, { status: 500 });
  }
}
