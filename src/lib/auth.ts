import crypto from "node:crypto";
import { getSettingSync } from "@/lib/db";

/**
 * Access control for Watcharr.
 *
 * Access key: the password for the web app. Stored as a SHA-256 hash in the encrypted settings
 *   (key "accessKeyHash"), changed from Settings > Caution zone. Install writes the hash to
 *   .env.local (ACCESS_KEY_SHA256) as a fallback, used only when the settings value is missing.
 *
 * Calendar token: the token in the calendar feed URL. Stored encrypted in settings
 *   (key "calendarToken"), so the app can show the subscription link to signed-in users.
 *   CALENDAR_TOKEN_SHA256 in .env.local is a fallback for installs made before that.
 *
 * The session cookie is an HMAC keyed by the access-key hash. Changing the access key
 * therefore signs out every other session.
 *
 * If no access-key hash exists anywhere, nobody can sign in (fail closed).
 */

export const SESSION_COOKIE = "watcharr_session";
export const SESSION_DAYS = 30;

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function randomToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** The value stored in the session cookie for a given access-key hash. */
export function sessionValueFor(keyHash: string): string {
  return crypto.createHmac("sha256", keyHash).update("watcharr-session").digest("hex");
}

export function accessKeyHash(): string | null {
  return getSettingSync("accessKeyHash") || process.env.ACCESS_KEY_SHA256 || null;
}

export function isConfigured(): boolean {
  return accessKeyHash() !== null;
}

export function isValidSession(cookieValue: string | undefined): boolean {
  const hash = accessKeyHash();
  if (!hash || !cookieValue) return false;
  return safeEqual(cookieValue, sessionValueFor(hash));
}

export function isValidAccessKey(key: string): boolean {
  const hash = accessKeyHash();
  if (!hash || !key) return false;
  return safeEqual(sha256Hex(key), hash);
}

/** The current calendar token in plain text, or null if none is stored. */
export function calendarToken(): string | null {
  return getSettingSync("calendarToken");
}

export function isValidCalendarToken(token: string | null): boolean {
  if (!token) return false;
  const stored = calendarToken();
  if (stored) return safeEqual(token, stored);
  const fallbackHash = process.env.CALENDAR_TOKEN_SHA256;
  return fallbackHash ? safeEqual(sha256Hex(token), fallbackHash) : false;
}

/** Only allow in-app paths after sign-in, so ?next= can't send the user to another site. */
export function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/login")) return "/dashboard";
  return raw;
}
