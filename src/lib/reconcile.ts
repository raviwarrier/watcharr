import { eq } from "drizzle-orm";
import { db, getSettingSync, setSetting, sqlite } from "@/lib/db";
import * as schema from "@/db/schema";
import { fetchLibraryItems, type AbsItem } from "@/lib/audiobookshelf";
import { firstAuthor, surname, titleBase } from "@/lib/match";

/**
 * Library reconciliation: marks books you already have in Audiobookshelf as owned.
 * The library is fetched once and cached for a few minutes, so matching many books costs
 * a handful of requests, not one per book.
 *  - Title and author match: stored as a match, and the audiobook is marked as owned.
 *  - Title-only match: stored for review. Ownership changes only when you confirm it.
 *  - A match you reject is remembered, so it isn't suggested again.
 * Ownership is only ever set on, never cleared.
 */

export interface AbsSettings {
  url: string;
  mode: "apiKey" | "login";
  secret: string;
  libraryId: string;
}

const CACHE_MS = 5 * 60_000;
type Index = { at: number; key: string; items: AbsItem[]; byTitle: Map<string, AbsItem[]> };
const state = globalThis as unknown as { absIndex?: Index };

/** The saved Audiobookshelf connection, or null if it isn't set up. Read on the server only. */
export function absSettings(): AbsSettings | null {
  const url = getSettingSync("absUrl");
  const secret = getSettingSync("absSecret");
  const libraryId = getSettingSync("absLibraryId");
  if (!url || !secret || !libraryId) return null;
  return {
    url,
    mode: getSettingSync("absAuthMode") === "login" ? "login" : "apiKey",
    secret,
    libraryId,
  };
}

export function clearAbsIndex(): void {
  state.absIndex = undefined;
}

async function indexFor(cfg: AbsSettings): Promise<Index> {
  const key = `${cfg.url}|${cfg.libraryId}|${cfg.secret.slice(0, 8)}`;
  const cached = state.absIndex;
  if (cached && cached.key === key && Date.now() - cached.at < CACHE_MS) return cached;

  const items = await fetchLibraryItems(cfg.url, cfg.secret, cfg.libraryId);
  const byTitle = new Map<string, AbsItem[]>();
  for (const item of items) {
    const k = titleBase(item.title);
    byTitle.set(k, [...(byTitle.get(k) ?? []), item]);
  }
  const index: Index = { at: Date.now(), key, items, byTitle };
  state.absIndex = index;
  return index;
}

export type MatchKind = "title_author" | "review" | null;

/** Finds one book in the Audiobookshelf index. */
export function matchBook(index: { byTitle: Map<string, AbsItem[]> }, title: string, author: string): { item: AbsItem | null; kind: MatchKind } {
  const candidates = index.byTitle.get(titleBase(title)) ?? [];
  if (candidates.length === 0) return { item: null, kind: null };
  const wanted = surname(firstAuthor(author));
  if (wanted) {
    const exact = candidates.find((c) => surname(c.author) === wanted);
    if (exact) return { item: exact, kind: "title_author" };
  }
  // Same title, different or missing author: keep it for review only when it's unambiguous.
  if (candidates.length === 1) return { item: candidates[0], kind: "review" };
  return { item: null, kind: null };
}

/** Matches one watchlist book and updates it. Safe to call after an import step. */
export async function reconcileBook(bookId: number): Promise<"matched" | "review" | "unmatched" | "not-configured"> {
  const cfg = absSettings();
  if (!cfg) return "not-configured";
  const [book] = await db.select().from(schema.books).where(eq(schema.books.id, bookId));
  if (!book) return "unmatched";

  const index = await indexFor(cfg);
  const { item, kind } = matchBook(index, book.title, book.author);
  const now = new Date().toISOString();

  if (item && kind === "title_author") {
    await db
      .update(schema.books)
      .set({ absItemId: item.id, absMatch: "title_author", absTitle: item.title, absAuthor: item.author, absCheckedAt: now, ownedAudiobook: true, updatedAt: now })
      .where(eq(schema.books.id, bookId));
    return "matched";
  }
  if (item && kind === "review") {
    // You already rejected this exact pairing: don't suggest it again.
    if (book.absMatch === "rejected" && book.absItemId === item.id) {
      await db.update(schema.books).set({ absCheckedAt: now, updatedAt: now }).where(eq(schema.books.id, bookId));
      return "unmatched";
    }
    await db
      .update(schema.books)
      .set({ absItemId: item.id, absMatch: "review", absTitle: item.title, absAuthor: item.author, absCheckedAt: now, updatedAt: now })
      .where(eq(schema.books.id, bookId));
    return "review";
  }
  // No match this time. Keep a rejection, and clear anything else.
  if (book.absMatch === "rejected") {
    await db.update(schema.books).set({ absCheckedAt: now, updatedAt: now }).where(eq(schema.books.id, bookId));
  } else {
    await db
      .update(schema.books)
      .set({ absMatch: null, absItemId: null, absTitle: null, absAuthor: null, absCheckedAt: now, updatedAt: now })
      .where(eq(schema.books.id, bookId));
  }
  return "unmatched";
}

export interface ReconcileSummary {
  checked: number;
  matched: number;
  review: number;
  unmatched: number;
}

/** Matches every book on the watchlist. Used by "Reconcile now". */
export async function reconcileAll(): Promise<ReconcileSummary> {
  const ids = (sqlite.prepare("select id from books").all() as { id: number }[]).map((r) => r.id);
  const summary: ReconcileSummary = { checked: 0, matched: 0, review: 0, unmatched: 0 };
  for (const id of ids) {
    const result = await reconcileBook(id);
    summary.checked++;
    if (result === "matched") summary.matched++;
    else if (result === "review") summary.review++;
    else summary.unmatched++;
  }
  await setSetting("absLastRun", new Date().toISOString());
  return summary;
}

/* ------------------------------------------------------------ review */

export interface ReviewItem {
  bookId: number;
  title: string;
  author: string;
  absTitle: string | null;
  absAuthor: string | null;
  absItemUrl: string | null;
}

/** Books waiting for a decision, a page at a time, optionally filtered by text. */
export function listReview(offset: number, limit: number, search: string): { total: number; items: ReviewItem[] } {
  const abs = absSettings();
  const term = `%${search.trim().toLowerCase()}%`;
  const where = "abs_match = 'review' and (lower(title) like ? or lower(author) like ? or lower(coalesce(abs_title,'')) like ?)";
  const total = (sqlite.prepare(`select count(*) as n from books where ${where}`).get(term, term, term) as { n: number }).n;
  const rows = sqlite
    .prepare(`select id, title, author, abs_title, abs_author, abs_item_id from books where ${where} order by title limit ? offset ?`)
    .all(term, term, term, limit, offset) as {
    id: number;
    title: string;
    author: string;
    abs_title: string | null;
    abs_author: string | null;
    abs_item_id: string | null;
  }[];
  return {
    total,
    items: rows.map((r) => ({
      bookId: r.id,
      title: r.title,
      author: r.author,
      absTitle: r.abs_title,
      absAuthor: r.abs_author,
      absItemUrl: abs && r.abs_item_id ? `${abs.url}/item/${r.abs_item_id}` : null,
    })),
  };
}

/** Confirms or rejects review matches. Confirming marks the audiobook as owned. */
export function decideReview(bookIds: number[], decision: "confirm" | "reject"): number {
  const now = new Date().toISOString();
  let changed = 0;
  for (const id of bookIds) {
    if (decision === "confirm") {
      const info = sqlite
        .prepare("update books set abs_match = 'title_author', owned_audiobook = 1, updated_at = ? where id = ? and abs_match = 'review'")
        .run(now, id);
      changed += info.changes;
    } else {
      const info = sqlite
        .prepare("update books set abs_match = 'rejected', updated_at = ? where id = ? and abs_match = 'review'")
        .run(now, id);
      changed += info.changes;
    }
  }
  return changed;
}
