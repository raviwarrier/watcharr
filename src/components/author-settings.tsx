"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Flag = "authorIncludeTba" | "authorIncludeReleased";

/** Settings > Authors. Authors are checked on the same schedule as your books (Settings > Re-check). */
export function AuthorSettings() {
  const [tba, setTba] = useState(true);
  const [released, setReleased] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/settings", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : []))
      .then((rows: { key: string; masked: string | null }[]) => {
        if (!active) return;
        const value = (key: Flag) => rows.find((r) => r.key === key)?.masked;
        const t = value("authorIncludeTba");
        const r = value("authorIncludeReleased");
        if (t) setTba(t !== "false");
        if (r) setReleased(r === "true");
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  async function save(key: Flag, next: boolean) {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value: next ? "true" : "false" }),
    });
  }

  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>Authors</CardTitle>
        <CardDescription>
          Authors you watch are checked on the same schedule as your books. Their new books go on the watchlist.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={tba}
            onChange={(e) => {
              setTba(e.target.checked);
              save("authorIncludeTba", e.target.checked);
            }}
          />
          <span>
            <span className="block font-medium">Add books with a TBD date</span>
            <span className="block text-muted-foreground">
              Add an author&apos;s new book even before Hardcover has a release date for it.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={released}
            onChange={(e) => {
              setReleased(e.target.checked);
              save("authorIncludeReleased", e.target.checked);
            }}
          />
          <span>
            <span className="block font-medium">Include books already out when I start watching an author</span>
            <span className="block text-muted-foreground">
              Off: only books that come out after you start watching are added. New books are always added.
            </span>
          </span>
        </label>
      </CardContent>
    </Card>
  );
}
