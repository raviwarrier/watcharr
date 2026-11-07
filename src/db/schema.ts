import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * Watched books - the core watchlist items.
 */
/**
 * Authors whose upcoming books are all watched. Their books are added to `books`
 * with authorWatchId set, so new releases appear without picking each title.
 */
export const authorWatches = sqliteTable("author_watches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  hardcoverAuthorId: integer("hardcover_author_id").notNull().unique(),
  name: text("name").notNull(),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull().$default(() => new Date().toISOString()),
});

export const books = sqliteTable("books", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  hardcoverId: integer("hardcover_id").unique(), // external Hardcover API id
  hardcoverSlug: text("hardcover_slug"), // used for the "See details" link
  authorWatchId: integer("author_watch_id").references(() => authorWatches.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  author: text("author").notNull(),
  series: text("series"),
  seriesPosition: integer("series_position"),
  coverUrl: text("cover_url"),
  synopsis: text("synopsis"),
  genres: text("genres"), // JSON string array
  expectedReleaseDate: text("expected_release_date"), // ISO date string
  releaseDate: text("release_date"), // actual release date once out
  status: text("status").default("upcoming"), // upcoming | released | cancelled
  // Released AND listed on Hardcover in that format. Null = not checked yet.
  ebookAvailable: integer("ebook_available", { mode: "boolean" }),
  audiobookAvailable: integer("audiobook_available", { mode: "boolean" }),
  appleAudiobookUrl: text("apple_audiobook_url"), // Apple Books page when the iTunes lookup matched
  // What the user owns, marked by hand (independent of release status).
  ownedEbook: integer("owned_ebook", { mode: "boolean" }).notNull().default(false),
  ownedAudiobook: integer("owned_audiobook", { mode: "boolean" }).notNull().default(false),
  // Audiobookshelf match: item id, how it was matched (isbn | title_author | review), and when it was checked.
  absItemId: text("abs_item_id"),
  absMatch: text("abs_match"),
  absCheckedAt: text("abs_checked_at"),
  absTitle: text("abs_title"), // the title as Audiobookshelf has it, for review
  absAuthor: text("abs_author"),
  lastCheckedAt: text("last_checked_at"), // ISO timestamp
  createdAt: text("created_at").notNull().$default(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$default(() => new Date().toISOString()),
});

/**
 * Key/value settings store for secrets (Hardcover API key, webhook URLs,
 * CAPTCHA solver keys, proxy settings, etc.).
 */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().$default(() => new Date().toISOString()),
});

/**
 * History of availability / release checks per book.
 */
export const releaseChecks = sqliteTable("release_checks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  bookId: integer("book_id").notNull().references(() => books.id),
  checkedAt: text("checked_at").notNull().$default(() => new Date().toISOString()),
  epubFound: integer("epub_found", { mode: "boolean" }).default(false),
  pdfFound: integer("pdf_found", { mode: "boolean" }).default(false),
  audioFound: integer("audio_found", { mode: "boolean" }).default(false),
  source: text("source"), // which scraper/source found it
  notes: text("notes"),
});

export const insertBookSchema = createInsertSchema(books, {
  title: (schema) => schema.min(1, "Title is required"),
  author: (schema) => schema.min(1, "Author is required"),
});
export type InsertBook = z.infer<typeof insertBookSchema>;

export const selectBookSchema = createSelectSchema(books);
export type Book = z.infer<typeof selectBookSchema>;

export const updateBookSchema = insertBookSchema.partial().omit({ id: true });
export type UpdateBook = z.infer<typeof updateBookSchema>;

export const insertReleaseCheckSchema = createInsertSchema(releaseChecks);
export type InsertReleaseCheck = z.infer<typeof insertReleaseCheckSchema>;

export const selectReleaseCheckSchema = createSelectSchema(releaseChecks);
export type ReleaseCheck = z.infer<typeof selectReleaseCheckSchema>;

export const settingsSchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
});
export type Setting = z.infer<typeof settingsSchema>;

// Validation for book release date (used in forms)
export const bookDateSchema = z.object({
  expectedReleaseDate: z.string().optional().refine(
    (val) => !val || !isNaN(Date.parse(val)),
    "Invalid release date",
  ),
});
