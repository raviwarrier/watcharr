"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, Check, Copy, Download, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";

/** Calendar feed menu: download the .ics file, or get a subscription link for calendar apps. */
export function CalendarMenu() {
  const [open, setOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function openLink() {
    setOpen(false);
    setLinkOpen(true);
    setError(null);
    setCopied(false);
    setLoading(true);
    try {
      const res = await fetch("/api/calendar/link", { cache: "no-store" });
      if (!res.ok) throw new Error("Could not get the link. Sign in again and retry.");
      const body = await res.json();
      setUrl(`${window.location.origin}/api/calendar.ics?token=${body.token}`);
    } catch (err) {
      setUrl(null);
      setError(err instanceof Error ? err.message : "Could not get the link.");
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Could not copy. Select the link and copy it manually.");
    }
  }

  return (
    <>
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
        >
          <CalendarDays className="h-4 w-4" />
          <span className="hidden sm:inline">Calendar feed</span>
        </button>
        {open && (
          <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-56 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
            <a
              role="menuitem"
              href="/api/calendar.ics"
              download="watcharr.ics"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-accent"
            >
              <Download className="h-4 w-4" />
              Download .ics file
            </a>
            <button
              role="menuitem"
              type="button"
              onClick={openLink}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-accent"
            >
              <Link2 className="h-4 w-4" />
              Get subscription link
            </button>
          </div>
        )}
      </div>

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogTitle>Calendar subscription link</DialogTitle>
          <DialogDescription>
            Paste this into your calendar app as a new subscription (for example, &quot;From URL&quot; in Google
            Calendar). Anyone with the link can read your watchlist, but can&apos;t change anything.
          </DialogDescription>
          {loading && <p className="text-sm text-muted-foreground">Getting the link…</p>}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {url && (
            <div className="flex items-start gap-2">
              <code className="min-w-0 flex-1 break-all rounded-md border bg-muted px-3 py-2 font-mono text-xs select-all">{url}</code>
              <Button variant="outline" size="sm" onClick={copy} className="shrink-0 gap-1.5">
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setLinkOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
