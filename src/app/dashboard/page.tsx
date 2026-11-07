"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  BookOpen,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Copy,
  ExternalLink,
  FileText,
  Headphones,
  CheckCheck,
  CassetteTape,
  Ghost,
  Book,
  LayoutGrid,
  List,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  User,
  XCircle,
} from "lucide-react";

type Book = {
  id: number;
  hardcoverId: number | null;
  hardcoverSlug: string | null;
  authorWatchId: number | null;
  title: string;
  author: string;
  coverUrl: string | null;
  expectedReleaseDate: string | null;
  status: string | null;
  ebookAvailable: boolean | null;
  audiobookAvailable: boolean | null;
  appleAudiobookUrl?: string | null;
  ownedEbook?: boolean;
  ownedAudiobook?: boolean;
  lastCheckedAt: string | null;
  createdAt?: string | null;
};

type AuthorWatch = { id: number; hardcoverAuthorId: number; name: string; lastSyncedAt: string | null };

type BookCandidate = {
  hardcoverId: number;
  title: string;
  authors: string[];
  releaseYear: number | null;
  coverUrl: string | null;
  slug: string | null;
};

type AuthorCandidate = { hardcoverAuthorId: number; name: string; booksCount: number | null };

async function fetchLists(): Promise<{ books: Book[]; authors: AuthorWatch[]; hardcoverSet: boolean }> {
  const [b, a, s] = await Promise.all([
    fetch("/api/books", { cache: "no-store" }).then((r) => r.json()),
    fetch("/api/author-watches", { cache: "no-store" }).then((r) => r.json()),
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => []),
  ]);
  const hardcover = Array.isArray(s) ? s.find((row: { key: string }) => row.key === "hardcoverApiKey") : undefined;
  return {
    books: Array.isArray(b) ? b : [],
    authors: Array.isArray(a) ? a : [],
    hardcoverSet: hardcover?.isSet === true,
  };
}

type OwnedState = "none" | "ebook" | "audiobook" | "both";
// Order the acquisition button cycles through.
const OWN_ORDER: OwnedState[] = ["none", "ebook", "audiobook", "both"];
const OWN_ICON: Record<OwnedState, typeof Ghost> = { none: Ghost, ebook: Book, audiobook: CassetteTape, both: CheckCheck };
// Colour per state. Not owned uses the normal text colour.
const OWN_COLOR: Record<OwnedState, string> = {
  none: "text-muted-foreground",
  ebook: "text-yellow-500 dark:text-yellow-400",
  audiobook: "text-blue-500 dark:text-blue-400",
  both: "text-emerald-600 dark:text-emerald-400",
};
const OWN_LABEL: Record<OwnedState, string> = {
  none: "Not owned. Click to mark as an ebook you own",
  ebook: "Ebook owned. Click to mark the audiobook as owned too",
  audiobook: "Audiobook owned. Click to mark the ebook as owned too",
  both: "Ebook and audiobook owned. Click to clear",
};
function ownedState(b: Book): OwnedState {
  const e = b.ownedEbook === true;
  const a = b.ownedAudiobook === true;
  return e && a ? "both" : e ? "ebook" : a ? "audiobook" : "none";
}

type BooksView = "grid" | "list";

// Layout choice, stored in the browser. Read with useSyncExternalStore so the first paint matches.
const VIEW_KEY = "books-view";
const VIEW_EVENT = "books-view-change";
function subscribeView(callback: () => void) {
  window.addEventListener(VIEW_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(VIEW_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}
const getView = (): BooksView => (localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid");
const getServerView = (): BooksView => "grid";
function setStoredView(view: BooksView) {
  localStorage.setItem(VIEW_KEY, view);
  window.dispatchEvent(new Event(VIEW_EVENT));
}

type SortKey = "closest" | "latest" | "recent" | "oldest" | "added" | "title" | "author";

const UPCOMING_SORTS: { value: SortKey; label: string }[] = [
  { value: "closest", label: "Closest release" },
  { value: "latest", label: "Furthest release" },
  { value: "added", label: "Recently added" },
  { value: "title", label: "Title A–Z" },
  { value: "author", label: "Author A–Z" },
];

const RELEASED_SORTS: { value: SortKey; label: string }[] = [
  { value: "recent", label: "Most recently released" },
  { value: "oldest", label: "Oldest release" },
  { value: "added", label: "Recently added" },
  { value: "title", label: "Title A–Z" },
  { value: "author", label: "Author A–Z" },
];

/** Dates sort as strings (YYYY-MM-DD); missing dates always go last. */
function compareBooks(sort: SortKey, a: Book, b: Book): number {
  const byDate = (x: Book, y: Book, descending: boolean) => {
    if (!x.expectedReleaseDate && !y.expectedReleaseDate) return 0;
    if (!x.expectedReleaseDate) return 1;
    if (!y.expectedReleaseDate) return -1;
    const diff = x.expectedReleaseDate.localeCompare(y.expectedReleaseDate);
    return descending ? -diff : diff;
  };
  const byTitle = () => a.title.localeCompare(b.title);
  switch (sort) {
    case "closest":
    case "oldest":
      return byDate(a, b, false);
    case "latest":
    case "recent":
      return byDate(a, b, true);
    case "added":
      return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
    case "author":
      return a.author.localeCompare(b.author) || byTitle();
    case "title":
      return byTitle();
  }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Parse as local time so "2026-03-04" doesn't shift a day in some timezones. */
function parseDate(value: string): Date {
  return DATE_ONLY.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
}

function formatDate(value: string): string {
  return parseDate(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function daysUntil(value: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((parseDate(value).getTime() - today.getTime()) / 86_400_000);
}

type Tone = "released" | "soon" | "upcoming" | "muted";

/**
 * The card tag answers "can I get this as an audiobook yet?" and "when?".
 * "Released" in this app means an audiobook is available.
 */
function releaseTag(
  date: string | null,
  audiobookAvailable: boolean | null,
  linked: boolean,
): { label: string; detail: string | null; tone: Tone } {
  if (!linked) return { label: "Not linked to Hardcover", detail: "Release date unknown", tone: "muted" };
  if (audiobookAvailable === true) {
    return {
      label: date ? `Audiobook out · ${formatDate(date)}` : "Audiobook out",
      detail: null,
      tone: "released",
    };
  }
  if (!date) return { label: "Expected · date unknown", detail: null, tone: "muted" };
  const days = daysUntil(date);
  if (days > 0) {
    return {
      label: `Expected · ${formatDate(date)}`,
      detail: days === 1 ? "Tomorrow" : `In ${days} days`,
      tone: days <= 30 ? "soon" : "upcoming",
    };
  }
  // Out already, but no audiobook found yet.
  return { label: `Out ${formatDate(date)}`, detail: "No audiobook found yet", tone: "muted" };
}

const TONE_CLASSES: Record<Tone, string> = {
  released: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  soon: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  upcoming: "bg-secondary text-secondary-foreground",
  muted: "bg-muted text-muted-foreground",
};

/**
 * A format pill. Clicking it opens Copy link and Open link, stacked. The menu is drawn in a layer
 * above the page, so card borders can't clip it. A pill with no link says so instead.
 */
function FormatChip({
  label,
  icon: Icon,
  found,
  url,
}: {
  label: string;
  icon: typeof FileText;
  found: boolean | null;
  url: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    const close = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  function toggle() {
    if (!open && buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect();
      // Keep the menu on screen.
      const left = Math.max(8, Math.min(r.left, window.innerWidth - 184));
      setPos({ top: r.bottom + 6, left });
    }
    setOpen((o) => !o);
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the link is also available through Open link.
    }
  }

  const styles =
    found === true
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-transparent"
      : found === false
        ? "text-muted-foreground border-border"
        : "text-muted-foreground border-dashed border-border";
  const StateIcon = found === true ? CheckCircle2 : found === false ? XCircle : CircleDashed;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors hover:opacity-80",
          styles,
        )}
      >
        <StateIcon className="h-3 w-3" />
        <Icon className="h-3 w-3" />
        {label}
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ top: pos.top, left: pos.left }}
            className="fixed z-[60] flex w-44 flex-col gap-1.5 rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-lg"
          >
            {url ? (
              <>
                <Button size="sm" variant="outline" className="h-8 justify-start gap-2 text-xs" onClick={copy}>
                  <Copy className="h-3.5 w-3.5" />
                  {copied ? "Copied" : "Copy link"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 justify-start gap-2 text-xs"
                  onClick={() => {
                    window.open(url, "_blank", "noopener,noreferrer");
                    setOpen(false);
                  }}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open link
                </Button>
              </>
            ) : (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">No link yet. Re-check the book to find one.</p>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

function Cover({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
  return (
    <div className={cn("relative shrink-0 overflow-hidden rounded-md bg-muted", className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          <BookOpen className="h-5 w-5" />
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const [books, setBooks] = useState<Book[]>([]);
  const [authorWatches, setAuthorWatches] = useState<AuthorWatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [hardcoverSet, setHardcoverSet] = useState(true);
  const [checking, setChecking] = useState<Set<number>>(new Set());
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  /** Set when the user is linking an unlinked (hand-added) book to a Hardcover result. */
  const [matching, setMatching] = useState<Book | null>(null);

  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<{ books: BookCandidate[]; authors: AuthorCandidate[] } | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const data = await fetchLists();
      setBooks(data.books);
      setAuthorWatches(data.authors);
      setHardcoverSet(data.hardcoverSet);
    } catch {
      setError("Could not load your watchlist.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetchLists()
      .then((data) => {
        if (!active) return;
        setBooks(data.books);
        setAuthorWatches(data.authors);
        setHardcoverSet(data.hardcoverSet);
      })
      .catch(() => active && setError("Could not load your watchlist."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  async function readError(res: Response): Promise<string> {
    const body = await res.json().catch(() => null);
    if (body?.error) return body.error;
    if (res.status >= 500) {
      return `The server couldn't complete the request (error ${res.status}). Check that Watcharr is running and reachable.`;
    }
    return `Request failed (${res.status}).`;
  }

  async function search(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await runSearch(title, author);
  }

  async function runSearch(rawTitle: string, rawAuthor: string) {
    if (!rawTitle.trim() && !rawAuthor.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const params = new URLSearchParams({ title: rawTitle.trim(), author: rawAuthor.trim() });
      const res = await fetch(`/api/search?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res));
      setResults(await res.json());
    } catch (err) {
      setResults(null);
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  async function watch(key: string, body: object) {
    setPending((p) => new Set([...p, key]));
    setError(null);
    try {
      const res = await fetch("/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await readError(res));
      setMatching(null);
      setResults(null);
      setTitle("");
      setAuthor("");
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add to watchlist");
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(key);
        return next;
      });
    }
  }

  async function recheck(id: number) {
    setChecking((p) => new Set([...p, id]));
    setNotice(null);
    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId: id }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.book) throw new Error(body?.error ?? `Re-check failed (${res.status})`);
      const updated: Book = body.book;
      setBooks((prev) => prev.map((b) => (b.id === id ? updated : b)));
      if (Array.isArray(body.warnings) && body.warnings.length > 0) {
        setNotice({ tone: "warn", text: `${updated.title}: ${body.warnings.join(" ")}` });
      } else {
        setNotice({ tone: "ok", text: `${updated.title} is up to date.` });
      }
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "Re-check failed" });
    } finally {
      setChecking((p) => {
        const next = new Set(p);
        next.delete(id);
        return next;
      });
    }
  }

  /** Cycles the acquisition marker: none -> ebook -> audiobook -> both -> none. */
  async function cycleOwned(book: Book) {
    const current = ownedState(book);
    const next = OWN_ORDER[(OWN_ORDER.indexOf(current) + 1) % OWN_ORDER.length];
    const ownedEbook = next === "ebook" || next === "both";
    const ownedAudiobook = next === "audiobook" || next === "both";
    setBooks((prev) => prev.map((b) => (b.id === book.id ? { ...b, ownedEbook, ownedAudiobook } : b)));
    try {
      const res = await fetch(`/api/books/${book.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownedEbook, ownedAudiobook }),
      });
      if (!res.ok) throw new Error(await readError(res));
    } catch (err) {
      setNotice({ tone: "error", text: `Could not update "${book.title}". ${err instanceof Error ? err.message : ""}` });
      loadAll();
    }
  }

  async function removeBook(book: Book) {
    setNotice(null);
    try {
      const res = await fetch(`/api/books/${book.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await readError(res));
      setBooks((prev) => prev.filter((b) => b.id !== book.id));
      setMatching((m) => (m?.id === book.id ? null : m));
      setNotice({ tone: "ok", text: `Removed "${book.title}".` });
    } catch (err) {
      setNotice({ tone: "error", text: `Could not remove "${book.title}". ${err instanceof Error ? err.message : ""}` });
    }
  }

  function startMatch(book: Book) {
    setMatching(book);
    // Title-only: hand-entered author names often don't match Hardcover's spelling.
    setTitle(book.title);
    setAuthor("");
    setResults(null);
    setNotice(null);
    setError(null);
    document.getElementById("find")?.scrollIntoView({ behavior: "smooth", block: "start" });
    runSearch(book.title, "");
  }

  async function removeAuthor(w: AuthorWatch) {
    await fetch(`/api/author-watches/${w.id}`, { method: "DELETE" });
    await loadAll();
  }

  async function syncAuthors() {
    setPending((p) => new Set([...p, "sync"]));
    setError(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      if (!res.ok) throw new Error(await readError(res));
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete("sync");
        return next;
      });
    }
  }

  const watchedHardcoverIds = useMemo(
    () => new Set(books.map((b) => b.hardcoverId).filter((id): id is number => id !== null)),
    [books],
  );
  const watchedAuthorIds = useMemo(
    () => new Set(authorWatches.map((a) => a.hardcoverAuthorId)),
    [authorWatches],
  );

  const [pendingDelete, setPendingDelete] = useState<Book | null>(null);
  const [pendingAuthor, setPendingAuthor] = useState<AuthorWatch | null>(null);
  const [deleting, setDeleting] = useState(false);
  const view = useSyncExternalStore(subscribeView, getView, getServerView);
  const [filter, setFilter] = useState<"all" | "upcoming" | "released">("all");
  const [query, setQuery] = useState("");
  const [upcomingSort, setUpcomingSort] = useState<SortKey>("closest");
  const [releasedSort, setReleasedSort] = useState<SortKey>("recent");

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (b: Book) =>
      !q || b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q);
    // A book counts as "released" for this app once an audiobook is available.
    const released = (b: Book) => b.audiobookAvailable === true;
    const upcoming = books
      .filter((b) => !released(b) && matches(b))
      .sort((a, b) => compareBooks(upcomingSort, a, b));
    const done = books
      .filter((b) => released(b) && matches(b))
      .sort((a, b) => compareBooks(releasedSort, a, b));
    return [
      { key: "upcoming" as const, title: "Upcoming", items: upcoming, sort: upcomingSort, setSort: setUpcomingSort, options: UPCOMING_SORTS },
      { key: "released" as const, title: "Released", items: done, sort: releasedSort, setSort: setReleasedSort, options: RELEASED_SORTS },
    ].filter((s) => filter === "all" || filter === s.key);
  }, [books, query, filter, upcomingSort, releasedSort]);

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Watchlist</h1>
        <p className="text-muted-foreground">
          Find a book or an author, then pick what to watch. Release dates come from Hardcover.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {!hardcoverSet && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          <span>
            Searching and release dates need your Hardcover API token. Add it in Settings to start.
          </span>
          <Button asChild size="sm" variant="outline">
            <Link href="/settings">Open Settings</Link>
          </Button>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className={cn(
            "flex items-start justify-between gap-4 rounded-lg border px-4 py-3 text-sm",
            notice.tone === "ok" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
            notice.tone === "warn" && "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
            notice.tone === "error" && "border-destructive/40 bg-destructive/10 text-destructive",
          )}
        >
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="shrink-0 opacity-70 hover:opacity-100" aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      {/* ---------- Search ---------- */}
      <section id="find" className="scroll-mt-20 space-y-4">
        {matching && (
          <div className="flex items-center justify-between gap-4 rounded-lg border border-primary/30 bg-accent px-4 py-3 text-sm">
            <span>
              Matching <strong>{matching.title}</strong>. Pick its Hardcover entry below to link it.
            </span>
            <Button variant="ghost" size="sm" onClick={() => { setMatching(null); setResults(null); }}>
              Cancel
            </Button>
          </div>
        )}
        <form
          onSubmit={search}
          className="flex w-full flex-col gap-2 rounded-xl border bg-card p-2 shadow-sm sm:flex-row sm:items-center"
        >
          <div className="flex flex-1 items-center gap-2 px-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Input
              placeholder="Title (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
          </div>
          <div className="hidden h-6 w-px bg-border sm:block" />
          <div className="flex flex-1 items-center gap-2 px-2">
            <User className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Input
              placeholder="Author (optional)"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              className="border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
          </div>
          <Button type="submit" disabled={searching || (!title.trim() && !author.trim())} className="gap-2">
            {searching && <Loader2 className="h-4 w-4 animate-spin" />}
            {searching ? "Searching…" : "Search"}
          </Button>
        </form>
        <p className="px-1 text-xs text-muted-foreground">
          Fill in either field, or both. An author alone lets you watch all of their upcoming books.
        </p>

        {results && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="shadow-none">
              <CardContent className="space-y-3 p-4">
                <h2 className="text-sm font-medium text-muted-foreground">Books</h2>
                {results.books.length === 0 && <p className="text-sm text-muted-foreground">No books found.</p>}
                {results.books.map((b) => {
                  const watched = watchedHardcoverIds.has(b.hardcoverId);
                  const key = `book:${b.hardcoverId}`;
                  return (
                    <div key={b.hardcoverId} className="flex items-center gap-3">
                      <Cover src={b.coverUrl} alt={b.title} className="h-16 w-11" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{b.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {b.authors.join(", ") || "Unknown author"}
                          {b.releaseYear ? ` · ${b.releaseYear}` : ""}
                        </p>
                      </div>
                      {watched ? (
                        <Button size="sm" variant="outline" disabled className="gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Watching
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() =>
                            watch(
                              key,
                              matching
                                ? { type: "book", hardcoverId: b.hardcoverId, replaceBookId: matching.id }
                                : { type: "book", hardcoverId: b.hardcoverId },
                            )
                          }
                          disabled={pending.has(key)}
                        >
                          {pending.has(key) ? "Saving…" : matching ? "Link this" : "Watch"}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card className="shadow-none">
              <CardContent className="space-y-3 p-4">
                <h2 className="text-sm font-medium text-muted-foreground">Authors</h2>
                {results.authors.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    {author.trim() ? "No authors found." : "Enter an author to see author matches."}
                  </p>
                )}
                {results.authors.map((a) => {
                  const watched = watchedAuthorIds.has(a.hardcoverAuthorId);
                  const key = `author:${a.hardcoverAuthorId}`;
                  return (
                    <div key={a.hardcoverAuthorId} className="flex items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent">
                        <User className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{a.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {a.booksCount != null ? `${a.booksCount} books` : "Author"} · watches upcoming releases
                        </p>
                      </div>
                      {watched ? (
                        <Button size="sm" variant="outline" disabled className="gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Watching
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            watch(key, { type: "author", hardcoverAuthorId: a.hardcoverAuthorId, name: a.name })
                          }
                          disabled={pending.has(key)}
                        >
                          {pending.has(key) ? "Adding…" : "Watch all upcoming"}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        )}
      </section>

      {/* ---------- Watchlist ---------- */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border bg-muted/50" />
          ))}
        </div>
      ) : books.length === 0 && authorWatches.length === 0 ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent">
              <BookOpen className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="font-medium">Nothing on your watchlist yet</p>
              <p className="text-sm text-muted-foreground">Search above to find a book or an author to follow.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {authorWatches.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Watched authors</h2>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={syncAuthors}
                  disabled={pending.has("sync")}
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", pending.has("sync") && "animate-spin")} />
                  Refresh authors
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {authorWatches.map((w) => (
                  <span
                    key={w.id}
                    className="inline-flex items-center gap-2 rounded-full border bg-card py-1 pl-3 pr-1 text-sm"
                  >
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                    {w.name}
                    <button
                      onClick={() => setPendingAuthor(w)}
                      className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label={`Stop watching ${w.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div role="tablist" aria-label="Filter books" className="inline-flex w-fit gap-1 rounded-lg border bg-card p-1">
                {(
                  [
                    { value: "all", label: "All", count: books.length },
                    { value: "upcoming", label: "Upcoming", count: books.filter((b) => b.audiobookAvailable !== true).length },
                    { value: "released", label: "Released", count: books.filter((b) => b.audiobookAvailable === true).length },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.value}
                    role="tab"
                    aria-selected={filter === t.value}
                    onClick={() => setFilter(t.value)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                      filter === t.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    {t.label} <span className="tabular-nums opacity-70">{t.count}</span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 sm:w-[28rem]">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search title or author"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-9"
                  aria-label="Search watchlist"
                />
              </div>
              <div role="group" aria-label="Layout" className="inline-flex shrink-0 gap-1 rounded-lg border bg-card p-1">
                {(
                  [
                    { value: "grid", label: "Grid view", icon: LayoutGrid },
                    { value: "list", label: "List view", icon: List },
                  ] as const
                ).map((v) => (
                  <button
                    key={v.value}
                    type="button"
                    aria-pressed={view === v.value}
                    aria-label={v.label}
                    title={v.label}
                    onClick={() => setStoredView(v.value)}
                    className={cn(
                      "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                      view === v.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <v.icon className="h-4 w-4" />
                  </button>
                ))}
              </div>
              </div>
            </div>

            <div className={view === "grid" ? "grid gap-4 md:grid-cols-2 xl:grid-cols-3" : "flex flex-col gap-2"}>
              {sections.map((sec) => (
                <Fragment key={sec.key}>
                  <div className="col-span-full flex flex-wrap items-center justify-between gap-3 pt-2">
                    <h2 className="text-lg font-semibold">
                      {sec.title}{" "}
                      <span className="text-sm font-normal text-muted-foreground">{sec.items.length}</span>
                    </h2>
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                      Sort
                      <select
                        value={sec.sort}
                        onChange={(e) => sec.setSort(e.target.value as SortKey)}
                        className="h-8 rounded-md border bg-background px-2 text-sm text-foreground"
                      >
                        {sec.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {sec.items.length === 0 && (
                    <p className="col-span-full text-sm text-muted-foreground">
                      {query.trim() ? "No matches." : `No ${sec.title.toLowerCase()} books yet.`}
                    </p>
                  )}
                  {sec.items.map((b) => {
                const tag = releaseTag(b.expectedReleaseDate, b.audiobookAvailable, b.hardcoverId !== null);
                const isChecking = checking.has(b.id);
                const hardcoverUrl = b.hardcoverSlug ? `https://hardcover.app/books/${b.hardcoverSlug}` : null;
                const audiobookUrl = b.appleAudiobookUrl ?? hardcoverUrl;
                const owned = ownedState(b);
                const OwnIcon = OWN_ICON[owned];
                return (
                  <Card
                    key={b.id}
                    className={cn(
                      "relative overflow-hidden shadow-none transition-shadow hover:shadow-md",
                      view === "grid" ? "flex flex-col" : "flex flex-row items-stretch",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => cycleOwned(b)}
                      title={OWN_LABEL[owned]}
                      aria-label={OWN_LABEL[owned]}
                      className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-md border bg-card transition-colors hover:bg-accent"
                    >
                      <OwnIcon className={cn("h-4 w-4", OWN_COLOR[owned])} />
                    </button>
                    <div className={cn("flex min-w-0 flex-1 gap-4 p-4", view === "list" && "items-center py-3")}>
                      <Cover src={b.coverUrl} alt={b.title} className={view === "grid" ? "h-36 w-24" : "h-20 w-14"} />

                      <div className="flex min-w-0 flex-1 flex-col gap-2">
                        <div className="min-w-0">
                          <h3 className="line-clamp-2 pr-9 font-semibold leading-snug" title={b.title}>
                            {b.title}
                          </h3>
                          <p className="truncate text-sm text-muted-foreground">{b.author}</p>
                        </div>

                        <div className="flex flex-col items-start gap-1">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
                              TONE_CLASSES[tag.tone],
                            )}
                          >
                            <CalendarClock className="h-3 w-3" />
                            {tag.label}
                          </span>
                          {tag.detail && <span className="pl-1 text-xs text-muted-foreground">{tag.detail}</span>}
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                          <FormatChip label="Ebook" icon={FileText} found={b.ebookAvailable} url={hardcoverUrl} />
                          <FormatChip label="Audiobook" icon={Headphones} found={b.audiobookAvailable} url={audiobookUrl} />
                        </div>

                      </div>
                    </div>

                    <div
                      className={cn(
                        "flex items-center justify-between gap-2 px-4 py-3",
                        view === "grid" ? "border-t" : "shrink-0 flex-nowrap border-l",
                      )}
                    >
                      {b.hardcoverSlug ? (
                        <Button asChild size="sm" variant="outline" className="h-8 gap-1.5">
                          <a href={`https://hardcover.app/books/${b.hardcoverSlug}`} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-3.5 w-3.5" />
                            See details
                          </a>
                        </Button>
                      ) : b.hardcoverId === null ? (
                        <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => startMatch(b)}>
                          Match on Hardcover
                        </Button>
                      ) : (
                        <span />
                      )}
                      <div className="flex items-center gap-1.5">
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-8 w-8"
                          onClick={() => recheck(b.id)}
                          disabled={isChecking}
                          aria-label={`Re-check ${b.title}`}
                          title="Re-check"
                        >
                          <RefreshCw className={cn("h-4 w-4", isChecking && "animate-spin")} />
                        </Button>
                        <Button
                          size="icon"
                          onClick={() => setPendingDelete(b)}
                          className="h-8 w-8 bg-[#7f1d1d] text-white hover:bg-[#991b1b]"
                          aria-label={`Delete ${b.title}`}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
                  })}
                </Fragment>
              ))}
            </div>
          </section>
        </>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Delete this book?"
        description={`"${pendingDelete?.title ?? ""}" will be removed from your watchlist, along with its check history.`}
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={async () => {
          const book = pendingDelete;
          if (!book) return;
          setDeleting(true);
          await removeBook(book);
          setDeleting(false);
          setPendingDelete(null);
        }}
      />

      <ConfirmDialog
        open={pendingAuthor !== null}
        onOpenChange={(open) => !open && setPendingAuthor(null)}
        title="Stop watching this author?"
        description={`Their upcoming books that were added through "${pendingAuthor?.name ?? ""}" will be removed from your watchlist.`}
        confirmLabel="Stop watching"
        busy={deleting}
        onConfirm={async () => {
          const author = pendingAuthor;
          if (!author) return;
          setDeleting(true);
          await removeAuthor(author);
          setDeleting(false);
          setPendingAuthor(null);
        }}
      />
    </div>
  );
}
