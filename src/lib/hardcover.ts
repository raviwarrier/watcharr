/* eslint-disable @typescript-eslint/no-explicit-any -- API payloads are untyped JSON; fields are checked at use sites. */
import { getSetting } from "@/lib/db";

/**
 * Hardcover GraphQL client.
 *
 * Verified against the public hardcover-cli client: endpoint, `Authorization: Bearer`
 * auth, `search(query, query_type, per_page, page) { results }` with hits in
 * results.hits[].document, `books_by_pk`, `editions { reading_format { format } }`,
 * `contributions { author { name } }`.
 *
 * NOT yet verified against a live token (marked UNVERIFIED below): the `image { url }`
 * and `slug` fields, the author-filtered `books(where: ...)` query, and the search
 * document field names. Those need a test with a valid key before relying on them.
 */

const HARDCOVER_API = "https://api.hardcover.app/v1/graphql";

export interface BookCandidate {
  hardcoverId: number;
  title: string;
  authors: string[];
  releaseYear: number | null;
  coverUrl: string | null;
  slug: string | null;
}

export interface AuthorCandidate {
  hardcoverAuthorId: number;
  name: string;
  booksCount: number | null;
}

export interface BookDetail {
  hardcoverId: number;
  title: string;
  slug: string | null;
  authors: string[];
  coverUrl: string | null; // audiobook edition cover when available, else the book cover
  releaseDate: string | null; // YYYY-MM-DD
  /**
   * Earliest release date among the audiobook editions. Null when no audio edition has a date.
   * Undefined when this lookup didn't fetch editions, so the stored value is left alone.
   */
  audiobookReleaseDate?: string | null;
  /** Distinct reading_format values across the book's editions, e.g. ["audio", "digital", "physical"]. */
  formats: string[];
}

class HardcoverError extends Error {}

/** The token hasn't been saved yet. This is a setup problem, not a Hardcover outage. */
export class HardcoverNotConfiguredError extends HardcoverError {}

/** Hardcover labels audiobook editions "Listened" in reading_format. */
function isAudioFormat(format: unknown): boolean {
  return typeof format === "string" && /listen|audio/i.test(format);
}

function isEbookFormat(format: unknown): boolean {
  return typeof format === "string" && /ebook|e-book|digital/i.test(format);
}

/**
 * What the dashboard shows: a format counts as available only once the book is released
 * and Hardcover lists an edition in that format. Unreleased books are never green.
 */
export function availabilityFor(
  detail: Pick<BookDetail, "releaseDate" | "formats">,
  today = new Date().toISOString().slice(0, 10),
): { ebookAvailable: boolean; audiobookAvailable: boolean } {
  const released = !!detail.releaseDate && detail.releaseDate <= today;
  return {
    ebookAvailable: released && detail.formats.some(isEbookFormat),
    audiobookAvailable: released && detail.formats.some(isAudioFormat),
  };
}

async function hardcoverGraphQL<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = await getSetting("hardcoverApiKey");
  if (!token) throw new HardcoverNotConfiguredError("Hardcover token not set. Add it in Settings.");

  const res = await fetch(HARDCOVER_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  // Never echo the token; error bodies from the API don't contain it.
  if (res.status === 401) throw new HardcoverError("Hardcover rejected the token. Check it in Settings.");
  if (!res.ok) throw new HardcoverError(`Hardcover API error ${res.status}`);

  const json = await res.json();
  if (json.errors) {
    throw new HardcoverError(`Hardcover GraphQL error: ${json.errors.map((e: any) => e.message).join(", ")}`);
  }
  return json.data as T;
}

/** The search endpoint returns `results` either as an object or a JSON string, depending on version. */
function searchDocuments(results: unknown): any[] {
  const parsed = typeof results === "string" ? safeJson(results) : results;
  const hits = (parsed as any)?.hits ?? [];
  return hits.map((h: any) => h.document ?? h).filter(Boolean);
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function toBookCandidate(doc: any): BookCandidate | null {
  const id = Number(doc.id);
  if (!id || !doc.title) return null;
  return {
    hardcoverId: id,
    title: String(doc.title),
    authors: Array.isArray(doc.author_names) ? doc.author_names.map(String) : [],
    releaseYear: typeof doc.release_year === "number" ? doc.release_year : null,
    coverUrl: doc.image?.url ?? doc.cover_url ?? null, // UNVERIFIED field names
    slug: doc.slug ?? null, // UNVERIFIED
  };
}

/**
 * Search for books and/or authors. Pass a title, an author, or both; at least one is required.
 * Returns every candidate so the user can pick.
 */
export async function searchCandidates(
  opts: { title?: string; author?: string },
  perPage = 12,
): Promise<{ books: BookCandidate[]; authors: AuthorCandidate[] }> {
  const title = opts.title?.trim() ?? "";
  const author = opts.author?.trim() ?? "";
  const bookQuery = [title, author].filter(Boolean).join(" ");
  if (!bookQuery) return { books: [], authors: [] };

  const SEARCH = `
    query Search($query: String!, $queryType: String!, $perPage: Int!) {
      search(query: $query, query_type: $queryType, per_page: $perPage, page: 1) {
        results
      }
    }
  `;

  const [bookData, authorData] = await Promise.all([
    hardcoverGraphQL<any>(SEARCH, { query: bookQuery, queryType: "Book", perPage }),
    // Author lookup only when the user gave an author (or no title at all).
    author || !title
      ? hardcoverGraphQL<any>(SEARCH, { query: author || title, queryType: "Author", perPage: 6 })
      : Promise.resolve(null),
  ]);

  const books = searchDocuments(bookData.search.results)
    .map(toBookCandidate)
    .filter((b): b is BookCandidate => b !== null);

  const authors: AuthorCandidate[] = authorData
    ? searchDocuments(authorData.search.results)
        .map((d: any) => ({
          hardcoverAuthorId: Number(d.id),
          name: String(d.name ?? ""),
          booksCount: typeof d.books_count === "number" ? d.books_count : null,
        }))
        .filter((a: AuthorCandidate) => a.hardcoverAuthorId && a.name)
    : [];

  return { books, authors };
}

/** Full details for one book, with the audiobook edition cover preferred. */
export async function getBookDetail(hardcoverId: number): Promise<BookDetail | null> {
  // UNVERIFIED: `image { url }` on books and editions, `slug` on books, and `release_date` on editions.
  const data = await hardcoverGraphQL<any>(
    `
    query BookDetail($id: Int!) {
      books_by_pk(id: $id) {
        id
        title
        slug
        release_date
        image { url }
        contributions { author { name } }
        editions(order_by: { users_count: desc }, limit: 50) {
          reading_format { format }
          release_date
          image { url }
        }
      }
    }
    `,
    { id: hardcoverId },
  );

  const b = data.books_by_pk;
  if (!b) return null;

  const audioEdition = (b.editions ?? []).find(
    (e: any) => isAudioFormat(e?.reading_format?.format) && e?.image?.url,
  );

  const formats = [
    ...new Set(
      (b.editions ?? [])
        .map((e: any) => e?.reading_format?.format)
        .filter((f: unknown): f is string => typeof f === "string" && f.length > 0),
    ),
  ] as string[];

  // The earliest date among audio editions. Print and ebook dates don't count as an audiobook date.
  const audioDates = (b.editions ?? [])
    .filter((e: any) => isAudioFormat(e?.reading_format?.format) && typeof e?.release_date === "string")
    .map((e: any) => e.release_date as string)
    .sort();

  return {
    hardcoverId: Number(b.id),
    title: b.title,
    slug: b.slug ?? null,
    authors: (b.contributions ?? []).map((c: any) => c.author?.name).filter(Boolean),
    coverUrl: audioEdition?.image?.url ?? b.image?.url ?? null,
    releaseDate: b.release_date ?? null,
    audiobookReleaseDate: audioDates[0] ?? null,
    formats,
  };
}

/** Upcoming (not-yet-released) books by one author. UNVERIFIED filter syntax. */
export async function getAuthorUpcomingBooks(hardcoverAuthorId: number): Promise<BookDetail[]> {
  const today = new Date().toISOString().slice(0, 10);
  const data = await hardcoverGraphQL<any>(
    `
    query AuthorUpcoming($authorId: Int!, $today: date!) {
      books(
        where: { contributions: { author_id: { _eq: $authorId } }, release_date: { _gte: $today } }
        order_by: { release_date: asc }
        limit: 100
      ) {
        id
        title
        slug
        release_date
        image { url }
        contributions { author { name } }
      }
    }
    `,
    { authorId: hardcoverAuthorId, today },
  );

  return (data.books ?? []).map((b: any) => ({
    hardcoverId: Number(b.id),
    title: b.title,
    slug: b.slug ?? null,
    authors: (b.contributions ?? []).map((c: any) => c.author?.name).filter(Boolean),
    coverUrl: b.image?.url ?? null,
    releaseDate: b.release_date ?? null,
    formats: [], // not fetched here; the book's own re-check fills these in
  }));
}

export { HardcoverError };
