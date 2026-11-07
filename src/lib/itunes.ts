/**
 * Apple Books audiobook lookup via the public iTunes Search API. No key required.
 * Secondary source for audiobooks only: Hardcover stays primary.
 *
 * A result counts only if its title matches the book (ignoring case, accents and
 * "(Unabridged)"-style suffixes, or "Title: Series, Book N") AND the artist's surname
 * matches the author. Ebook results are ignored because the search returns translations.
 */

export interface AppleAudiobookMatch {
  title: string;
  url: string;
}

interface ItunesResult {
  collectionName?: string;
  trackName?: string;
  artistName?: string;
  collectionViewUrl?: string;
  trackViewUrl?: string;
  kind?: string;
}

function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(unabridged\)|\(abridged\)/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function surname(name: string): string {
  const parts = normalise(name).split(" ");
  return parts[parts.length - 1] ?? "";
}

function titleMatches(candidate: string, wanted: string): boolean {
  const c = normalise(candidate);
  return c === wanted || c.startsWith(`${wanted} `) || c.startsWith(`${wanted}:`);
}

export async function findAppleAudiobook(title: string, author: string): Promise<AppleAudiobookMatch | null> {
  const term = `${title} ${author}`.trim();
  if (!term) return null;

  const url = `https://itunes.apple.com/search?entity=audiobook&limit=25&country=us&term=${encodeURIComponent(term)}`;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Apple Books search returned ${res.status}`);

  const json = (await res.json()) as { results?: ItunesResult[] };
  const wanted = normalise(title);
  const wantedSurname = author.trim() ? surname(author) : "";

  const hit = (json.results ?? []).find((r) => {
    const name = r.collectionName ?? r.trackName ?? "";
    const link = r.collectionViewUrl ?? r.trackViewUrl;
    if (!name || !link || !titleMatches(name, wanted)) return false;
    if (!wantedSurname) return true;
    return surname(r.artistName ?? "") === wantedSurname;
  });

  const link = hit?.collectionViewUrl ?? hit?.trackViewUrl;
  return hit && link ? { title: hit.collectionName ?? hit.trackName ?? title, url: link } : null;
}
