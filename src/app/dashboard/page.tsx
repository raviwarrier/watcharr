"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ClearableInput } from "@/components/ui/clearable-input";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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
  absItemUrl?: string | null;
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

type AuthorSortKey = "author-asc" | "author-desc" | "closest" | "latest";

/** True when one of the book's authors is this name. Book authors are stored as "A, B". */
function sameAuthor(bookAuthor: string, name: string): boolean {
  const target = name.trim().toLowerCase();
  return bookAuthor.split(",").some((a) => a.trim().toLowerCase() === target);
}

const AUTHOR_SORTS: { value: AuthorSortKey; label: string }[] = [
  { value: "author-asc", label: "Author A–Z" },
  { value: "author-desc", label: "Author Z–A" },
  { value: "closest", label: "Closest release" },
  { value: "latest", label: "Furthest release" },
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
  appUrl,
}: {
  label: string;
  icon: typeof FileText;
  found: boolean | null;
  url: string | null;
  /** Link into another app, such as the book in Audiobookshelf. */
  appUrl?: string | null;
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
                {appUrl && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 justify-start gap-2 text-xs"
                    onClick={() => {
                      window.open(appUrl, "_blank", "noopener,noreferrer");
                      setOpen(false);
                    }}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open in Audiobookshelf
                  </Button>
                )}
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

/** Grid / list switch. Shared by the Books and Authors toolbars. */
function LayoutToggle({ view, onChange }: { view: "grid" | "list"; onChange: (value: "grid" | "list") => void }) {
  return (
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
          onClick={() => onChange(v.value)}
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors",
            view === v.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          <v.icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}

/**
 * One author card. The height is fixed: the title list always takes the same space, showing up to three
 * titles. Authors with more are reached through See all books.
 */
function AuthorCard({
  w,
  upcoming,
  view,
  checking,
  onOpenBook,
  onSeeAll,
  onRecheck,
  onRemove,
}: {
  w: AuthorWatch;
  upcoming: Book[];
  view: "grid" | "list";
  checking: boolean;
  onOpenBook: (id: number) => void;
  onSeeAll: (w: AuthorWatch) => void;
  onRecheck: (w: AuthorWatch) => void;
  onRemove: (w: AuthorWatch) => void;
}) {
  const heading = (
    <div className="min-w-0">
      <h3 className="truncate font-semibold" title={w.name}>
        {w.name}
      </h3>
      <p className="truncate text-sm text-muted-foreground">
        {upcoming.length === 0 ? "No upcoming books" : `${upcoming.length} upcoming`}
      </p>
    </div>
  );
  const titles = (
    <ul className="flex h-28 flex-col overflow-hidden">
      {upcoming.slice(0, 3).map((b) => (
        <li key={b.id} className="h-9 shrink-0">
          <button
            type="button"
            onClick={() => onOpenBook(b.id)}
            className="flex h-9 w-full items-center justify-between gap-3 rounded-md px-2 text-left text-sm hover:bg-accent"
          >
            <span className="min-w-0 truncate">{b.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {b.expectedReleaseDate ? formatDate(b.expectedReleaseDate) : "TBD"}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
  const actions = (
    <div className={cn("flex items-center justify-between gap-2 px-4 py-3", view === "grid" ? "border-t" : "shrink-0 flex-nowrap border-l")}>
      <Button variant="outline" size="sm" className="h-8" onClick={() => onSeeAll(w)}>
        See all books
      </Button>
      <div className="flex items-center gap-1.5">
        <Button
          size="icon"
          variant="outline"
          className="h-8 w-8"
          onClick={() => onRecheck(w)}
          disabled={checking}
          aria-label={`Re-check ${w.name}`}
          title="Re-check"
        >
          <RefreshCw className={cn("h-4 w-4", checking && "animate-spin")} />
        </Button>
        <Button
          size="icon"
          onClick={() => onRemove(w)}
          className="h-8 w-8 bg-[#7f1d1d] text-white hover:bg-[#991b1b]"
          aria-label={`Remove author ${w.name}`}
          title="Remove author"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  if (view === "list") {
    return (
      <Card className="flex flex-row items-stretch overflow-hidden shadow-none transition-shadow hover:shadow-md">
        <div className="flex min-w-0 flex-1 gap-6 p-4">
          <div className="w-56 shrink-0">{heading}</div>
          <div className="min-w-0 flex-1">{titles}</div>
        </div>
        {actions}
      </Card>
    );
  }
  return (
    <Card className="flex flex-col overflow-hidden shadow-none transition-shadow hover:shadow-md">
      <div className="flex flex-1 flex-col gap-3 p-4">
        {heading}
        {titles}
      </div>
      {actions}
    </Card>
  );
}

/** One book card. Used in the Books tab and in the popup opened from an author's list. */
function WatchCard({
  b,
  view,
  checking,
  onCycleOwned,
  onRecheck,
  onDelete,
  onMatch,
}: {
  b: Book;
  view: "grid" | "list";
  checking: boolean;
  onCycleOwned: (book: Book) => void;
  onRecheck: (id: number) => void;
  onDelete: (book: Book) => void;
  onMatch: (book: Book) => void;
}) {
  const tag = releaseTag(b.expectedReleaseDate, b.audiobookAvailable, b.hardcoverId !== null);
  const hardcoverUrl = b.hardcoverSlug ? `https://hardcover.app/books/${b.hardcoverSlug}` : null;
  const audiobookUrl = b.appleAudiobookUrl ?? hardcoverUrl;
  const owned = ownedState(b);
  const OwnIcon = OWN_ICON[owned];
  return (
    <Card
      className={cn(
        "relative overflow-hidden shadow-none transition-shadow hover:shadow-md",
        view === "grid" ? "flex flex-col" : "flex flex-row items-stretch",
      )}
    >
      <button
        type="button"
        onClick={() => onCycleOwned(b)}
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
            <FormatChip label="Audiobook" icon={Headphones} found={b.audiobookAvailable} url={audiobookUrl} appUrl={b.absItemUrl ?? null} />
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
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => onMatch(b)}>
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
            onClick={() => onRecheck(b.id)}
            disabled={checking}
            aria-label={`Re-check ${b.title}`}
            title="Re-check"
          >
            <RefreshCw className={cn("h-4 w-4", checking && "animate-spin")} />
          </Button>
          <Button
            size="icon"
            onClick={() => onDelete(b)}
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

  /** Checks one author on Hardcover now, the same way the scheduled check does. */
  async function recheckAuthor(w: AuthorWatch) {
    setCheckingAuthors((p) => new Set([...p, w.id]));
    setNotice(null);
    try {
      const res = await fetch(`/api/author-watches/${w.id}/sync`, { method: "POST" });
      if (!res.ok) throw new Error(await readError(res));
      const body = await res.json();
      await loadAll();
      const added = Number(body.added ?? 0);
      setNotice({
        tone: "ok",
        text: added === 0 ? `${w.name} is up to date.` : `${w.name}: ${added} new ${added === 1 ? "book" : "books"} added.`,
      });
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "Re-check failed" });
    } finally {
      setCheckingAuthors((p) => {
        const next = new Set(p);
        next.delete(w.id);
        return next;
      });
    }
  }

  /** Switches to the Books tab, filtered to this author's books. */
  function seeAllBooks(w: AuthorWatch) {
    setSection("books");
    setFilter("all");
    setQuery(w.name);
    document.getElementById("books")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const watchedHardcoverIds = useMemo(
    () => new Set(books.map((b) => b.hardcoverId).filter((id): id is number => id !== null)),
    [books],
  );
  const watchedAuthorIds = useMemo(
    () => new Set(authorWatches.map((a) => a.hardcoverAuthorId)),
    [authorWatches],
  );

  const [section, setSection] = useState<"books" | "authors">("books");
  const [authorQuery, setAuthorQuery] = useState("");
  const [authorSort, setAuthorSort] = useState<AuthorSortKey>("author-asc");
  const [openBookId, setOpenBookId] = useState<number | null>(null);
  const [checkingAuthors, setCheckingAuthors] = useState<Set<number>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<Book | null>(null);
  const [pendingAuthor, setPendingAuthor] = useState<AuthorWatch | null>(null);
  const [deleting, setDeleting] = useState(false);
  const view = useSyncExternalStore(subscribeView, getView, getServerView);
  const [filter, setFilter] = useState<"all" | "upcoming" | "released">("all");
  const [query, setQuery] = useState("");
  // Watchlist scope: every book on the watchlist, or only those with a future release date.
  const [watchScope, setWatchScope] = useState<"all" | "future">("all");
  const [upcomingSort, setUpcomingSort] = useState<SortKey>("closest");
  const [releasedSort, setReleasedSort] = useState<SortKey>("recent");

  const { sections, watchCounts } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (b: Book) =>
      !q || b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q);
    // A book counts as "released" for this app once an audiobook is available.
    // Released = an audiobook is available or owned (marked by hand, or found by reconciliation).
    const released = (b: Book) => b.audiobookAvailable === true || b.ownedAudiobook === true;
    // "Future" = the expected release date is today or later (local date).
    const today = new Date().toLocaleDateString("en-CA");
    const future = (b: Book) => !!b.expectedReleaseDate && b.expectedReleaseDate >= today;
    const waiting = books.filter((b) => !released(b));
    const upcoming = waiting
      .filter((b) => matches(b) && (watchScope === "all" || future(b)))
      .sort((a, b) => compareBooks(upcomingSort, a, b));
    const done = books
      .filter((b) => released(b) && matches(b))
      .sort((a, b) => compareBooks(releasedSort, a, b));
    const watchCounts = { all: waiting.length, future: waiting.filter(future).length };
    const sections = [
      { key: "upcoming" as const, title: "Watchlist", items: upcoming, sort: upcomingSort, setSort: setUpcomingSort, options: UPCOMING_SORTS },
      { key: "released" as const, title: "Released", items: done, sort: releasedSort, setSort: setReleasedSort, options: RELEASED_SORTS },
    ].filter((s) => filter === "all" || filter === s.key);
    return { sections, watchCounts };
  }, [books, query, filter, watchScope, upcomingSort, releasedSort]);

  /**
   * Author cards: each author's upcoming books (a future date, or TBD), sorted by date, plus the next release.
   * Authors with nothing upcoming sort last when sorting by release date.
   */
  const authorCards = useMemo(() => {
    const today = new Date().toLocaleDateString("en-CA");
    const rows = authorWatches.map((w) => {
      const upcoming = books
        .filter((b) =>
          b.expectedReleaseDate
            ? b.expectedReleaseDate >= today && sameAuthor(b.author, w.name)
            : b.authorWatchId === w.id,
        )
        .sort((a, b) => {
          if (!a.expectedReleaseDate && !b.expectedReleaseDate) return a.title.localeCompare(b.title);
          if (!a.expectedReleaseDate) return 1;
          if (!b.expectedReleaseDate) return -1;
          return a.expectedReleaseDate.localeCompare(b.expectedReleaseDate) || a.title.localeCompare(b.title);
        });
      const nextDate = upcoming[0]?.expectedReleaseDate ?? null;
      return { w, upcoming, nextDate };
    });
    const q = authorQuery.trim().toLowerCase();
    return rows
      .filter((r) => !q || r.w.name.toLowerCase().includes(q))
      .sort((a, b) => {
        if (authorSort === "author-asc") return a.w.name.localeCompare(b.w.name);
        if (authorSort === "author-desc") return b.w.name.localeCompare(a.w.name);
        // Dated authors first, TBD or nothing last, in both directions.
        if (!a.nextDate && !b.nextDate) return a.w.name.localeCompare(b.w.name);
        if (!a.nextDate) return 1;
        if (!b.nextDate) return -1;
        const diff = a.nextDate.localeCompare(b.nextDate);
        return (authorSort === "latest" ? -diff : diff) || a.w.name.localeCompare(b.w.name);
      });
  }, [authorWatches, books, authorQuery, authorSort]);

  const openBook = openBookId !== null ? books.find((b) => b.id === openBookId) ?? null : null;

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Search</h1>
        <p className="text-muted-foreground">Find a book or author to track</p>
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
            <ClearableInput
              placeholder="Titles to watch for"
              value={title}
              onChange={setTitle}
              wrapperClassName="flex-1"
              className="border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
          </div>
          <div className="hidden h-6 w-px bg-border sm:block" />
          <div className="flex flex-1 items-center gap-2 px-2">
            <User className="h-4 w-4 shrink-0 text-muted-foreground" />
            <ClearableInput
              placeholder="Authors to watch for"
              value={author}
              onChange={setAuthor}
              wrapperClassName="flex-1"
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

        <div id="books" className="scroll-mt-20" />
        <div role="tablist" aria-label="Watchlist sections" className="inline-flex w-fit gap-1 rounded-lg border bg-card p-1">
          {(
            [
              { value: "books", label: "Books", count: books.length },
              { value: "authors", label: "Authors", count: authorWatches.length },
            ] as const
          ).map((t) => (
            <button
              key={t.value}
              role="tab"
              aria-selected={section === t.value}
              onClick={() => setSection(t.value)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                section === t.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {t.label} <span className="tabular-nums opacity-70">{t.count}</span>
            </button>
          ))}
        </div>

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
      ) : section === "authors" ? (
        <section className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span />
            <div className="flex items-center gap-2 sm:w-[28rem]">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <ClearableInput
                  placeholder="Search your list for an author"
                  value={authorQuery}
                  onChange={setAuthorQuery}
                  className="pl-9"
                  aria-label="Search authors"
                />
              </div>
              <LayoutToggle view={view} onChange={setStoredView} />
            </div>
          </div>

          {authorWatches.length === 0 ? (
            <Card className="border-dashed shadow-none">
              <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent">
                  <User className="h-6 w-6 text-muted-foreground" />
                </div>
                <div className="space-y-1">
                  <p className="font-medium">You aren&apos;t watching any authors yet</p>
                  <p className="text-sm text-muted-foreground">Search above to find an author to follow.</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">
                  Authors <span className="text-sm font-normal text-muted-foreground">{authorCards.length}</span>
                </h2>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  Sort
                  <select
                    value={authorSort}
                    onChange={(e) => setAuthorSort(e.target.value as AuthorSortKey)}
                    className="h-8 rounded-md border bg-background px-2 text-sm text-foreground"
                  >
                    {AUTHOR_SORTS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {authorCards.length === 0 ? (
                <p className="text-sm text-muted-foreground">No matches.</p>
              ) : (
                <div className={view === "grid" ? "grid gap-4 md:grid-cols-2 xl:grid-cols-3" : "flex flex-col gap-2"}>
                  {authorCards.map(({ w, upcoming }) => (
                    <AuthorCard
                      key={w.id}
                      w={w}
                      upcoming={upcoming}
                      view={view}
                      checking={checkingAuthors.has(w.id)}
                      onOpenBook={setOpenBookId}
                      onSeeAll={seeAllBooks}
                      onRecheck={recheckAuthor}
                      onRemove={setPendingAuthor}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      ) : books.length === 0 ? (
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
          <section className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div role="tablist" aria-label="Filter books" className="inline-flex w-fit gap-1 rounded-lg border bg-card p-1">
                {(
                  [
                    { value: "all", label: "All", count: books.length },
                    { value: "upcoming", label: "Watchlist", count: books.filter((b) => !(b.audiobookAvailable === true || b.ownedAudiobook === true)).length },
                    { value: "released", label: "Released", count: books.filter((b) => b.audiobookAvailable === true || b.ownedAudiobook === true).length },
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
              {filter !== "released" && (
                <div role="tablist" aria-label="Watchlist dates" className="inline-flex w-fit gap-1 rounded-lg border bg-card p-1">
                  {(
                    [
                      { value: "all", label: "All", count: watchCounts.all },
                      { value: "future", label: "Upcoming", count: watchCounts.future },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.value}
                      role="tab"
                      aria-selected={watchScope === t.value}
                      onClick={() => setWatchScope(t.value)}
                      className={cn(
                        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                        watchScope === t.value ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      {t.label} <span className="tabular-nums opacity-70">{t.count}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 sm:w-[28rem]">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <ClearableInput
                  placeholder="Search title or author"
                  value={query}
                  onChange={setQuery}
                  className="pl-9"
                  aria-label="Search watchlist"
                />
              </div>
              <LayoutToggle view={view} onChange={setStoredView} />
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
                      {query.trim() ? "No matches." : sec.key === "upcoming" ? "Nothing on your watchlist right now." : "Nothing released yet."}
                    </p>
                  )}
                  {sec.items.map((b) => (
                    <WatchCard
                      key={b.id}
                      b={b}
                      view={view}
                      checking={checking.has(b.id)}
                      onCycleOwned={cycleOwned}
                      onRecheck={recheck}
                      onDelete={setPendingDelete}
                      onMatch={startMatch}
                    />
                  ))}
                </Fragment>
              ))}
            </div>
          </section>
        </>
      )}

      {/* Popup for a title picked from an author card: the same card as the Books tab. */}
      <Dialog open={openBook !== null} onOpenChange={(open) => !open && setOpenBookId(null)}>
        <DialogContent className="max-w-sm p-0">
          <DialogTitle className="sr-only">{openBook?.title ?? "Book"}</DialogTitle>
          {openBook && (
            <WatchCard
              b={openBook}
              view="grid"
              checking={checking.has(openBook.id)}
              onCycleOwned={cycleOwned}
              onRecheck={recheck}
              onDelete={(book) => {
                setOpenBookId(null);
                setPendingDelete(book);
              }}
              onMatch={(book) => {
                setOpenBookId(null);
                startMatch(book);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

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
        description={`Books that were added through "${pendingAuthor?.name ?? ""}" will be removed from your watchlist.`}
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
