"use client";

import { useEffect, useState } from "react";
import { Loader2, Link2, Unplug, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Status = {
  configured: boolean;
  url: string | null;
  mode: "apiKey" | "login" | null;
  libraryId: string | null;
  lastRun: string | null;
  matched: number;
  review: number;
};

type Library = { id: string; name: string };

const selectClass = "h-9 w-full rounded-md border bg-background px-2 text-sm";

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.error ?? `The server couldn't complete the request (error ${res.status}).`;
}

/** Settings > Reconciling libraries. The Audiobookshelf sub-section is the first library. */
export function ReconcileSection() {
  const [status, setStatus] = useState<Status | null>(null);
  const [mode, setMode] = useState<"apiKey" | "login">("apiKey");
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [libraries, setLibraries] = useState<Library[] | null>(null);
  const [libraryId, setLibraryId] = useState("");
  const [busy, setBusy] = useState<"connect" | "run" | "disconnect" | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function loadStatus() {
    try {
      const res = await fetch("/api/reconcile/abs/status", { cache: "no-store" });
      if (res.ok) setStatus(await res.json());
    } catch {
      // Keep the last status shown.
    }
  }

  useEffect(() => {
    let active = true;
    fetch("/api/reconcile/abs/status", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Status | null) => {
        if (active && data) setStatus(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  async function connect() {
    setBusy("connect");
    setMessage(null);
    try {
      const res = await fetch("/api/reconcile/abs/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          mode,
          apiKey: mode === "apiKey" ? apiKey : undefined,
          username: mode === "login" ? username : undefined,
          password: mode === "login" ? password : undefined,
          libraryId: libraryId || undefined,
        }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const body = await res.json();
      if (body.needsLibrary) {
        setLibraries(body.libraries);
        setLibraryId(body.libraries[0]?.id ?? "");
        setMessage({ tone: "ok", text: `Audiobookshelf ${body.version} found. Choose the library to use.` });
        return;
      }
      setLibraries(null);
      setApiKey("");
      setPassword("");
      setMessage({ tone: "ok", text: `Connected to Audiobookshelf ${body.version}.` });
      loadStatus();
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Could not connect." });
    } finally {
      setBusy(null);
    }
  }

  async function reconcileNow() {
    setBusy("run");
    setMessage(null);
    try {
      const res = await fetch("/api/reconcile/abs/run", { method: "POST" });
      if (!res.ok) throw new Error(await readError(res));
      const body = await res.json();
      setMessage({
        tone: "ok",
        text: `Checked ${body.checked} books: ${body.matched} marked as owned as audiobooks, ${body.review} to review, ${body.unmatched} not in the library.`,
      });
      loadStatus();
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Reconciliation failed." });
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    setMessage(null);
    await fetch("/api/reconcile/abs/disconnect", { method: "POST" });
    setBusy(null);
    setLibraries(null);
    setMessage({ tone: "ok", text: "Disconnected. Books keep their ownership marks." });
    loadStatus();
  }

  const canConnect =
    url.trim() !== "" && (mode === "apiKey" ? apiKey.trim() !== "" : username.trim() !== "" && password !== "");

  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>Reconciling libraries</CardTitle>
        <CardDescription>
          Find the books you already own, and mark them on the cards. Reconciling only adds ownership. It never removes it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {message && (
          <p role="status" className={cn("text-sm", message.tone === "error" ? "text-destructive" : "text-muted-foreground")}>
            {message.text}
          </p>
        )}

        <div className="space-y-4 rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">Audiobookshelf</p>
            {status?.configured && (
              <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">
                Connected
              </span>
            )}
          </div>

          {status?.configured ? (
            <>
              <p className="text-sm text-muted-foreground">
                {status.url} · signed in with {status.mode === "login" ? "username and password" : "an API key"}
              </p>
              <p className="text-sm text-muted-foreground">
                {status.matched} owned as audiobooks · {status.review} to review
                {status.lastRun ? ` · last run ${new Date(status.lastRun).toLocaleString()}` : " · not run yet"}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={reconcileNow} disabled={busy !== null} className="gap-2">
                  {busy === "run" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Reconcile now
                </Button>
                <Button variant="outline" onClick={disconnect} disabled={busy !== null} className="gap-2">
                  <Unplug className="h-4 w-4" />
                  Disconnect
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Not connected. Use an API key (recommended), or your username and password if you don&apos;t have a key.
            </p>
          )}

          {(!status?.configured || libraries) && (
            <div className="space-y-3 border-t pt-4">
              <label className="block space-y-1 text-sm">
                <span className="font-medium">Address</span>
                <Input
                  placeholder="https://abs.example.com or http://192.168.1.50:13378"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>

              <fieldset className="space-y-2 text-sm">
                <legend className="mb-1 font-medium">How to sign in</legend>
                <label className="flex items-center gap-2">
                  <input type="radio" name="abs-mode" checked={mode === "apiKey"} onChange={() => setMode("apiKey")} />
                  API key (recommended)
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="abs-mode" checked={mode === "login"} onChange={() => setMode("login")} />
                  Username and password. Only used once, to get a token. The password isn&apos;t stored.
                </label>
              </fieldset>

              {mode === "apiKey" ? (
                <label className="block space-y-1 text-sm">
                  <span className="font-medium">API key</span>
                  <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" spellCheck={false} />
                </label>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block space-y-1 text-sm">
                    <span className="font-medium">Username</span>
                    <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span className="font-medium">Password</span>
                    <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
                  </label>
                </div>
              )}

              {libraries && (
                <label className="block space-y-1 text-sm">
                  <span className="font-medium">Library</span>
                  <select className={selectClass} value={libraryId} onChange={(e) => setLibraryId(e.target.value)}>
                    {libraries.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <Button onClick={connect} disabled={!canConnect || busy !== null} className="gap-2">
                {busy === "connect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                {libraries ? "Save library" : "Connect and check"}
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
