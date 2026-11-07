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
