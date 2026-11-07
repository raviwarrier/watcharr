import { NextResponse } from "next/server";
import { HardcoverError, HardcoverNotConfiguredError, searchCandidates } from "@/lib/hardcover";

/** GET /api/search?title=&author= - candidate books and authors from Hardcover */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const title = (searchParams.get("title") ?? "").slice(0, 200);
  const author = (searchParams.get("author") ?? "").slice(0, 200);

  if (!title.trim() && !author.trim()) {
    return NextResponse.json({ error: "Enter a title, an author, or both" }, { status: 400 });
  }

  try {
    const results = await searchCandidates({ title, author });
    return NextResponse.json(results, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof HardcoverNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof HardcoverError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
