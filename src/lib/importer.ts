import { sqlite } from "@/lib/db";
import { HardcoverError, HardcoverNotConfiguredError, searchCandidates, type BookCandidate } from "@/lib/hardcover";
import { watchBook } from "@/lib/watch";
import { sendGotify } from "@/lib/gotify";
import { readCsvObjects, writeCsv } from "@/lib/csv";
import { firstAuthor, surname, titleBase } from "@/lib/match";
import { absSettings, reconcileBook } from "@/lib/reconcile";
import { getSettingSync } from "@/lib/db";

/**
 * Library import: a queue of books (from a Goodreads or Hardcover CSV, or your Hardcover
 * "want to read" list) that a background worker adds to the watchlist one at a time.
 * Pacing and pauses keep the VPS and the Hardcover API calm.
 */

export const IMPORT_TICK_MS = 3000; // one book at most every 3 seconds, plus the time it takes to look it up
const RATE_LIMIT_PAUSE_MS = 60_000;
const TOKEN_MISSING_PAUSE_MS = 10 * 60_000;
export const MAX_CSV_BYTES = 5 * 1024 * 1024;

export type ItemStatus = "pending" | "done" | "skipped" | "failed";
export type JobStatus = "awaiting" | "running" | "done" | "cancelled";
/** Which CSV columns hold the title, author and ISBN, and which column holds the tag (e.g. read, want to read, wishlist). */
export type Mapping = { title: string; author?: string; isbn?: string; tag?: string; tagValues?: string[] };

const state = globalThis as unknown as {
  importBusy?: boolean;
  importPausedUntil?: number;
};

/* ------------------------------------------------------------ text helpers */

/** Goodreads wraps ISBNs as ="9780..." so Excel doesn't lose leading zeros. */
export function cleanIsbn(raw: string): string {
  return raw.replace(/^="?/, "").replace(/"$/, "").replace(/[^0-9Xx]/g, "");
}

/* ------------------------------------------------------------ column detection */

export function detectMapping(headers: string[]): Mapping | null {
  const has = (name: string) => headers.find((h) => h.toLowerCase() === name.toLowerCase());
  // Goodreads: "Title", "Author", "ISBN13", "Exclusive Shelf"
  const title = has("Title");
  const author = has("Author");
  const shelf = has("Exclusive Shelf");
  if (title && author && shelf) {
    return { title, author, isbn: has("ISBN13") ?? has("ISBN"), tag: shelf, tagValues: ["wishlist"] };
  }
  return null;
}

export interface PreparedRow {
  title: string;
  author: string;
  isbn: string;
}

/** Applies a mapping to CSV rows and keeps only rows whose tag is one of the chosen values. */
export function rowsFromCsv(text: string, mapping: Mapping): { rows: PreparedRow[]; totalRows: number; noTitle: number } {
  const { rows } = readCsvObjects(text);
  let noTitle = 0;
  const kept: PreparedRow[] = [];
  for (const row of rows) {
    if (mapping.tag && mapping.tagValues && mapping.tagValues.length > 0) {
      const value = (row[mapping.tag] ?? "").trim().toLowerCase();
      if (!mapping.tagValues.some((v) => v.trim().toLowerCase() === value)) continue;
    }
    const title = (row[mapping.title] ?? "").trim();
    if (!title) {
      noTitle++;
      continue;
    }
    kept.push({
      title,
      author: mapping.author ? (row[mapping.author] ?? "").trim() : "",
      isbn: mapping.isbn ? cleanIsbn(row[mapping.isbn] ?? "") : "",
    });
  }
  return { rows: kept, totalRows: rows.length, noTitle };
}

/** Distinct values in the tag column, with how many rows have each, most common first. */
export function tagValueCounts(text: string, column: string): { value: string; count: number }[] {
  const { rows } = readCsvObjects(text);
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = (row[column] ?? "").trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
}

/* ------------------------------------------------------------ jobs */

export function createJob(source: string, fileName: string | null, items: { title: string; author?: string; isbn?: string; hardcoverId?: number }[]): number {
  const now = new Date().toISOString();
  const info = sqlite
    .prepare("insert into import_jobs (source, file_name, status, created_at) values (?, ?, 'awaiting', ?)")
    .run(source, fileName, now);
  const jobId = Number(info.lastInsertRowid);
  const insert = sqlite.prepare(
    "insert into import_items (job_id, position, title, author, isbn, hardcover_id, status) values (?, ?, ?, ?, ?, ?, 'pending')",
  );
  items.forEach((item, position) => {
    insert.run(jobId, position, item.title, item.author ?? "", item.isbn ?? "", item.hardcoverId ?? null);
  });
  return jobId;
}

/** Removes previews that were never started, so a new upload replaces them. */
export function discardAwaitingJobs(): void {
  sqlite.prepare("delete from import_items where job_id in (select id from import_jobs where status = 'awaiting')").run();
  sqlite.prepare("delete from import_jobs where status = 'awaiting'").run();
}

export function startJob(jobId: number): boolean {
  const info = sqlite.prepare("update import_jobs set status = 'running' where id = ? and status = 'awaiting'").run(jobId);
  return info.changes > 0;
}

export function cancelJob(jobId: number): boolean {
  const info = sqlite
    .prepare("update import_jobs set status = 'cancelled', finished_at = ? where id = ? and status in ('awaiting', 'running')")
    .run(new Date().toISOString(), jobId);
  return info.changes > 0;
}

export interface JobSummary {
  id: number;
  source: string;
  fileName: string | null;
  status: JobStatus;
  createdAt: string;
  finishedAt: string | null;
  total: number;
  done: number;
  skipped: number;
  failed: number;
  pending: number;
}

export function listJobs(limit = 20): JobSummary[] {
  const jobs = sqlite
    .prepare("select id, source, file_name, status, created_at, finished_at from import_jobs order by id desc limit ?")
    .all(limit) as { id: number; source: string; file_name: string | null; status: JobStatus; created_at: string; finished_at: string | null }[];
  return jobs.map((j) => {
    const counts = sqlite
      .prepare("select status, count(*) as n from import_items where job_id = ? group by status")
      .all(j.id) as { status: ItemStatus; n: number }[];
    const by = Object.fromEntries(counts.map((c) => [c.status, c.n]));
    const total = counts.reduce((sum, c) => sum + c.n, 0);
    return {
      id: j.id,
      source: j.source,
      fileName: j.file_name,
      status: j.status,
      createdAt: j.created_at,
      finishedAt: j.finished_at,
      total,
      done: by.done ?? 0,
      skipped: by.skipped ?? 0,
      failed: by.failed ?? 0,
      pending: by.pending ?? 0,
    };
  });
}

export function getJob(jobId: number): JobSummary | null {
  return listJobs(1000).find((j) => j.id === jobId) ?? null;
}

/** CSV of books that couldn't be imported, for the user to search for by hand. */
export function failuresCsv(jobId: number): string {
  const rows = sqlite
    .prepare("select title, author, isbn, reason from import_items where job_id = ? and status = 'failed' order by position")
    .all(jobId) as { title: string; author: string; isbn: string; reason: string | null }[];
  return writeCsv(
    ["Title", "Author", "ISBN", "Reason"],
    rows.map((r) => [r.title, r.author ?? "", r.isbn ?? "", r.reason ?? ""]),
  );
}

/* ------------------------------------------------------------ matching */

function matchesCandidate(item: { title: string; author: string }, candidate: BookCandidate): boolean {
  if (titleBase(candidate.title) !== titleBase(item.title)) return false;
  if (!item.author) return true;
  const wanted = surname(firstAuthor(item.author));
  return candidate.authors.some((a) => surname(a) === wanted);
}

/** Books already on the watchlist, by Hardcover id and by title and author. */
function alreadyWatched(hardcoverId: number | null, title: string, author: string): boolean {
  if (hardcoverId) {
    const row = sqlite.prepare("select 1 from books where hardcover_id = ?").get(hardcoverId);
    if (row) return true;
  }
  const wantedTitle = titleBase(title);
  const wantedSurname = surname(firstAuthor(author));
  const rows = sqlite.prepare("select title, author from books").all() as { title: string; author: string }[];
  return rows.some((r) => titleBase(r.title) === wantedTitle && (!wantedSurname || surname(firstAuthor(r.author)) === wantedSurname));
}

/* ------------------------------------------------------------ worker */

type ItemRow = { id: number; job_id: number; title: string; author: string; isbn: string; hardcover_id: number | null };

function setItem(id: number, status: ItemStatus, reason: string | null, hardcoverId?: number) {
  if (hardcoverId !== undefined) {
    sqlite.prepare("update import_items set status = ?, reason = ?, hardcover_id = ? where id = ?").run(status, reason, hardcoverId, id);
  } else {
    sqlite.prepare("update import_items set status = ?, reason = ? where id = ?").run(status, reason, id);
  }
}

async function processItem(item: ItemRow): Promise<void> {
  // Already on the watchlist: skip without searching.
  if (alreadyWatched(item.hardcover_id, item.title, item.author)) {
    setItem(item.id, "skipped", "Already on your watchlist");
    return;
  }

  let hardcoverId = item.hardcover_id;
  if (!hardcoverId) {
    const { books } = await searchCandidates({ title: item.title, author: firstAuthor(item.author) }, 10);
    const match = books.find((b) => matchesCandidate(item, b));
    if (!match) {
      setItem(item.id, "failed", "No confident match on Hardcover");
      return;
    }
    hardcoverId = match.hardcoverId;
    if (alreadyWatched(hardcoverId, item.title, item.author)) {
      setItem(item.id, "skipped", "Already on your watchlist", hardcoverId);
      return;
    }
  }

  const result = await watchBook(hardcoverId);
  if (!result) {
    setItem(item.id, "failed", "Not found on Hardcover", hardcoverId);
  } else if ("conflict" in result || "missing" in result) {
    setItem(item.id, "skipped", "Already on your watchlist", hardcoverId);
  } else {
    setItem(item.id, "done", null, hardcoverId);
    // Mark it as owned in Audiobookshelf too, if the toggle is on and Audiobookshelf is set up.
    // A failure here does not affect the import.
    if (getSettingSync("reconcileAudiobooks") !== "false" && absSettings()) {
      await reconcileBook(result.book.id).catch(() => undefined);
    }
  }
}

/** Marks running jobs with nothing left as done and sends the Gotify summary. */
async function finishFinishedJobs(): Promise<void> {
  const jobs = sqlite
    .prepare(
      "select j.id, j.source from import_jobs j where j.status = 'running' and not exists (select 1 from import_items i where i.job_id = j.id and i.status = 'pending')",
    )
    .all() as { id: number; source: string }[];
  for (const job of jobs) {
    sqlite.prepare("update import_jobs set status = 'done', finished_at = ? where id = ?").run(new Date().toISOString(), job.id);
    const summary = getJob(job.id);
    if (!summary) continue;
    try {
      await sendGotify({
        title: "Library import finished",
        message:
          `${summary.source}: ${summary.done} added, ${summary.skipped} already on your watchlist, ` +
          `${summary.failed} not found.` +
          (summary.failed > 0 ? " Download the list of books not found from Settings > Import." : ""),
        priority: 3,
      });
    } catch {
      // A failed notification shouldn't stop the import.
    }
  }
}

/** One step of the worker. Called on a timer by the scheduler. */
export async function importTick(): Promise<void> {
  if (state.importBusy) return;
  if (state.importPausedUntil && Date.now() < state.importPausedUntil) return;

  state.importBusy = true;
  try {
    const next = sqlite
      .prepare(
        "select i.id, i.job_id, i.title, i.author, i.isbn, i.hardcover_id from import_items i join import_jobs j on j.id = i.job_id where j.status = 'running' and i.status = 'pending' order by i.job_id, i.position limit 1",
      )
      .get() as ItemRow | undefined;

    if (!next) {
      await finishFinishedJobs();
      return;
    }

    try {
      await processItem(next);
    } catch (err) {
      if (err instanceof HardcoverNotConfiguredError) {
        // Wait for the token to be added; the item stays pending.
        state.importPausedUntil = Date.now() + TOKEN_MISSING_PAUSE_MS;
      } else if (err instanceof HardcoverError && /\b429\b|rate/i.test(err.message)) {
        // Rate limited: pause and try the same book again later.
        state.importPausedUntil = Date.now() + RATE_LIMIT_PAUSE_MS;
      } else {
        setItem(next.id, "failed", err instanceof Error ? err.message : "Unknown error");
      }
    }
  } finally {
    state.importBusy = false;
  }
}
