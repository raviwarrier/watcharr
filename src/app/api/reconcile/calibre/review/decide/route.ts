import { NextResponse } from "next/server";
import { z } from "zod";
import { decideCalibreReview } from "@/lib/calibre";

const bodySchema = z.object({
  bookIds: z.array(z.number().int().positive()).min(1).max(500),
  decision: z.enum(["confirm", "reject"]),
});

/** POST /api/reconcile/calibre/review/decide  { bookIds, decision } */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose books and a decision." }, { status: 400 });
  return NextResponse.json({ ok: true, changed: decideCalibreReview(parsed.data.bookIds, parsed.data.decision) });
}
