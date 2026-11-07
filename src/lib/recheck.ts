import { db } from "@/lib/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { getBookDetail, HardcoverError } from "@/lib/hardcover";
import { upsertBook } from "@/lib/watch";
import { sendGotify } from "@/lib/gotify";
import { getAlertFlag } from "@/lib/prefs";

export type Book = typeof schema.books.$inferSelect;
export type ChangeKind = "ebook" | "audiobook";

export class RecheckError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export interface RecheckOutcome {
  book: Book;
  warnings: string[];
  /** Formats that went from known-unavailable to available during this check. */
  changes: ChangeKind[];
}

/**
 * Re-checks one linked book against Hardcover, then Apple Books for released audiobooks.
 * Throws RecheckError for expected failures (unknown book, not linked, Hardcover errors).
 */
export async function recheckBook(bookId: number): Promise<RecheckOutcome> {
  const [existing] = await db.select().from(schema.books).where(eq(schema.books.id, bookId));
  if (!existing) throw new RecheckError("Book not found", 404);
  if (!existing.hardcoverId) {
    throw new RecheckError("This book isn't linked to Hardcover yet. Use Match on Hardcover first.", 409);
  }

  let detail;
  try {
    detail = await getBookDetail(existing.hardcoverId);
  } catch (err) {
    if (err instanceof HardcoverError) throw new RecheckError(err.message, 502);
    throw new RecheckError("Re-check failed", 500);
  }
  if (!detail) throw new RecheckError("This book no longer exists on Hardcover.", 404);

  // upsertBook also double-checks Apple Books when Hardcover reports no audiobook.
  const { book: updated, warnings } = await upsertBook(detail, existing.authorWatchId);

  const [fresh] = await db
    .update(schema.books)
    .set({ lastCheckedAt: new Date().toISOString() })
    .where(eq(schema.books.id, updated.id))
    .returning();

  // Only alert on a real change from a known "not available" state.
  // null means "never checked", so a first check doesn't alert for formats already out.
  const changes: ChangeKind[] = [];
  if (existing.ebookAvailable === false && fresh.ebookAvailable === true) changes.push("ebook");
  if (existing.audiobookAvailable === false && fresh.audiobookAvailable === true) changes.push("audiobook");

  return { book: fresh, warnings, changes };
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** "{title} by {author} now is available in {format} as of {date}" */
export function availabilityMessage(book: Book, kind: ChangeKind, date = new Date()): string {
  return `${book.title} by ${book.author} now is available in ${kind} as of ${formatDate(date)}`;
}

/**
 * Sends one Gotify alert per change, if that alert type is enabled.
 * Returns warnings instead of throwing, so one failed alert doesn't hide the check result.
 */
export async function sendChangeAlerts(book: Book, changes: ChangeKind[]): Promise<string[]> {
  const warnings: string[] = [];
  for (const kind of changes) {
    const enabled = await getAlertFlag(kind === "ebook" ? "alertEbook" : "alertAudiobook");
    if (!enabled) continue;
    try {
      await sendGotify({ title: book.title, message: availabilityMessage(book, kind), priority: 5 });
    } catch (err) {
      warnings.push(`Gotify alert failed: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }
  return warnings;
}

export interface RecheckAllSummary {
  checked: number;
  failed: number;
  newEbooks: number;
  newAudiobooks: number;
}

/** Re-checks every linked book in turn, pausing between requests to stay polite to the APIs. */
export async function recheckAllLinked(delayMs = 1000): Promise<RecheckAllSummary> {
  const linked = (await db.select({ id: schema.books.id, hardcoverId: schema.books.hardcoverId }).from(schema.books))
    .filter((r) => r.hardcoverId !== null)
    .map((r) => r.id);

  const summary: RecheckAllSummary = { checked: 0, failed: 0, newEbooks: 0, newAudiobooks: 0 };
  for (const id of linked) {
    try {
      const outcome = await recheckBook(id);
      summary.checked++;
      if (outcome.changes.includes("ebook")) summary.newEbooks++;
      if (outcome.changes.includes("audiobook")) summary.newAudiobooks++;
      await sendChangeAlerts(outcome.book, outcome.changes);
    } catch {
      summary.failed++;
    }
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }
  return summary;
}
