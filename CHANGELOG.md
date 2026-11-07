# Changelog

All notable changes to Watcharr are documented here.
Versions follow `X.Y.Z`: `Z` for bug fixes, `Y` for new features, and `X` for major changes.

## [0.2.0] - 2026-11-07

### Added
- Grid and list layouts for the watchlist. Your choice is remembered in the browser.

### Changed
- Removed the Tracked, Upcoming, Released, and Audiobook tiles. The counts are already on the filter tabs.
- The theme switch sits at the top right, next to Calendar feed.
- The Next.js development badge is hidden.

## [0.1.0] - 2026-11-07

First public version.

### Added
- Watchlist of books and authors. Search by title, author, or both, then pick the matching result.
- Watch all upcoming books by an author.
- Release status from Hardcover, with a second check on Apple Books for audiobooks Hardcover doesn't list.
- Ebook and audiobook availability, shown as pills with copy and open-link menus.
- Calendar feed (`.ics`) of expected release dates.
- Gotify push alerts when an ebook or audiobook becomes available, plus an optional summary after each scheduled re-check.
- Automatic re-check on a schedule: daily, every 7 days, every month (default), or every 3 months.
- Light, dark, and system themes.
- Encrypted storage (AES-256-GCM) for API tokens, server URLs, and other personal settings.

### Security
- Settings are encrypted by default. Only a short allowlist of preferences is stored in plain text.
- The settings API returns masked values. Full secrets never reach the browser.
