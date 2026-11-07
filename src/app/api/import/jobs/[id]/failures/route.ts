import { NextResponse } from "next/server";
import { failuresCsv } from "@/lib/importer";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/import/jobs/[id]/failures - CSV of books that weren't found. */
export async function GET(_req: Request, ctx: RouteContext) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid job." }, { status: 400 });
  return new NextResponse(failuresCsv(id), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="watcharr-import-${id}-not-found.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
