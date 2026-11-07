import { NextResponse } from "next/server";
import { RecheckError, recheckBook, sendChangeAlerts } from "@/lib/recheck";

/**
 * POST /api/check - re-check one book (Hardcover, plus Apple Books for released audiobooks).
 * Sends Gotify alerts for any format that just became available, if that alert is enabled.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const bookId = Number(body?.bookId);
  if (!Number.isInteger(bookId) || bookId <= 0) {
    return NextResponse.json({ error: "bookId is required" }, { status: 400 });
  }

  try {
    const outcome = await recheckBook(bookId);
    const alertWarnings = await sendChangeAlerts(outcome.book, outcome.changes);
    return NextResponse.json({ book: outcome.book, warnings: [...outcome.warnings, ...alertWarnings] });
  } catch (err) {
    if (err instanceof RecheckError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Re-check failed" }, { status: 500 });
  }
}
