import Link from "next/link";
import { ArrowRight, CalendarDays, Headphones, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";

const FEATURES = [
  {
    icon: CalendarDays,
    title: "Release dates",
    body: "Looks up expected release dates for the books and series you follow.",
  },
  {
    icon: Headphones,
    title: "Download availability",
    body: "Checks EPUB, PDF and audiobook sources so you know what's actually out there.",
  },
  {
    icon: CalendarDays,
    title: "Calendar feed",
    body: "Exports an .ics file you can import into any calendar app.",
  },
];

export default function Home() {
  return (
    <div className="relative isolate overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 -z-10 h-[32rem] bg-[radial-gradient(ellipse_at_top,var(--color-accent),transparent_70%)]"
      />

      <section className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 pb-16 pt-24 text-center sm:px-6">
        <span className="rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
          Self-hosted · your watchlist, your data
        </span>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Never miss the next book
        </h1>
        <p className="max-w-xl text-lg text-muted-foreground">
          Follow authors and series, see when the next release lands, and find out
          when it&apos;s available to download.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg" className="gap-2">
            <Link href="/dashboard">
              Open watchlist
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="gap-2">
            <Link href="/settings">
              <Settings className="h-4 w-4" />
              Settings
            </Link>
          </Button>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-4 px-4 pb-24 sm:grid-cols-3 sm:px-6">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-xl border bg-card p-6 shadow-sm">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
              <Icon className="h-5 w-5" />
            </div>
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
