import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import * as schema from "@/db/schema";
import { availabilityFor, getAuthorBooks, getAuthorProfile, getBookDetail, type BookDetail } from "@/lib/hardcover";
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
  // A book the user ignored stays in the database. Ask before tracking it again, instead of re-adding it.
  if (!replaceBookId) {
    const [ignored] = await db
      .select()
      .from(schema.books)
      .where(eq(schema.books.hardcoverId, hardcoverId))
      .limit(1);
    if (ignored?.ignoredAt) return { ignored: true as const, book: ignored };
  }

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

/** Hides a book from the list. The record is kept, so adding it again can ask first. */
export async function ignoreBook(bookId: number) {
  const now = new Date().toISOString();
  const [row] = await db
    .update(schema.books)
    .set({ ignoredAt: now, updatedAt: now })
    .where(eq(schema.books.id, bookId))
    .returning();
  return row ?? null;
}

/** Puts an ignored book back on the list. */
export async function restoreBook(bookId: number) {
  const now = new Date().toISOString();
  const [row] = await db
    .update(schema.books)
    .set({ ignoredAt: null, updatedAt: now })
    .where(eq(schema.books.id, bookId))
    .returning();
  return row ?? null;
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
 * What a sync remembers about one author, stored as JSON in author_watches.known_book_ids.
 * - seen: Hardcover book ids already handled. Added, or judged to be old. A book you remove stays here.
 * - undated: books on the first check that had no release date. They wait, and are added only if a future date appears.
 * An older format (a plain array) is read as seen only.
 */
type AuthorMemory = { seen: number[]; undated: number[] };

function readMemory(raw: string | null): AuthorMemory {
  if (!raw) return { seen: [], undated: [] };
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return { seen: parsed, undated: [] };
  return { seen: parsed.seen ?? [], undated: parsed.undated ?? [] };
}

/**
 * Checks one author on Hardcover and adds what's new to the watchlist.
 *
 * Hardcover leaves the release date empty on many old books too, so "no date" alone doesn't mean "upcoming".
 * - First check (the author was just added): books with a future date are added. Books with no date, or
 *   already out, are only added if "Include books already out" is on. Books with no date wait, in case a
 *   future date appears later.
 * - Later checks: a new book with a future date is added. A new book with no date is added only if
 *   "Add books with a TBD date" is on. A new book already out is added.
 * - Books already on the watchlist get their date refreshed. Books seen before are never added again.
 */
export async function syncAuthorWatch(authorWatchId: number) {
  const [watch] = await db
    .select()
    .from(schema.authorWatches)
    .where(eq(schema.authorWatches.id, authorWatchId))
    .limit(1);
  if (!watch) return { added: 0, updated: 0 };

  // Profile link and picture. A failure here must not stop the book check.
  const profile = await getAuthorProfile(watch.hardcoverAuthorId).catch(() => null);
  if (profile) {
    await db
      .update(schema.authorWatches)
      .set({ slug: profile.slug, imageUrl: profile.imageUrl })
      .where(eq(schema.authorWatches.id, watch.id));
  }

  const books = await getAuthorBooks(watch.hardcoverAuthorId);
  const includeTba = await getAuthorFlag("authorIncludeTba");
  const includeReleased = await getAuthorFlag("authorIncludeReleased");
  const today = todayIso();
  const firstCheck = watch.knownBookIds === null;
  const memory = readMemory(watch.knownBookIds);
  const seen = new Set<number>(memory.seen);
  const undated = new Set<number>(memory.undated);
  const now = new Date().toISOString();
  let added = 0;
  let updated = 0;

  for (const detail of books) {
    const id = detail.hardcoverId;
    const date = detail.releaseDate;
    const future = !!date && date >= today;

    const [existing] = await db
      .select({ id: schema.books.id })
      .from(schema.books)
      .where(eq(schema.books.hardcoverId, id))
      .limit(1);
    if (existing) {
      // Already on the watchlist, whoever added it. Refresh the date only; the book's own re-check does the rest.
      await db
        .update(schema.books)
        .set({ expectedReleaseDate: date, status: statusFor(date), updatedAt: now })
        .where(eq(schema.books.id, existing.id));
      seen.add(id);
      undated.delete(id);
      updated++;
      continue;
    }

    if (seen.has(id)) continue;

    if (undated.has(id)) {
      // Waiting from the first check: add it once it gets a future date, and stop waiting once it's dated in the past.
      if (future) {
        await upsertBook(detail, watch.id);
        seen.add(id);
        undated.delete(id);
        added++;
      } else if (date) {
        seen.add(id);
        undated.delete(id);
      }
      continue;
    }

    if (future) {
      await upsertBook(detail, watch.id);
      seen.add(id);
      added++;
      continue;
    }

    if (!date) {
      if (firstCheck) {
        if (includeReleased) {
          await upsertBook(detail, watch.id);
          seen.add(id);
          added++;
        } else {
          undated.add(id);
        }
      } else if (includeTba) {
        await upsertBook(detail, watch.id);
        seen.add(id);
        added++;
      }
      // Otherwise it's left alone for now, so it's picked up if the setting is turned on later.
      continue;
    }

    // Already out.
    if (firstCheck && !includeReleased) {
      seen.add(id);
      continue;
    }
    await upsertBook(detail, watch.id);
    seen.add(id);
    added++;
  }

  const memoryOut: AuthorMemory = { seen: [...seen], undated: [...undated] };
  await db
    .update(schema.authorWatches)
    .set({ lastSyncedAt: now, knownBookIds: JSON.stringify(memoryOut) })
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
