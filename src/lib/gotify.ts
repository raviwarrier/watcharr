import { getSetting } from "@/lib/db";

/**
 * Gotify push notifications (self-hosted). Needs the server URL and an application token.
 * Docs: https://gotify.net/docs/pushmsg - POST {url}/message with the X-Gotify-Key header.
 * The token is encrypted at rest and is never sent to the browser.
 */

export type GotifyResult = "sent" | "not-configured";

export function normaliseGotifyUrl(raw: string): URL {
  const url = new URL(raw.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Gotify URL must start with http:// or https://");
  }
  return url;
}

export async function sendGotify(opts: { title: string; message: string; priority?: number }): Promise<GotifyResult> {
  const [rawUrl, token] = await Promise.all([getSetting("gotifyUrl"), getSetting("gotifyToken")]);
  if (!rawUrl || !token) return "not-configured";

  const base = normaliseGotifyUrl(rawUrl);
  // Keep any path prefix the server sits behind (e.g. https://host/gotify).
  const endpoint = `${base.origin}${base.pathname.replace(/\/$/, "")}/message`;

  const body = new URLSearchParams({
    title: opts.title,
    message: opts.message,
    priority: String(opts.priority ?? 5),
  });

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "X-Gotify-Key": token },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Gotify returned ${res.status}`);
  return "sent";
}
