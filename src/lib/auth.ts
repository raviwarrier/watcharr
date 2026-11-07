import crypto from "node:crypto";

/**
 * Access control for Watcharr.
 *
 * - ACCESS_KEY_SHA256: SHA-256 of the access key the user types to sign in. Written by the
 *   install script. The key itself is shown once and never stored.
 * - CALENDAR_TOKEN_SHA256: SHA-256 of the token in the calendar feed URL (?token=...).
 *
 * The session cookie is an HMAC of ACCESS_KEY_SHA256, so it can't be forged without the hash and
 * it stops working as soon as the access key is rotated.
 *
 * If ACCESS_KEY_SHA256 is missing, nobody can sign in (fail closed) until the install script runs.
 */

export const SESSION_COOKIE = "watcharr_session";
export const SESSION_DAYS = 30;

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
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
  return process.env.ACCESS_KEY_SHA256 || null;
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

export function isValidCalendarToken(token: string | null): boolean {
  const hash = process.env.CALENDAR_TOKEN_SHA256;
  if (!hash || !token) return false;
  return safeEqual(sha256Hex(token), hash);
}

/** Only allow in-app paths after sign-in, so ?next= can't send the user to another site. */
export function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/login")) return "/dashboard";
  return raw;
}
