import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";

type RouteContext = { params: Promise<{ id: string }> };

/** DELETE /api/author-watches/[id] - stop watching an author and remove their auto-added books */
export async function DELETE(_req: Request, ctx: RouteContext) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  await db.delete(schema.books).where(eq(schema.books.authorWatchId, id));
  await db.delete(schema.authorWatches).where(eq(schema.authorWatches.id, id));
  return NextResponse.json({ ok: true });
}
