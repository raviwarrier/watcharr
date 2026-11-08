import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as schema from "@/db/schema";
import { desc, isNotNull, isNull } from "drizzle-orm";
import { absSettings } from "@/lib/reconcile";

/**
 * GET /api/books - the watchlist. Ignored books are left out.
 * GET /api/books?ignored=1 - only the ignored books.
 * Books are added only through /api/watch, so every row comes from a Hardcover record.
 */
export async function GET(req: Request) {
  const ignored = new URL(req.url).searchParams.get("ignored") === "1";
  const rows = await db
    .select()
    .from(schema.books)
    .where(ignored ? isNotNull(schema.books.ignoredAt) : isNull(schema.books.ignoredAt))
    .orderBy(desc(schema.books.createdAt));
  // Link each matched book to its page in Audiobookshelf.
  const abs = absSettings();
  const withLinks = rows.map((b) => ({
    ...b,
    absItemUrl: abs && b.absItemId ? `${abs.url}/item/${b.absItemId}` : null,
  }));
  return NextResponse.json(withLinks, { headers: { "Cache-Control": "no-store" } });
}
