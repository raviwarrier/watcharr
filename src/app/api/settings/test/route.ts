import { NextResponse } from "next/server";
import { HardcoverError, searchCandidates } from "@/lib/hardcover";

/** POST /api/settings/test - checks the saved Hardcover token with one small search. */
export async function POST() {
  try {
    const { books } = await searchCandidates({ title: "Dune" }, 1);
    return NextResponse.json({
      ok: true,
      message: books.length > 0 ? "Connected to Hardcover." : "Connected, but the test search returned nothing.",
    });
  } catch (err) {
    if (err instanceof HardcoverError) {
      return NextResponse.json({ ok: false, message: err.message }, { status: 200 });
    }
    return NextResponse.json({ ok: false, message: "Could not reach Hardcover." }, { status: 200 });
  }
}
