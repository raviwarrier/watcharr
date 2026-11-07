import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as schema from "@/db/schema";
import { desc } from "drizzle-orm";

/** GET /api/author-watches - authors whose books are being watched */
export async function GET() {
  const rows = await db
    .select({
      id: schema.authorWatches.id,
      hardcoverAuthorId: schema.authorWatches.hardcoverAuthorId,
      name: schema.authorWatches.name,
      lastSyncedAt: schema.authorWatches.lastSyncedAt,
      createdAt: schema.authorWatches.createdAt,
    })
    .from(schema.authorWatches)
    .orderBy(desc(schema.authorWatches.createdAt));
  return NextResponse.json(rows, { headers: { "Cache-Control": "no-store" } });
}
