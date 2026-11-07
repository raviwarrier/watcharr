import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import * as schema from "@/db/schema";
import { availabilityFor, getAuthorBooks, getBookDetail, type BookDetail } from "@/lib/hardcover";
import { getAuthorFlag } from "@/lib/prefs";
import { findAppleAudiobook } from "@/lib/itunes";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Only writes the audiobook date when this lookup fetched it, so other lookups keep the stored date. */
function audiobookDateValue(detail: BookDetail): { audiobookReleaseDate?: string | null } {
  return detail.audiobookReleaseDate === undefined ? {} : { audiobookReleaseDate: detail.audiobookReleaseDate };
}

function statusFor(releaseDate: string | null): "released" | "upcoming" {
  return releaseDate && releaseDate <= todayIso() ? "released" : "upcoming";
}

/**
 * Works out what's available for a book.
 * Hardcover is always the first source. When Hardcover reports no audiobook for a released
 * book, Apple Books is searched as a second opinion, so a negative Hardcover result is double-checked.
 */
export async function resolveAvailability(detail: BookDetail): Promise<{
  ebookAvailable: boolean;
  audiobookAvailable: boolean;
  appleAudiobookUrl: string | null;
  warning: string | null;
}> {
  const hardcover = availabilityFor(detail);
  const released = !!detail.releaseDate && detail.releaseDate <= todayIso();

  if (!released || hardcover.audiobookAvailable) {
    return { ...hardcover, appleAudiobookUrl: null, warning: null };
  }

  try {
    const apple = await findAppleAudiobook(detail.title, detail.authors[0] ?? "");
    return {
      ebookAvailable: hardcover.ebookAvailable,
      audiobookAvailable: apple !== null,
      appleAudiobookUrl: apple?.url ?? null,
      warning: null,
    };
  } catch {
    return {
      ...hardcover,
      appleAudiobookUrl: null,
      warning: "The Apple Books lookup failed, so the audiobook status uses Hardcover only.",
    };
  }
}

/**
 * Insert or refresh one watchlist row from Hardcover data.
 * Existing rows are matched by hardcoverId, so re-watching never duplicates.
 */
export async function upsertBook(detail: BookDetail, authorWatchId: number | null = null) {
  const availability = await resolveAvailability(detail);
  const values = {
    hardcoverId: detail.hardcoverId,
    hardcoverSlug: detail.slug,
    authorWatchId,
    title: detail.title,
    author: detail.authors.join(", ") || "Unknown author",
    coverUrl: detail.coverUrl,
    expectedReleaseDate: detail.releaseDate,
    ...audiobookDateValue(detail),
    status: statusFor(detail.releaseDate),
    ebookAvailable: availability.ebookAvailable,
    audiobookAvailable: availability.audiobookAvailable,
    appleAudiobookUrl: availability.appleAudiobookUrl,
    updatedAt: new Date().toISOString(),
  };

  const existing = await db
    .select({ id: schema.books.id })
    .from(schema.books)
    .where(eq(schema.books.hardcoverId, detail.hardcoverId))
    .limit(1);

  const warnings = availability.warning ? [availability.warning] : [];

  if (existing.length > 0) {
    const [row] = await db
      .update(schema.books)
      .set(values)
      .where(eq(schema.books.id, existing[0].id))
      .returning();
    return { book: row, created: false, warnings };
  }

  const [row] = await db.insert(schema.books).values(values).returning();
  return { book: row, created: true, warnings };
}

/**
 * Watch one book by its Hardcover id.
 * With replaceBookId, an existing unlinked row is linked to Hardcover instead of duplicated.
 */
export async function watchBook(hardcoverId: number, replaceBookId?: number) {
  const detail = await getBookDetail(hardcoverId);
  if (!detail) return null;

  if (replaceBookId) {
    const [owner] = await db
      .select({ id: schema.books.id })
      .from(schema.books)
      .where(eq(schema.books.hardcoverId, hardcoverId))
      .limit(1);
    if (owner && owner.id !== replaceBookId) return { conflict: true as const };

    const availability = await resolveAvailability(detail);
    const [row] = await db
      .update(schema.books)
      .set({
        hardcoverId: detail.hardcoverId,
        hardcoverSlug: detail.slug,
        title: detail.title,
        author: detail.authors.join(", ") || "Unknown author",
        coverUrl: detail.coverUrl,
        expectedReleaseDate: detail.releaseDate,
        ...audiobookDateValue(detail),
        status: statusFor(detail.releaseDate),
        ebookAvailable: availability.ebookAvailable,
        audiobookAvailable: availability.audiobookAvailable,
        appleAudiobookUrl: availability.appleAudiobookUrl,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.books.id, replaceBookId))
      .returning();
    return row ? { book: row, created: false } : { missing: true as const };
  }

  return upsertBook(detail, null);
}

/** Watch an author: store the author, then add every upcoming book by them. */
export async function watchAuthor(hardcoverAuthorId: number, name: string) {
  const existing = await db
    .select()
    .from(schema.authorWatches)
    .where(eq(schema.authorWatches.hardcoverAuthorId, hardcoverAuthorId))
    .limit(1);

  const watch =
    existing[0] ??
    (
      await db
        .insert(schema.authorWatches)
        .values({ hardcoverAuthorId, name })
        .returning()
    )[0];

  const added = await syncAuthorWatch(watch.id);
  return { watch, ...added };
}

/**
 * Checks one author on Hardcover and adds what's new to the watchlist.
 *
 * - A book with a future date, or with no date yet ("TBD"), is added when first seen.
 *   TBD books are only added while "Add Date TBA books" is on, and are picked up later once they get a date.
 * - A book that is already out is added when it's new. On the first check, books that are already out are
 *   skipped unless "Include released books" is on.
 * - Every book that was evaluated is remembered, so a book you removed isn't added back.
 */
export async function syncAuthorWatch(authorWatchId: number) {
  const [watch] = await db
    .select()
    .from(schema.authorWatches)
    .where(eq(schema.authorWatches.id, authorWatchId))
    .limit(1);
  if (!watch) return { added: 0, updated: 0 };

  const books = await getAuthorBooks(watch.hardcoverAuthorId);
  const includeTba = await getAuthorFlag("authorIncludeTba");
  const includeReleased = await getAuthorFlag("authorIncludeReleased");
  const today = todayIso();
  // null means this author has never been checked under these rules, so books already out are a baseline.
  const firstCheck = watch.knownBookIds === null;
  const remembered = new Set<number>(firstCheck ? [] : (JSON.parse(watch.knownBookIds ?? "[]") as number[]));
  let added = 0;
  let updated = 0;

  for (const detail of books) {
    const [existing] = await db
      .select({ id: schema.books.id, authorWatchId: schema.books.authorWatchId })
      .from(schema.books)
      .where(eq(schema.books.hardcoverId, detail.hardcoverId))
      .limit(1);

    if (existing) {
      // Already on the watchlist, whoever added it. Refresh the date only; the book's own re-check does the rest.
      await db
        .update(schema.books)
        .set({ expectedReleaseDate: detail.releaseDate, status: statusFor(detail.releaseDate), updatedAt: new Date().toISOString() })
        .where(eq(schema.books.id, existing.id));
      remembered.add(detail.hardcoverId);
      updated++;
      continue;
    }
    if (remembered.has(detail.hardcoverId)) continue;

    const date = detail.releaseDate;
    if (!date && !includeTba) continue; // not remembered, so it's picked up once it gets a date
    if (date && date < today && firstCheck && !includeReleased) {
      remembered.add(detail.hardcoverId);
      continue;
    }

    await upsertBook(detail, watch.id);
    remembered.add(detail.hardcoverId);
    added++;
  }

  await db
    .update(schema.authorWatches)
    .set({ lastSyncedAt: new Date().toISOString(), knownBookIds: JSON.stringify([...remembered]) })
    .where(eq(schema.authorWatches.id, watch.id));

  return { added, updated };
}

/** Sync every author watch. Used by the dashboard's refresh action. */
export async function syncAllAuthorWatches() {
  const watches = await db.select({ id: schema.authorWatches.id }).from(schema.authorWatches);
  let added = 0;
  for (const w of watches) {
    added += (await syncAuthorWatch(w.id)).added;
  }
  return { watches: watches.length, added };
}
