# Changelog

All notable changes to Watcharr are documented here.
Versions follow `X.Y.Z`: `Z` for bug fixes, `Y` for new features, and `X` for major changes.

## [0.5.0] - 2026-11-07

### Added
- Access key. The install script creates a 64-character access key and shows it once. Only its hash is stored. Sign in with it at `/login`. Every page and API route requires a signed-in session.
- Calendar token. A second 64-character token, shown once, for the calendar feed URL (`/api/calendar.ics?token=...`). Calendar apps can subscribe without signing in.
- Sign out button, and a 30-day session.
- Sign-in attempts are limited to five wrong keys per 15 minutes.

### Changed
- The install script signs in with the new access key to save optional connection settings.

## [0.4.0] - 2026-11-07

### Added
- `ecosystem.config.js` for running Watcharr with PM2 on macOS, Linux, and Windows. PM2 can start it at boot.
- A systemd service block in `install.sh`. It's commented out, and the comments explain how to turn it on.

## [0.3.1] - 2026-11-07

### Fixed
- On Windows, the server ran in its own console window, and closing that window stopped the app. The server now runs with its window hidden. Used by `start.ps1` and `install.ps1`.

## [0.3.0] - 2026-11-07

### Added
- Install scripts (`install.sh` for macOS and Linux, `install.ps1` for Windows). They ask for the port, data folder, encryption key, and optional connections, install dependencies, create the database, build the app, and start it in the background.
- Start and stop scripts (`start.sh`/`stop.sh` and `start.ps1`/`stop.ps1`).

### Changed
- The data folder can be set with `DB_DIR`, and `drizzle-kit` reads the same setting.

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
