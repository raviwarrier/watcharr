import { NextResponse } from "next/server";
import { z } from "zod";
import { HardcoverError, HardcoverNotConfiguredError } from "@/lib/hardcover";
import { watchAuthor, watchBook } from "@/lib/watch";

const bodySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("book"),
    hardcoverId: z.number().int().positive(),
    replaceBookId: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal("author"),
    hardcoverAuthorId: z.number().int().positive(),
    name: z.string().trim().min(1).max(200),
  }),
]);

/** POST /api/watch - watch one book, or every upcoming book by an author */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid watch request" }, { status: 400 });
  }

  try {
    if (parsed.data.type === "book") {
      const result = await watchBook(parsed.data.hardcoverId, parsed.data.replaceBookId);
      if (!result) return NextResponse.json({ error: "Book not found on Hardcover" }, { status: 404 });
      if ("missing" in result) {
        return NextResponse.json(
          { error: "The book you were matching was removed. Search again to add it." },
          { status: 404 },
        );
      }
      if ("conflict" in result) {
        return NextResponse.json(
          { error: "That Hardcover book is already on your watchlist as a separate entry." },
          { status: 409 },
        );
      }
      return NextResponse.json(result, { status: result.created ? 201 : 200 });
    }

    const result = await watchAuthor(parsed.data.hardcoverAuthorId, parsed.data.name);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof HardcoverNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof HardcoverError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json({ error: "Failed to add watch" }, { status: 500 });
  }
}
