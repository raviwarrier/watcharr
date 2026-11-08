import { NextResponse } from "next/server";
import { restoreBook } from "@/lib/watch";

type RouteContext = { params: Promise<{ id: string }> };

/** POST /api/books/[id]/restore - puts an ignored book back on the list. */
export async function POST(_req: Request, ctx: RouteContext) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const book = await restoreBook(id);
  if (!book) return NextResponse.json({ error: "Book not found" }, { status: 404 });
  return NextResponse.json({ ok: true, book });
}
