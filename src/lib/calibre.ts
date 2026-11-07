import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { db, DB_DIR, setSetting, sqlite } from "@/lib/db";
import * as schema from "@/db/schema";
import { firstAuthor, normalise, titleBase } from "@/lib/match";

/**
 * Calibre library reconciliation (Calibre 9.x metadata.db, SQLite).
 * The metadata.db is uploaded once as a copy and read read-only. Calibre's own library is never
 * written to. A book counts as an owned ebook when Calibre has an ebook format for it.
 */

export const EBOOK_FORMATS = new Set(["EPUB", "PDF", "MOBI", "AZW", "AZW3", "KEPUB", "FB2", "DJVU", "TXT", "RTF", "DOCX", "LRF"]);

export const CALIBRE_DIR = path.join(DB_DIR, "calibre");
export const CALIBRE_COPY = path.join(CALIBRE_DIR, "metadata.db");
export const MAX_CALIBRE_BYTES = 300 * 1024 * 1024;

export function hasCalibreCopy(): boolean {
  return fs.existsSync(CALIBRE_COPY);
}

/** Checks a file is a Calibre library (has the books table), without changing it. */
export function looksLikeCalibre(file: string): boolean {
  let cdb: Database.Database | null = null;
  try {
    cdb = new Database(file, { readonly: true, fileMustExist: true });
    const row = cdb.prepare("select name from sqlite_master where type = 'table' and name = 'books'").get();
    const cols = cdb.prepare("pragma table_info(books)").all() as { name: string }[];
    return !!row && cols.some((c) => c.name === "author_sort");
  } catch {
    return false;
  } finally {
    cdb?.close();
  }
}

/** Surname of Calibre's author_sort ("Grisham, John" or "Natterson-Horowitz, Barbara & Bowers, Kathryn"). */
export function calibreSurname(authorSort: string): string {
  const first = (authorSort.split(/&|;/)[0] ?? "").trim();
  const family = first.includes(",") ? first.split(",")[0] : first;
  const parts = normalise(family).split(" ");
  return parts[parts.length - 1] ?? "";
}

interface CalibreEntry {
  calibreId: number;
  title: string;
  authorSort: string;
  surname: string;
}

type CalibreIndex = { byTitle: Map<string, CalibreEntry[]>; key: string };
const state = globalThis as unknown as { calibreIndex?: CalibreIndex };

export function clearCalibreIndex(): void {
  state.calibreIndex = undefined;
}

/** Ebook books in the copy, indexed by normalized title. The file is read fresh when it changes. */
function loadIndex(): CalibreIndex {
  const stat = fs.statSync(CALIBRE_COPY);
  const key = `${stat.mtimeMs}:${stat.size}`;
  if (state.calibreIndex && state.calibreIndex.key === key) return state.calibreIndex;

  const cdb = new Database(CALIBRE_COPY, { readonly: true, fileMustExist: true });
  try {
    const formats = cdb
      .prepare("select book, group_concat(format) as formats from data group by book")
      .all() as { book: number; formats: string }[];
    const ebookBooks = new Set(
      formats
        .filter((f) => f.formats.split(",").some((x) => EBOOK_FORMATS.has(x.trim().toUpperCase())))
        .map((f) => f.book),
    );
    const rows = cdb.prepare("select id, title, author_sort from books").all() as { id: number; title: string; author_sort: string | null }[];
    const byTitle = new Map<string, CalibreEntry[]>();
    for (const row of rows) {
      if (!ebookBooks.has(row.id) || !row.title) continue;
      const authorSort = row.author_sort ?? "";
      const entry: CalibreEntry = { calibreId: row.id, title: row.title, authorSort, surname: calibreSurname(authorSort) };
      const k = titleBase(row.title);
      byTitle.set(k, [...(byTitle.get(k) ?? []), entry]);
    }
    const index: CalibreIndex = { byTitle, key };
    state.calibreIndex = index;
    return index;
  } finally {
    cdb.close();
  }
}

export type CalibreMatch = "title_author" | "review" | null;

export function matchCalibre(index: CalibreIndex, title: string, author: string): { entry: CalibreEntry | null; kind: CalibreMatch } {
  const candidates = index.byTitle.get(titleBase(title)) ?? [];
  if (candidates.length === 0) return { entry: null, kind: null };
  const wanted = calibreSurname(firstAuthor(author));
  if (wanted) {
    const exact = candidates.find((c) => c.surname === wanted);
    if (exact) return { entry: exact, kind: "title_author" };
  }
  if (candidates.length === 1) return { entry: candidates[0], kind: "review" };
  return { entry: null, kind: null };
}

export type CalibreOutcome = "matched" | "review" | "unmatched" | "not-configured";

/** Matches one watchlist book against the Calibre copy and updates it. */
export async function reconcileCalibreBook(bookId: number): Promise<CalibreOutcome> {
  if (!hasCalibreCopy()) return "not-configured";
  const [book] = await db.select().from(schema.books).where(eq(schema.books.id, bookId));
  if (!book) return "unmatched";

  const index = loadIndex();
  const { entry, kind } = matchCalibre(index, book.title, book.author);
  const now = new Date().toISOString();

  if (entry && kind === "title_author") {
    await db
      .update(schema.books)
      .set({ calibreBookId: entry.calibreId, calibreMatch: "title_author", calibreTitle: entry.title, calibreAuthor: entry.authorSort, calibreCheckedAt: now, ownedEbook: true, updatedAt: now })
      .where(eq(schema.books.id, bookId));
    return "matched";
  }
  if (entry && kind === "review") {
    if (book.calibreMatch === "rejected" && book.calibreBookId === entry.calibreId) {
      await db.update(schema.books).set({ calibreCheckedAt: now, updatedAt: now }).where(eq(schema.books.id, bookId));
      return "unmatched";
    }
    await db
      .update(schema.books)
      .set({ calibreBookId: entry.calibreId, calibreMatch: "review", calibreTitle: entry.title, calibreAuthor: entry.authorSort, calibreCheckedAt: now, updatedAt: now })
      .where(eq(schema.books.id, bookId));
    return "review";
  }
  if (book.calibreMatch === "rejected") {
    await db.update(schema.books).set({ calibreCheckedAt: now, updatedAt: now }).where(eq(schema.books.id, bookId));
  } else {
    await db
      .update(schema.books)
      .set({ calibreBookId: null, calibreMatch: null, calibreTitle: null, calibreAuthor: null, calibreCheckedAt: now, updatedAt: now })
      .where(eq(schema.books.id, bookId));
  }
  return "unmatched";
}

export interface CalibreSummary {
  checked: number;
  matched: number;
  review: number;
  unmatched: number;
}

export async function reconcileCalibreAll(): Promise<CalibreSummary> {
  const ids = (sqlite.prepare("select id from books").all() as { id: number }[]).map((r) => r.id);
  const summary: CalibreSummary = { checked: 0, matched: 0, review: 0, unmatched: 0 };
  for (const id of ids) {
    const result = await reconcileCalibreBook(id);
    summary.checked++;
    if (result === "matched") summary.matched++;
    else if (result === "review") summary.review++;
    else summary.unmatched++;
  }
  await setSetting("calibreLastRun", new Date().toISOString());
  return summary;
}

export interface CalibreReviewItem {
  bookId: number;
  title: string;
  author: string;
  calibreTitle: string | null;
  calibreAuthor: string | null;
}

export function listCalibreReview(offset: number, limit: number, search: string): { total: number; items: CalibreReviewItem[] } {
  const term = `%${search.trim().toLowerCase()}%`;
  const where = "cal_match = 'review' and (lower(title) like ? or lower(author) like ? or lower(coalesce(cal_title,'')) like ?)";
  const total = (sqlite.prepare(`select count(*) as n from books where ${where}`).get(term, term, term) as { n: number }).n;
  const rows = sqlite
    .prepare(`select id, title, author, cal_title, cal_author from books where ${where} order by title limit ? offset ?`)
    .all(term, term, term, limit, offset) as { id: number; title: string; author: string; cal_title: string | null; cal_author: string | null }[];
  return {
    total,
    items: rows.map((r) => ({ bookId: r.id, title: r.title, author: r.author, calibreTitle: r.cal_title, calibreAuthor: r.cal_author })),
  };
}

export function decideCalibreReview(bookIds: number[], decision: "confirm" | "reject"): number {
  const now = new Date().toISOString();
  let changed = 0;
  for (const id of bookIds) {
    if (decision === "confirm") {
      changed += sqlite
        .prepare("update books set cal_match = 'title_author', owned_ebook = 1, updated_at = ? where id = ? and cal_match = 'review'")
        .run(now, id).changes;
    } else {
      changed += sqlite
        .prepare("update books set cal_match = 'rejected', updated_at = ? where id = ? and cal_match = 'review'")
        .run(now, id).changes;
    }
  }
  return changed;
}

/** Saves an uploaded copy of metadata.db after checking it's a Calibre library. */
export function saveCalibreCopy(tmpFile: string): void {
  fs.mkdirSync(CALIBRE_DIR, { recursive: true });
  fs.copyFileSync(tmpFile, CALIBRE_COPY);
  clearCalibreIndex();
}

export function removeCalibreCopy(): void {
  if (hasCalibreCopy()) fs.rmSync(CALIBRE_COPY, { force: true });
  clearCalibreIndex();
}
