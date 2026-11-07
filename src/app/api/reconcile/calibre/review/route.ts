import { NextResponse } from "next/server";
import { listCalibreReview } from "@/lib/calibre";

/** GET /api/reconcile/calibre/review?offset&limit&q */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const offset = Math.max(0, Number(params.get("offset") ?? 0) || 0);
  const limit = Math.min(100, Math.max(1, Number(params.get("limit") ?? 20) || 20));
  const q = (params.get("q") ?? "").slice(0, 200);
  return NextResponse.json(listCalibreReview(offset, limit, q), { headers: { "Cache-Control": "no-store" } });
}
