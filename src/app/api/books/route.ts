import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as schema from "@/db/schema";
import { desc } from "drizzle-orm";

/**
 * GET /api/books - list the watchlist.
 * Books are added only through /api/watch, so every row comes from a Hardcover record.
 */
export async function GET() {
  const rows = await db.select().from(schema.books).orderBy(desc(schema.books.createdAt));
  return NextResponse.json(rows, { headers: { "Cache-Control": "no-store" } });
}
