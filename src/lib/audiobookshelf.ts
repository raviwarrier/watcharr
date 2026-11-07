/**
 * Audiobookshelf client. Verified against a live 2.37 server:
 *   GET  /status            -> { app: "audiobookshelf", serverVersion, isInit, ... } (no login)
 *   POST /login             -> { user: { token, ... }, serverSettings: { version } }
 *   GET  /api/libraries     -> { libraries: [{ id, name, mediaType }] }   (Bearer token)
 *   GET  /api/libraries/:id/items?limit&page -> { results, total }        (Bearer token)
 * Only the audiobook (book-type) libraries are used.
 */

const TIMEOUT_MS = 15_000;

export class AbsError extends Error {}

export interface AbsServer {
  version: string;
}

async function absFetch(base: string, path: string, opts: { token?: string; method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    // Newer Audiobookshelf versions only return tokens in the body when asked to.
    headers["x-return-tokens"] = "true";
  }
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AbsError("Could not reach that address. Check the URL, and that the server is running.");
  }
  return res;
}

/** Confirms the address is an Audiobookshelf server. Needs no credentials. */
export async function probeAbs(base: string): Promise<AbsServer> {
  const res = await absFetch(base, "/status");
  if (!res.ok) throw new AbsError(`The address answered with ${res.status}. Is this the Audiobookshelf address?`);
  const body = await res.json().catch(() => null);
  if (!body || body.app !== "audiobookshelf") {
    throw new AbsError("The address answered, but it doesn't look like an Audiobookshelf server.");
  }
  return { version: String(body.serverVersion ?? "unknown") };
}

/** Username and password in exchange for an API token. The password isn't kept. */
export async function loginAbs(base: string, username: string, password: string): Promise<string> {
  const res = await absFetch(base, "/login", { method: "POST", body: { username, password } });
  if (res.status === 401) throw new AbsError("Audiobookshelf refused that username or password.");
  if (!res.ok) throw new AbsError(`Sign-in failed with status ${res.status}.`);
  const body = await res.json().catch(() => null);
  const token: string | undefined = body?.user?.token ?? body?.user?.accessToken;
  if (!token) throw new AbsError("Signed in, but no token came back. Try an API key instead.");
  return token;
}

/** Checks that a token works. Returns the book libraries it can see. */
export async function listBookLibraries(base: string, token: string): Promise<{ id: string; name: string }[]> {
  const res = await absFetch(base, "/api/libraries", { token });
  if (res.status === 401 || res.status === 403) {
    throw new AbsError("Audiobookshelf refused the API key or token.");
  }
  if (!res.ok) throw new AbsError(`Could not list libraries (status ${res.status}).`);
  const body = await res.json().catch(() => null);
  const libraries: { id: string; name: string; mediaType?: string }[] = Array.isArray(body?.libraries) ? body.libraries : [];
  return libraries.filter((l) => l.mediaType === "book").map((l) => ({ id: l.id, name: l.name }));
}

interface RawItem {
  id?: string | number;
  media?: { metadata?: { title?: string; authorName?: string; isbn?: string } };
}

export interface AbsItem {
  id: string;
  title: string;
  author: string;
  isbn: string;
}

/** Every item in one library. Pages through the list, 200 at a time. */
export async function fetchLibraryItems(base: string, token: string, libraryId: string): Promise<AbsItem[]> {
  const items: AbsItem[] = [];
  for (let page = 0; ; page++) {
    const res = await absFetch(base, `/api/libraries/${encodeURIComponent(libraryId)}/items?limit=200&page=${page}`, { token });
    if (!res.ok) throw new AbsError(`Could not read the library (status ${res.status}).`);
    const body = await res.json().catch(() => null);
    const results: RawItem[] = Array.isArray(body?.results) ? body.results : [];
    for (const item of results) {
      const meta = item?.media?.metadata ?? {};
      if (!item?.id || !meta.title) continue;
      items.push({
        id: String(item.id),
        title: String(meta.title),
        author: String(meta.authorName ?? ""),
        isbn: String(meta.isbn ?? "").replace(/[^0-9Xx]/g, ""),
      });
    }
    if (results.length < 200) break;
  }
  return items;
}
