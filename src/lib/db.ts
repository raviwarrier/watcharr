import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import path from "node:path";
import fs from "node:fs";
import {
  isSecretSetting,
  decryptSecret,
  encryptSecret,
  maskSecret,
} from "@/lib/secrets";

export const DB_DIR = process.env.DB_DIR ?? path.join(process.cwd(), "data");
if (!fs.existsSync(/*turbopackIgnore: true*/ DB_DIR)) {
  fs.mkdirSync(/*turbopackIgnore: true*/ DB_DIR, { recursive: true });
}
const DB_PATH = path.join(DB_DIR, "book-release-tracker.sqlite");

// Singleton client so we don't open multiple handles in dev (HMR).
const globalForDb = globalThis as unknown as {
  db?: ReturnType<typeof drizzle>;
  sqlite?: Database.Database;
};

export const sqlite =
  globalForDb.sqlite ??
  new Database(DB_PATH);

if (process.env.NODE_ENV === "development") globalForDb.sqlite = sqlite;

export const db = drizzle(sqlite, { schema });

// Import tables. Created on startup so existing databases get them without a migration.
// (drizzle-kit push isn't run on existing databases, see install.sh / install.ps1.)
const IMPORT_TABLES = [
  `CREATE TABLE IF NOT EXISTS import_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    file_name TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    finished_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS import_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    title TEXT NOT NULL,
    author TEXT,
    isbn TEXT,
    hardcover_id INTEGER,
    status TEXT NOT NULL,
    reason TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS import_items_job_status ON import_items (job_id, status, position)`,
];
for (const statement of IMPORT_TABLES) sqlite.prepare(statement).run();

// Ownership and match columns on books. Added to existing databases on startup.
// Each column re-reads the table, and a duplicate-column error counts as done. Several
// processes can load this module at once (for example, the build's worker pool).
function addColumn(table: "books" | "author_watches", column: string, definition: string): void {
  const existing = new Set(
    (sqlite.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map((c) => c.name),
  );
  if (existing.has(column)) return;
  try {
    sqlite.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  } catch (err) {
    if (!(err instanceof Error && /duplicate column name/i.test(err.message))) throw err;
  }
}
function addBookColumn(column: string, definition: string): void {
  addColumn("books", column, definition);
}
addBookColumn("owned_ebook", "integer NOT NULL DEFAULT 0");
addBookColumn("owned_audiobook", "integer NOT NULL DEFAULT 0");
addBookColumn("audiobook_release_date", "text");
addColumn("author_watches", "known_book_ids", "text");
// Audiobookshelf and Calibre match columns.
for (const [column, type] of [["abs_item_id", "text"], ["abs_match", "text"], ["abs_checked_at", "text"], ["abs_title", "text"], ["abs_author", "text"], ["cal_book_id", "integer"], ["cal_match", "text"], ["cal_title", "text"], ["cal_author", "text"], ["cal_checked_at", "text"]] as const) {
  addBookColumn(column, type);
}

// ---------- Settings helpers ----------

/**
 * Reads a setting in plaintext. Server-side only: secret values are decrypted here
 * and must never be sent to the browser. Legacy plaintext secrets are re-encrypted
 * on first read.
 */
export async function getSetting(key: string): Promise<string | null> {
  const row = await db.select().from(schema.settings).where(eq(schema.settings.key, key)).limit(1);
  if (row.length === 0) return null;

  const stored = row[0].value;
  if (!isSecretSetting(key)) return stored;

  const decrypted = decryptSecret(stored, DB_DIR);
  if (decrypted !== null) return decrypted;

  // Legacy plaintext row: migrate it to encrypted storage.
  await setSetting(key, stored);
  return stored;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const stored = isSecretSetting(key) ? encryptSecret(value, DB_DIR) : value;
  const existing = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, key))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(schema.settings)
      .set({ value: stored, updatedAt: new Date().toISOString() })
      .where(eq(schema.settings.key, key));
  } else {
    await db.insert(schema.settings).values({ key, value: stored, updatedAt: new Date().toISOString() });
  }
}

/**
 * Synchronous read for code that can't await, such as the access checks in the proxy.
 * Secrets are decrypted; legacy plaintext values are returned as stored.
 */
export function getSettingSync(key: string): string | null {
  const row = sqlite.prepare("select value from settings where key = ?").get(key) as { value: string } | undefined;
  if (!row) return null;
  if (!isSecretSetting(key)) return row.value;
  return decryptSecret(row.value, DB_DIR) ?? row.value;
}

/**
 * Settings status for the browser. Secret values are masked; the plaintext never leaves the server.
 */
export async function getSettingsStatus(): Promise<
  { key: string; isSet: boolean; isSecret: boolean; masked: string | null }[]
> {
  const rows = await db.select().from(schema.settings);
  return Promise.all(
    rows.map(async (row) => {
      const isSecret = isSecretSetting(row.key);
      if (!isSecret) {
        return { key: row.key, isSet: row.value.length > 0, isSecret, masked: row.value };
      }
      const plain = await getSetting(row.key);
      return {
        key: row.key,
        isSet: !!plain,
        isSecret,
        masked: plain ? maskSecret(plain) : null,
      };
    }),
  );
}
