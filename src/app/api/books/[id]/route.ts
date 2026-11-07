import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { updateBookSchema } from "@/db/schema";

type RouteContext = { params: Promise<{ id: string }> };

async function getId(ctx: RouteContext) {
  const { id } = await ctx.params;
  return Number(id);
}

/** GET /api/books/[id] */
export async function GET(_req: Request, ctx: RouteContext) {
  const id = await getId(ctx);
  const [book] = await db
    .select()
    .from(schema.books)
    .where(eq(schema.books.id, id));
  if (!book) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }
  return NextResponse.json(book);
}

/** PUT /api/books/[id] */
export async function PUT(req: Request, ctx: RouteContext) {
  try {
    const id = await getId(ctx);
    const body = await req.json();
    const parsed = updateBookSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const [book] = await db
      .update(schema.books)
      .set({ ...parsed.data, updatedAt: new Date().toISOString() })
      .where(eq(schema.books.id, id))
      .returning();

    if (!book) {
      return NextResponse.json({ error: "Book not found" }, { status: 404 });
    }
    return NextResponse.json(book);
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to update book", details: String(err) },
      { status: 500 },
    );
  }
}

/** DELETE /api/books/[id] - removes the book and its check history */
export async function DELETE(_req: Request, ctx: RouteContext) {
  const id = await getId(ctx);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  try {
    // release_checks references books.id, so the history must go first.
    db.transaction((tx) => {
      tx.delete(schema.releaseChecks).where(eq(schema.releaseChecks.bookId, id)).run();
      const removed = tx.delete(schema.books).where(eq(schema.books.id, id)).run();
      if (removed.changes === 0) throw new NotFoundError();
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: "Book not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to delete book" }, { status: 500 });
  }
}

class NotFoundError extends Error {}
