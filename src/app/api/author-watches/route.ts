import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as schema from "@/db/schema";
import { desc } from "drizzle-orm";

/** GET /api/author-watches - authors whose upcoming books are being watched */
export async function GET() {
  const rows = await db.select().from(schema.authorWatches).orderBy(desc(schema.authorWatches.createdAt));
  return NextResponse.json(rows, { headers: { "Cache-Control": "no-store" } });
}
