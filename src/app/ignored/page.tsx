import { WatchlistView } from "@/components/watchlist-view";

/** Ignored books, shown in the same layout as the watchlist. Reached from Settings > Books. */
export default function IgnoredPage() {
  return <WatchlistView mode="ignored" />;
}
