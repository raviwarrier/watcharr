"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { ClearableInput } from "@/components/ui/clearable-input";
import { cn } from "@/lib/utils";

export type ReviewSource = "abs" | "calibre";

const SOURCE_NAME: Record<ReviewSource, string> = { abs: "Audiobookshelf", calibre: "Calibre" };

/** One row, in the same shape for both sources. */
type ReviewItem = {
  bookId: number;
  title: string;
  author: string;
  matchTitle: string | null;
  matchAuthor: string | null;
  matchUrl: string | null;
};

const PAGE_SIZE = 20;

/**
 * Review of matches found by title only. Built for long lists: paged, searchable, with bulk actions.
 * Each decision is saved immediately.
 */
export function ReviewDialog({
  open,
  onOpenChange,
  onChanged,
  source,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
  source: ReviewSource;
}) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = SOURCE_NAME[source];
  const base = `/api/reconcile/${source}/review`;

  // Debounce the search box, and go back to the first page when it changes.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  /** Fetches one page and maps it to the shared row shape. */
  async function fetchPage(pageIndex: number, term: string): Promise<{ total: number; items: ReviewItem[] }> {
    const params = new URLSearchParams({ offset: String(pageIndex * PAGE_SIZE), limit: String(PAGE_SIZE), q: term });
    const res = await fetch(`${base}?${params}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Could not load the matches to review.");
    const body = await res.json();
    const rows: ReviewItem[] = (body.items as Record<string, unknown>[]).map((r) =>
      source === "abs"
        ? {
            bookId: Number(r.bookId),
            title: String(r.title),
            author: String(r.author ?? ""),
            matchTitle: (r.absTitle as string | null) ?? null,
            matchAuthor: (r.absAuthor as string | null) ?? null,
            matchUrl: (r.absItemUrl as string | null) ?? null,
          }
        : {
            bookId: Number(r.bookId),
            title: String(r.title),
            author: String(r.author ?? ""),
            matchTitle: (r.calibreTitle as string | null) ?? null,
            matchAuthor: (r.calibreAuthor as string | null) ?? null,
            matchUrl: null,
          },
    );
    return { total: Number(body.total), items: rows };
  }

  // Load when the dialog opens, and when the page or search changes.
  useEffect(() => {
    if (!open) return;
    let active = true;
    fetchPage(page, search)
      .then((body) => {
        if (!active) return;
        setItems(body.items);
        setTotal(body.total);
        setError(null);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Could not load the matches to review.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // The dialog is mounted once per source, so fetchPage doesn't need to be a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, page, search]);

  /** Reloads the current page after a decision (from an event, so it may update state directly). */
  async function reloadPage(pageIndex: number) {
    setLoading(true);
    try {
      const body = await fetchPage(pageIndex, search);
      setItems(body.items);
      setTotal(body.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the matches to review.");
    } finally {
      setLoading(false);
    }
  }

  async function decide(ids: number[], decision: "confirm" | "reject") {
    if (ids.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookIds: ids, decision }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Could not save that decision.");
      }
      setSelected(new Set());
      onChanged();
      // If the page emptied, step back a page.
      const remaining = total - ids.length;
      const lastPage = Math.max(0, Math.ceil(remaining / PAGE_SIZE) - 1);
      const nextPage = Math.min(page, lastPage);
      setPage(nextPage);
      if (nextPage === page) await reloadPage(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that decision.");
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allOnPage = items.length > 0 && items.every((i) => selected.has(i.bookId));
  const togglePage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPage) items.forEach((i) => next.delete(i.bookId));
      else items.forEach((i) => next.add(i.bookId));
      return next;
    });

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setSelected(new Set());
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden">
        <DialogTitle>Review matches ({name})</DialogTitle>
        <DialogDescription>
          These books have the same title as a book in your {name} library, but the author didn&apos;t match. Confirm the
          ones that are the same book. Rejected matches won&apos;t be suggested again.
        </DialogDescription>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <ClearableInput placeholder="Search by title or author" value={query} onChange={setQuery} aria-label="Search matches" wrapperClassName="flex-1" />
          <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
            {total === 0 ? "Nothing to review" : `${from}–${to} of ${total}`}
          </span>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={allOnPage} onChange={togglePage} disabled={items.length === 0} />
            Select this page
          </label>
          <span className="text-muted-foreground">{selected.size} selected</span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" disabled={selected.size === 0 || busy} onClick={() => decide([...selected], "reject")}>
              Not these
            </Button>
            <Button size="sm" disabled={selected.size === 0 || busy} onClick={() => decide([...selected], "confirm")}>
              Yes, these are the same
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {loading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          )}
          {!loading && items.length === 0 && <p className="text-sm text-muted-foreground">No matches waiting for a decision.</p>}
          {items.map((item) => (
            <div
              key={item.bookId}
              className={cn("flex items-start gap-3 rounded-lg border p-3", selected.has(item.bookId) && "border-primary/50 bg-accent/50")}
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={selected.has(item.bookId)}
                onChange={() => toggle(item.bookId)}
                aria-label={`Select ${item.title}`}
              />
              <div className="min-w-0 flex-1 space-y-1 text-sm">
                <p className="font-medium">
                  {item.title} <span className="font-normal text-muted-foreground">by {item.author || "unknown author"}</span>
                </p>
                <p className="text-muted-foreground">
                  In {name}:{" "}
                  {item.matchTitle ? (
                    <>
                      {item.matchTitle}
                      {item.matchAuthor ? <> by {item.matchAuthor}</> : null}
                    </>
                  ) : (
                    "(run Reconcile now to refresh the details)"
                  )}
                </p>
              </div>
              <div className="flex shrink-0 flex-col gap-1.5">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => decide([item.bookId], "reject")}>
                  Not this
                </Button>
                <Button size="sm" disabled={busy} onClick={() => decide([item.bookId], "confirm")}>
                  Same book
                </Button>
                {item.matchUrl && (
                  <a
                    href={item.matchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-3 w-3" /> Open in {name}
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={page >= pages - 1 || loading} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
          <Button variant="outline" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            Previous
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
