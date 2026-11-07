import { NextResponse } from "next/server";
import { z } from "zod";
import { decideReview } from "@/lib/reconcile";

const bodySchema = z.object({
  bookIds: z.array(z.number().int().positive()).min(1).max(500),
  decision: z.enum(["confirm", "reject"]),
});

/** POST /api/reconcile/abs/review/decide  { bookIds, decision: "confirm" | "reject" } */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose books and a decision." }, { status: 400 });
  const changed = decideReview(parsed.data.bookIds, parsed.data.decision);
  return NextResponse.json({ ok: true, changed });
}
