"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, Play, Square, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Job = {
  id: number;
  source: string;
  fileName: string | null;
  status: "awaiting" | "running" | "done" | "cancelled";
  createdAt: string;
  finishedAt: string | null;
  total: number;
  done: number;
  skipped: number;
  failed: number;
  pending: number;
};

type Mapping = { title: string; author?: string; isbn?: string; tag?: string; tagValues?: string[] };
type TagValue = { value: string; count: number };

const STATUS_LABEL: Record<Job["status"], string> = {
  awaiting: "Ready to start",
  running: "Running",
  done: "Finished",
  cancelled: "Cancelled",
};

const selectClass = "h-9 w-full rounded-md border bg-background px-2 text-sm";

export function ImportSection() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [file, setFile] = useState<File | null>(null);
  // Step 2: mapping the columns (for files that aren't Goodreads exports).
  const [headers, setHeaders] = useState<string[] | null>(null);
  const [mapping, setMapping] = useState<Mapping>({ title: "", author: "", isbn: "", tag: "" });
  // Step 3: which tag values to import.
  const [tagValues, setTagValues] = useState<TagValue[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  // Step 4: a job waiting to start.
  const [ready, setReady] = useState<{ jobId: number; total: number; noTitle: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/import/jobs", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Job[]) => {
        if (active) setJobs(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  async function loadJobs() {
    try {
      const res = await fetch("/api/import/jobs", { cache: "no-store" });
      if (res.ok) setJobs(await res.json());
    } catch {
      // Keep the last known list.
    }
  }

  // Refresh while an import is running.
  const anyRunning = jobs.some((j) => j.status === "running");
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(loadJobs, 5000);
    return () => clearInterval(timer);
  }, [anyRunning]);

  async function readError(res: Response): Promise<string> {
    const body = await res.json().catch(() => null);
    return body?.error ?? `The server couldn't complete the request (error ${res.status}).`;
  }

  function reset() {
    setHeaders(null);
    setTagValues(null);
    setPicked([]);
    setReady(null);
    setMessage(null);
  }

  /** Sends the file with the current mapping. The server answers with the next step. */
  async function send(withMapping: Mapping | null, withPicked?: string[]) {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      if (withMapping) {
        const clean: Mapping = { title: withMapping.title };
        if (withMapping.author) clean.author = withMapping.author;
        if (withMapping.isbn) clean.isbn = withMapping.isbn;
        if (withMapping.tag) clean.tag = withMapping.tag;
        if (withPicked && withPicked.length > 0) clean.tagValues = withPicked;
        form.append("mapping", JSON.stringify(clean));
      }
      const res = await fetch("/api/import/preview", { method: "POST", body: form });
      if (!res.ok) throw new Error(await readError(res));
      const body = await res.json();

      if (body.needsMapping) {
        setHeaders(body.headers);
        setTagValues(null);
        setMessage({ tone: "ok", text: "Choose which column holds each detail, then continue." });
      } else if (body.needsTagValues) {
        setTagValues(body.values);
        setPicked([]);
        setMessage({ tone: "ok", text: "Choose which tags to import. Books with other tags are left out." });
      } else {
        setHeaders(null);
        setTagValues(null);
        setReady({ jobId: body.jobId, total: body.total, noTitle: body.noTitle });
        loadJobs();
      }
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Could not read the file." });
    } finally {
      setBusy(false);
    }
  }

  async function jobAction(id: number, action: "start" | "cancel") {
    setMessage(null);
    const res = await fetch(`/api/import/jobs/${id}/${action}`, { method: "POST" });
    if (!res.ok) {
      setMessage({ tone: "error", text: await readError(res) });
      return;
    }
    if (action === "start") {
      setReady(null);
      setMessage({ tone: "ok", text: "Import started. It runs slowly on purpose, so the server and Hardcover stay responsive." });
    } else {
      setReady(null);
    }
    loadJobs();
  }

  const togglePicked = (value: string) =>
    setPicked((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));

  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>Import your library</CardTitle>
        <CardDescription>
          Upload a CSV of books you want to track: a Goodreads export, a Hardcover export, or any CSV you keep yourself.
          Imports run one book at a time, so a list of about 275 books takes roughly 30 to 60 minutes. You get a Gotify
          message when an import finishes, if Gotify is set up.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {message && (
          <p role="status" className={cn("text-sm", message.tone === "error" ? "text-destructive" : "text-muted-foreground")}>
            {message.text}
          </p>
        )}

        <div className="space-y-3 rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">
            Goodreads: My Books, then Export Library. Only books on the <strong>wishlist</strong> shelf are imported.
            Other files: you&apos;ll choose the title, author, ISBN, and tag columns next.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label="CSV file"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                reset();
              }}
              className="text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5"
            />
            <Button onClick={() => send(null)} disabled={!file || busy} className="gap-2 sm:ml-auto">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Continue
            </Button>
          </div>

          {headers && (
            <div className="space-y-3 rounded-md bg-muted/50 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Title</span>
                  <select className={selectClass} value={mapping.title} onChange={(e) => setMapping({ ...mapping, title: e.target.value })}>
                    <option value="">Choose a column</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Author (optional)</span>
                  <select className={selectClass} value={mapping.author ?? ""} onChange={(e) => setMapping({ ...mapping, author: e.target.value })}>
                    <option value="">Not used</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium">ISBN (optional)</span>
                  <select className={selectClass} value={mapping.isbn ?? ""} onChange={(e) => setMapping({ ...mapping, isbn: e.target.value })}>
                    <option value="">Not used</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Tag column (optional)</span>
                  <select className={selectClass} value={mapping.tag ?? ""} onChange={(e) => setMapping({ ...mapping, tag: e.target.value })}>
                    <option value="">Import every row</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                The tag column holds values such as read, want to read, or wishlist. You&apos;ll pick which values to import next.
              </p>
              <Button
                onClick={() => send(mapping)}
                disabled={!mapping.title || busy}
                className="gap-2"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Continue
              </Button>
            </div>
          )}

          {tagValues && (
            <div className="space-y-3 rounded-md bg-muted/50 p-3">
              <p className="text-sm font-medium">Which tags should be imported?</p>
              {tagValues.length === 0 && <p className="text-sm text-muted-foreground">No tags found in that column.</p>}
              <div className="grid gap-2 sm:grid-cols-2">
                {tagValues.map((t) => (
                  <label key={t.value} className="flex cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm">
                    <input type="checkbox" checked={picked.includes(t.value)} onChange={() => togglePicked(t.value)} />
                    <span className="min-w-0 flex-1 truncate">{t.value}</span>
                    <span className="tabular-nums text-muted-foreground">{t.count}</span>
                  </label>
                ))}
              </div>
              <Button onClick={() => send(mapping, picked)} disabled={picked.length === 0 || busy} className="gap-2">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Continue with {picked.length} tag{picked.length === 1 ? "" : "s"}
              </Button>
            </div>
          )}

          {ready && (
            <div className="flex flex-col gap-2 rounded-md border border-primary/30 bg-accent p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <span>
                {ready.total} book{ready.total === 1 ? "" : "s"} ready to check.
                {ready.noTitle > 0 ? ` ${ready.noTitle} row(s) had no title and were skipped.` : ""} Books already on your watchlist are skipped.
              </span>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => jobAction(ready.jobId, "cancel")}>
                  Discard
                </Button>
                <Button onClick={() => jobAction(ready.jobId, "start")} className="gap-2">
                  <Play className="h-4 w-4" />
                  Start import
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <p className="font-medium">Recent imports</p>
          {jobs.length === 0 && <p className="text-sm text-muted-foreground">No imports yet.</p>}
          {jobs.map((job) => {
            const finished = job.done + job.skipped + job.failed;
            const pct = job.total ? Math.round((finished / job.total) * 100) : 0;
            return (
              <div key={job.id} className="space-y-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {job.source}
                      {job.fileName ? ` · ${job.fileName}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {STATUS_LABEL[job.status]} · {new Date(job.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {job.status === "awaiting" && (
                      <Button size="sm" onClick={() => jobAction(job.id, "start")} className="gap-1.5">
                        <Play className="h-3.5 w-3.5" />
                        Start
                      </Button>
                    )}
                    {(job.status === "awaiting" || job.status === "running") && (
                      <Button size="sm" variant="outline" onClick={() => jobAction(job.id, "cancel")} className="gap-1.5">
                        <Square className="h-3.5 w-3.5" />
                        Cancel
                      </Button>
                    )}
                    {job.failed > 0 && (
                      <Button asChild size="sm" variant="outline" className="gap-1.5">
                        <a href={`/api/import/jobs/${job.id}/failures`}>
                          <Download className="h-3.5 w-3.5" />
                          Not found ({job.failed})
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted" aria-label={`${pct}% finished`}>
                  <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {job.done} added · {job.skipped} already on your list · {job.failed} not found · {job.pending} left
                </p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
