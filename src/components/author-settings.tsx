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
            <span className="block font-medium">Add new books with no release date yet</span>
            <span className="block text-muted-foreground">
              A new book by an author you watch goes on the watchlist even before it has a date. Hardcover also lists old
              books with no date, so those are only added when the option below is on.
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
              Off: when you start watching, only books with a future date are added. On: the author&apos;s older books,
              including ones with no date, are added too.
            </span>
          </span>
        </label>
      </CardContent>
    </Card>
  );
}
